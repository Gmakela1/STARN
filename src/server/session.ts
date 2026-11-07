import fs from 'node:fs';
import path from 'node:path';
import { CoreRunner, TurnResult } from '../core/runner.js';
// Aliased so the session keeps only the thin approval call (D2 gate: the
// inline approveArtifact body with its argument object must not appear here).
import { approveArtifact as applyArtifactApproval, parseAffectedPhaseIds } from '../core/approvals.js';
import { resolvePendingCheckpoint, CheckpointDecision, PendingCheckpoint } from '../core/checkpoint-resolution.js';
import { ChatMessage } from '../openrouter/types.js';
import { ChatClient } from '../openrouter/types.js';
import { OpenRouterClient } from '../openrouter/client.js';
import { Assignments, DEFAULT_VOICE_INPUT_MODEL, isValidVoiceInputModel, MODEL_ROLES, OPENROUTER_PROVIDER_ID, ProviderConfig, validateAssignments } from '../config.js';
import { allProviders, createProviderClient, createRoleClients, RoleClients } from '../models/role-clients.js';
import { ProjectStateManager } from '../workspace/state.js';
import { ToolRegistry } from '../tools/registry.js';
import { SpecialistRegistry } from '../specialists/registry.js';
import { Logger } from '../util/logger.js';
import { AutopilotDriver, AutopilotEvent } from '../core/autopilot.js';
import { applyAnswer, AnswerApplierDeps } from '../core/answer-applier.js';
import {
  runGateWithTimeout,
  runResearchBackfill,
  listBackfillEligibleItems,
  ResearchGateDeps,
  undoAutoApplied,
  recoverStaleResearchingItems,
  buildQuestionSections,
  enrichItem,
  setItemResearching,
  shortResearchTitle,
  RESEARCH_GATE_ITEM_TIMEOUT_MS
} from '../core/research-gate.js';
import { webFetchHandler } from '../tools/handlers/web-fetch.js';
import { AnswerQueue, AnswerApplyResult, AnswerFrameEvent } from '../core/answer-queue.js';
import { EventBus } from '../core/event-bus.js';
import { PortalItem, PortalThreadMessage } from '../workspace/types.js';
import { appendThreadMessage as appendThreadRow } from '../core/question-portal.js';
import { sanitizeResearchLine } from '../core/research-preflight.js';

// ── T-C answer-thread (advisory specialist Q&A) ──────────────────────────
/**
 * Max persisted thread rows per item — re-exported from core, where the trim
 * rule lives (first row kept, `recorded`/`proposal` rows never dropped, so an
 * all-permanent thread may exceed the cap).
 */
export { THREAD_MESSAGE_CAP } from '../core/question-portal.js';
/** Advisory reply hard cap (chars). */
const THREAD_REPLY_CHAR_CAP = 2000;
/** Advisory turn budget: quick read-only Q&A, no web research for v1. */
const THREAD_MAX_TURNS = 3;
/** Thread-turn allow-list: reads only — NO write tools ever, NO web_search for v1. */
const THREAD_ALLOWED_TOOLS = ['fs_read', 'fs_list', 'state_read'] as const;
/** Conclude-from-chat proposal answer cap (chars) — one short paragraph. */
const CONCLUDE_ANSWER_CHAR_CAP = 400;
/** Conclude turn: the reply markers the parser below reads back. */
const CONCLUDE_ANSWER_MARKER = 'PROPOSED ANSWER:';
const CONCLUDE_RATIONALE_MARKER = 'RATIONALE:';
/** Conclude turn output contract (parsed back in runConcludeTurn). */
const CONCLUDE_INSTRUCTION = `CONCLUDE THIS CONVERSATION: draft the answer the user should record for this open question.
Reply with exactly two labelled blocks and nothing else:
${CONCLUDE_ANSWER_MARKER} <one paragraph, <=400 characters, plain text>
${CONCLUDE_RATIONALE_MARKER} <one line saying why this answer follows from the conversation>`;
/**
 * Appended to the answering specialist's own system prompt. The specialist
 * prompt carries drafting/file-writing mandates; this directive overrides
 * them for this advisory-only turn, and THREAD_ALLOWED_TOOLS is the hard gate.
 */
export const ADVISORY_SYSTEM_DIRECTIVE = `ADVISORY TURN OVERRIDE (ADVICE ONLY — NOT A DRAFTING TURN):
The drafting instructions in your system prompt (write files, produce a document, Open Questions section) DO NOT apply to this turn. Do NOT call fs_write, fs_edit or state_update.
You are answering a user's clarifying question about an open question. ADVISE ONLY: never draft or edit documents. Answer from the project docs, recorded decisions, and prior research. Be concise (<=150 words). If unsure, say what would resolve it. Your final reply is PLAIN TEXT only — no headings, no markdown fences.
NOTHING IS RECORDED YET: an advisory reply records no decision. End EVERY reply with this exact sentence: "Nothing is recorded yet — send it as your answer, or use Conclude from chat."
NEVER write "Decision confirmed" and NEVER claim or imply that a decision was recorded, accepted or saved — only the user's answer (or Conclude from chat) records anything.`;

/** Markdown-tolerant answer marker: `**PROPOSED ANSWER:**` parses like the plain form. */
const CONCLUDE_ANSWER_MARKER_RE = /[*_]{0,2}\s*PROPOSED\s+ANSWER\s*:?\s*[*_]{0,2}/i;

/**
 * Removes a trailing non-commit sentence ("Nothing is recorded yet …") that a
 * model may append despite CONCLUDE_SYSTEM_DIRECTIVE, so it can never become
 * the recorded answer text.
 *
 * @param text One parsed answer block.
 * @returns The text without a trailing non-commit sentence, trimmed.
 */
function stripNonCommitSentence(text: string): string {
  return text.replace(/\s*nothing is recorded yet\b[^.!?]*[.!?]?\s*$/i, '').trim();
}

/**
 * Conclude-turn override: the same read-only/no-write gate as the advisory
 * directive, but WITHOUT its "End EVERY reply with …" closing sentence and its
 * "never draft" order — both contradict CONCLUDE_INSTRUCTION's "exactly two
 * labelled blocks and nothing else", and a compliant model would leak the
 * non-commit sentence into the answer the user is about to record.
 */
export const CONCLUDE_SYSTEM_DIRECTIVE = `CONCLUDE TURN OVERRIDE (DRAFT ONE PROPOSED ANSWER — NOTHING IS RECORDED):
The drafting instructions in your system prompt (write files, produce a document, Open Questions section) DO NOT apply to this turn. Do NOT call fs_write, fs_edit or state_update.
You are drafting the answer the user should record for the open question below, from the conversation, the project docs and the recorded decisions. Be concise (<=150 words). If unsure, say what would resolve it.
NOTHING IS RECORDED YET: only the user confirming the proposal records an answer. NEVER write "Decision confirmed" and NEVER claim or imply that a decision was recorded, accepted or saved.
Reply with EXACTLY the two labelled blocks the user message specifies and nothing else — no closing sentence, no sign-off, no markdown fences.`;

export interface SessionDeps {
  projectPath: string;
  stateManager: ProjectStateManager;
  /** OpenRouter API key (built-in provider). */
  apiKey: string;
  providers: ProviderConfig[];
  assignments: Assignments;
  /** Test seam: builds a client for a provider. Defaults to real OpenAI-compatible clients. */
  clientFactory?: (p: ProviderConfig) => ChatClient;
  siteUrl?: string;
  appName?: string;
  toolRegistry: ToolRegistry;
  specialistRegistry: SpecialistRegistry;
  compressionThreshold?: number;
  keepRecentTokens?: number;
  logger?: Logger;
  /** Master toggle for scanned-document transcription (default true). */
  transcriptionEnabled?: boolean;
  /** Speech-to-text model for voice dictation (default openai/whisper-large-v3). */
  voiceInputModel?: string;
  /** Master toggle for autopilot mode (default true). This is a mutable property updated by applySettings. */
  autopilotEnabled?: boolean;
}

export type TurnEmitter = (event: string, data: unknown) => void;

/**
 * Flat SSE frames the session publishes for the question-portal answer queue.
 * Each kind is a member of the core AutopilotEvent union, so they flow through
 * `publish` into the `event: autopilot` stream as `{ status: ev }`.
 * Re-exported from the core AnswerQueue leaf so `server/*` imports of
 * `AnswerFrameEvent` from session.js keep compiling.
 */
export type { AnswerFrameEvent, AnswerApplyResult } from '../core/answer-queue.js';

// Moved verbatim to the core checkpoint-resolution leaf (D2); re-exported so
// server routes and CLI imports keep compiling.
export type { CheckpointDecision, PendingCheckpoint } from '../core/checkpoint-resolution.js';

/**
 * Coordinates agent turn execution for the web adapter: a single serialized
 * turn at a time, SSE event emission, abort support, and the pending critic
 * checkpoint that survives browser reconnects (in-memory only — critic
 * findings are never persisted to state.json).
 */
export class ServerSessionManager {
  private deps: SessionDeps;
  private sessionMessages: ChatMessage[] = [];

  setSessionMessages(messages: ChatMessage[]): void {
    this.sessionMessages = [...messages];
  }

  getSessionMessages(): ChatMessage[] {
    return [...this.sessionMessages];
  }
  private pending: PendingCheckpoint | null = null;
  private activeAbort: AbortController | null = null;
  /** True while the busy guard is held by an answer-queue drain (not by a
   *  chain/agent turn). applyAnswer's isBusy must report "chain turn in
   *  progress", not "drain in progress" — so an idle-path apply can run its
   *  incorporation turn while the drain-owned guard still blocks turns. */
  private drainHoldsGuard = false;

  private roleClients: RoleClients;

  /** Autopilot event bus: live SSE fan-out + reconnect backfill ring (core EventBus leaf). */
  private readonly bus = new EventBus<AutopilotEvent>();

  /** Autopilot driver instance, created on start. */
  private autopilotDriver: AutopilotDriver | null = null;
  private autopilotController: AbortController | null = null;

  /**
   * FIFO queue of portal answers that arrive while a turn is in progress (core
   * AnswerQueue leaf). They apply one at a time between phases or right after
   * the busy turn ends. Duplicate itemIds are replaced, never re-appended.
   */
  private readonly answerQueue = new AnswerQueue({
    apply: (itemId, answer) => this.applyAnswerNow(itemId, answer),
    onFrame: ev => this.publishAnswerFrame(ev)
  });

  constructor(deps: SessionDeps) {
    this.deps = { ...deps, providers: deps.providers.map(p => ({ ...p })), assignments: cloneAssignments(deps.assignments) };
    this._autopilotEnabled = deps.autopilotEnabled ?? true;
    this._voiceInputModel = deps.voiceInputModel?.trim() || DEFAULT_VOICE_INPUT_MODEL;
    this.roleClients = this.buildRoleClients();
    this.recoverStaleResearchGate();
  }

  /**
   * Session-start recovery: a crash/disconnect mid-research leaves open
   * questions flagged meta.researching=true forever (spinner + gate guard
   * skip). Clears the stale tombstones and re-fires the gate for exactly
   * those items so they actually get researched, not just un-stuck.
   */
  private recoverStaleResearchGate(): void {
    const recoveredIds = recoverStaleResearchingItems(this.deps.stateManager);
    const state = this.deps.stateManager.getState();
    for (const id of recoveredIds) {
      const item = (state.portalItems || []).find(i => i.id === id);
      if (item) this.maybeRunResearchGate(item);
    }
  }

  private buildRoleClients(): RoleClients {
    return createRoleClients(
      {
        apiKey: this.deps.apiKey,
        providers: this.deps.providers,
        assignments: this.deps.assignments,
        siteUrl: this.deps.siteUrl,
        appName: this.deps.appName,
        logger: this.deps.logger
      },
      this.deps.clientFactory
    );
  }

  private _autopilotEnabled: boolean;
  private _voiceInputModel: string;

  get autopilotEnabled(): boolean {
    return this._autopilotEnabled;
  }

  get busy(): boolean {
    return this.activeAbort !== null;
  }

  /** Speech-to-text model used for voice dictation. */
  get voiceInputModel(): string {
    return this._voiceInputModel;
  }

  get apiKey(): string {
    return this.deps.apiKey;
  }

  get providers(): ProviderConfig[] {
    return this.deps.providers.map(p => ({ ...p }));
  }

  get assignments(): Assignments {
    return cloneAssignments(this.deps.assignments);
  }

  /** Drafting model (derived from assignments). */
  get model(): string {
    return this.deps.assignments.drafting.model;
  }

  /** Compaction model (derived from assignments). */
  get compactionModel(): string {
    return this.deps.assignments.compaction.model;
  }

  /** Provider config (built-in OpenRouter or user) by id; undefined when unknown. */
  providerById(providerId: string): ProviderConfig | undefined {
    return allProviders(this.deps.apiKey, this.deps.providers).find(p => p.id === providerId);
  }

  /**
   * Transcribes audio via OpenRouter using the session's API key and the
   * configured speech-to-text model (settings → voiceInputModel).
   * Creates a throwaway OpenRouterClient to call transcribeAudio.
   */
  async transcribeAudio(audioBuffer: Buffer, filename: string = 'recording.webm'): Promise<string> {
    const client = new OpenRouterClient({ apiKey: this.deps.apiKey });
    const result = await client.transcribeAudio(audioBuffer, filename, this._voiceInputModel);
    return result.text;
  }

  /** Fresh client for a provider id (for model listing / probing); undefined when unknown. */
  clientFor(providerId: string): ChatClient | undefined {
    const p = this.providerById(providerId);
    if (!p) return undefined;
    return this.deps.clientFactory
      ? this.deps.clientFactory(p)
      : createProviderClient(p, { siteUrl: this.deps.siteUrl, appName: this.deps.appName, logger: this.deps.logger });
  }

  /**
   * Validates and applies provider/assignment changes, then rebuilds role clients.
   * Throws (without mutating) on: reserved/duplicate provider ids, or any role
   * referencing an unknown provider.
   */
  applySettings(update: { providers?: ProviderConfig[]; assignments?: Partial<Assignments>; autopilotEnabled?: boolean; voiceInputModel?: string }): void {
    const providers = update.providers ? update.providers.map(p => ({ ...p })) : this.providers;
    const ids = new Set<string>();
    for (const p of providers) {
      if (!p.id || p.id === OPENROUTER_PROVIDER_ID) throw new Error(`Provider id "${p.id}" is reserved or empty`);
      if (ids.has(p.id)) throw new Error(`Duplicate provider id "${p.id}"`);
      if (!p.name?.trim()) throw new Error(`Provider "${p.id}" needs a name`);
      if (!/^https?:\/\//i.test(p.baseUrl?.trim() ?? '')) {
        throw new Error(`Provider "${p.name}" base URL must start with http:// or https://`);
      }
      p.name = p.name.trim();
      p.baseUrl = p.baseUrl.trim();
      ids.add(p.id);
    }
    const assignments = cloneAssignments(this.deps.assignments);
    for (const role of MODEL_ROLES) {
      const a = update.assignments?.[role];
      if (a) assignments[role] = { providerId: String(a.providerId), model: String(a.model ?? '').trim() };
      if (!assignments[role].model) throw new Error(`Config error: role "${role}" has no model`);
    }
    validateAssignments(assignments, providers);
    this.deps.providers = providers;
    this.deps.assignments = assignments;
    if (typeof update.autopilotEnabled === 'boolean') {
      this._autopilotEnabled = update.autopilotEnabled;
    }
    if (typeof update.voiceInputModel === 'string') {
      const model = update.voiceInputModel.trim();
      if (model && !isValidVoiceInputModel(model)) {
        throw new Error(`Invalid voice input model "${model}": expected a model slug like "openai/whisper-large-v3"`);
      }
      if (model) {
        this._voiceInputModel = model;
      }
    }
    this.roleClients = this.buildRoleClients();
  }


  getPendingCheckpoint(): PendingCheckpoint | null {
    return this.pending;
  }

  /**
   * Switches the active project in the session.
   * Throws if an agent turn is busy or a checkpoint is pending.
   * Clears session messages and updates project path, state manager, and logger.
   */
  switchProject(newPath: string, newStateManager: ProjectStateManager, newLogger?: Logger): void {
    if (this.busy) {
      throw new Error('Cannot switch projects while an agent turn is running.');
    }
    if (this.pending) {
      throw new Error('Cannot switch projects while a review is waiting.');
    }
    this.sessionMessages = [];
    this.deps.projectPath = newPath;
    this.deps.stateManager = newStateManager;
    if (newLogger) {
      this.deps.logger = newLogger;
    }
    this.roleClients = this.buildRoleClients();
  }

  /**
   * Begins a turn: creates and stores an AbortController, marks busy.
   * Throws if already busy (409 conflict).
   */
  private beginTurn(): AbortController {
    if (this.busy) {
      throw new Error('A turn is already in progress');
    }
    const abort = new AbortController();
    this.activeAbort = abort;
    return abort;
  }

  /** Ends the turn: clears the active AbortController.
   *
   * When an owner token is passed, the guard is cleared ONLY if this owner
   * still holds it. Invariant: a guard released early (e.g. autopilotStop)
   * and re-acquired by a newer turn is left untouched by a stale owner's
   * cleanup — so a long-running drain or turn can never null a guard it no
   * longer owns (which would let a concurrent POST /api/turns start while
   * the first is still writing state).
   */
  private endTurn(owner?: AbortController): void {
    if (owner && this.activeAbort !== owner) {
      return;
    }
    this.activeAbort = null;
  }

  /** Aborts the in-flight turn, if any. Returns true when something was aborted. */
  abortActiveTurn(): boolean {
    if (!this.activeAbort) return false;
    this.activeAbort.abort();
    return true;
  }

  // ── Subscriber management for autopilot events ────────────────────────

  /** Tracks per-listener unsubscribe handles for the core bus, keyed by listener. */
  private readonly listenerUnsubs = new Map<(event: AutopilotEvent) => void, () => void>();

  addSubscriber(fn: (event: AutopilotEvent) => void): void {
    this.listenerUnsubs.set(fn, this.bus.subscribe(fn));
  }

  removeSubscriber(fn: (event: AutopilotEvent) => void): void {
    const unsub = this.listenerUnsubs.get(fn);
    if (unsub) {
      this.listenerUnsubs.delete(fn);
      unsub();
    }
  }

  private publish(event: AutopilotEvent): void {
    // Release the busy guard when the autopilot chain finishes
    // (either completed normally, stopped, or errored).
    if (event.kind === 'complete' || event.kind === 'error') {
      this.autopilotDriver = null;
      this.endTurn();
      // Answers queued during the FINAL phase must still apply once the chain
      // ends. drainWithGuard re-acquires the guard for the drain so the
      // answers (and any incorporation turn they trigger) cannot overlap a
      // concurrent POST /api/turns; the core AnswerQueue re-entrancy guard
      // keeps it from overlapping one already in flight.
      void this.drainWithGuard();
    }
    // Portal research gate (post-intake enrichment, async, non-blocking):
    // each NEW open question published at intake kicks a read-only research
    // turn + research critic. Failure = the item stays a plain open question.
    if (event.kind === 'question') {
      this.maybeRunResearchGate(event.item);
    }
    // Answer frames are point-in-time: a reconnect must not re-fire
    // answer_applied (duplicate chat entries) or a stale answer_queued
    // (downgrading an open chip). They still fan out live below; only the
    // reconnect backfill ring skips them.
    const isAnswerFrame =
      event.kind === 'answer_queued' ||
      event.kind === 'answer_applying' ||
      event.kind === 'answer_applied' ||
      event.kind === 'answer_failed';
    // The core EventBus fans out to subscribers always (swallowing individual
    // errors) and skips the reconnect backfill ring when the predicate returns.
    this.bus.publish(event, { skipBackfill: () => isAnswerFrame });
  }

  /** Reconnect-backfill bridge: the recent-events ring lives in the core EventBus leaf. */
  getRecentAutopilotEvents(): AutopilotEvent[] {
    return this.bus.backfill();
  }

  // ── Autopilot driver integration ──────────────────────────────────────

  /** Creates an executeTurn closure bound to this session's role clients. */
  private makeExecuteTurn(abort: AbortController): (opts: {
    userPrompt: string;
    forceSpecialistId: string;
    /** Ripple fix turns: skip the critic loop in the runner. */
    criticDisabled?: boolean;
    signal?: AbortSignal;
    onQuestions?: (items: Array<{
      type: 'question';
      severity: 'normal';
      docPath: string;
      title: string;
      detail?: string;
      source: 'autopilot';
      /** ICD-system topic parsed from the title tag; undefined when untagged. */
      topic?: string;
      /** Untrimmed header text when the header contract cut the title; undefined otherwise. */
      originalTitle?: string;
      /** Format-v2 decision-memo sections parsed tolerantly from the entry; undefined for legacy entries. */
      sections?: import('../core/open-questions-parser.js').QuestionSections;
    }>) => void;
    onStatusUpdate?: (status: string) => void;
    onToolCall?: (tool: string, args: unknown) => void;
  }) => Promise<import('../core/runner.js').TurnResult> {
    return async (opts) => {
      const { CoreRunner: Runner } = await import('../core/runner.js');
      // Answers queued during the just-finished phase apply here, so they land
      // between phases rather than only at chain end.
      await this.answerQueue.drain();
      return Runner.executeTurn({
        userPrompt: opts.userPrompt,
        projectPath: this.deps.projectPath,
        stateManager: this.deps.stateManager,
        client: this.roleClients.drafting.client,
        model: this.roleClients.drafting.model,
        draftingProviderName: this.roleClients.drafting.providerName,
        criticClient: this.roleClients.critic.client,
        criticModel: this.roleClients.critic.model,
        classifierClient: this.roleClients.classifier.client,
        classifierModel: this.roleClients.classifier.model,
        compactionClient: this.roleClients.compaction.client,
        compactionModel: this.roleClients.compaction.model,
        transcriberClient: this.roleClients.transcriber?.client,
        transcriberModel: this.roleClients.transcriber?.model,
        transcriptionEnabled: this.deps.transcriptionEnabled,
        toolRegistry: this.deps.toolRegistry,
        specialistRegistry: this.deps.specialistRegistry,
        sessionMessages: this.sessionMessages,
        compressionThreshold: this.deps.compressionThreshold,
        keepRecentTokens: this.deps.keepRecentTokens,
        logger: this.deps.logger,
        signal: opts.signal ?? abort.signal,
        forceSpecialistId: opts.forceSpecialistId,
        criticDisabled: opts.criticDisabled,
        onQuestions: opts.onQuestions,
        onStatusUpdate: opts.onStatusUpdate,
        onToolCall: opts.onToolCall
      });
    };
  }

  /**
   * Starts the autopilot chain driver. Acquires the busy guard.
   * Throws 409 if a turn is already in progress.
   */
  autopilotStart(): void {
    const abort = this.beginTurn();
    this.autopilotController = abort;

    const deps = {
      stateManager: this.deps.stateManager,
      projectPath: this.deps.projectPath,
      executeTurn: this.makeExecuteTurn(abort),
      logger: this.deps.logger,
      // Release the turn guard on ANY chain exit (not just a published
      // 'complete'/'error'), so a hang or a swallowed terminal event cannot
      // leave the session wedged busy. Owner-token release: when 'complete'
      // was already published, publish() released the chain's guard and
      // drainWithGuard re-acquired it for the post-chain drain — a stale
      // unconditional endTurn here would null that drain-owned guard
      // mid-incorporation and let a concurrent POST /api/turns slip past the
      // busy check. With the token, that cleanup is a no-op.
      onSettled: () => {
        this.endTurn(abort);
        void this.drainWithGuard();
      }
    };

    this.autopilotDriver = new AutopilotDriver(deps, (ev) => this.publish(ev));
    this.autopilotDriver.start();
  }

  /**
   * Stops the autopilot chain driver and releases the turn guard immediately.
   * A wedged chain may never emit 'complete', so relying on publish() alone
   * would leave the session busy (and the Start button dead) forever.
   */
  autopilotStop(): void {
    if (this.autopilotDriver) {
      this.autopilotDriver.stop();
    }
    this.autopilotController = null;
    this.endTurn();
  }

  /** Exposed for the answer route: creates an executeTurn bound to session roles. */
  createAnswerExecuteTurn(): ReturnType<ServerSessionManager['makeExecuteTurn']> {
    const abort = new AbortController();
    return this.makeExecuteTurn(abort);
  }

  // ── Question-portal answer queue ──────────────────────────────────────

  /** Publishes one answer frame through the session's autopilot event bus. */
  private publishAnswerFrame(ev: AnswerFrameEvent): void {
    this.publish(ev);
  }

  /**
   * Enqueues a portal answer. Busy → queued (applies after the current turn
   * ends). Idle → drained immediately and `{ queued: false }` is returned so
   * the caller reports `{ applied: true }`. Throws when the item is unknown,
   * with the route's existing "Portal item not found" text.
   */
  queueAnswer(itemId: string, answer: string): { queued: boolean } {
    const item = (this.deps.stateManager.getState().portalItems || []).find(i => i.id === itemId);
    if (!item) {
      throw new Error(`Portal item not found: ${itemId}`);
    }

    this.answerQueue.enqueue(itemId, answer);

    if (this.busy) {
      this.publishAnswerFrame({ kind: 'answer_queued', itemId, title: item.title });
      return { queued: true };
    }

    void this.drainWithGuard();
    return { queued: false };
  }

  /**
   * Board #53B — ids of answers still pending in the answer queue (queued or
   * mid-drain). The portal list decorates these items so a reload rebuilds the
   * queued chip from data instead of answer frames, which are never
   * SSE-backfilled on reconnect.
   */
  queuedAnswerItemIds(): string[] {
    return this.answerQueue.pendingItemIds;
  }

  /**
   * Drains the answer queue while holding the busy guard, so a concurrent
   * POST /api/turns or /api/autopilot/start cannot slip past the busy check
   * while an answer apply is writing state. Used from the idle queueAnswer
   * path, where busy is known to be false, and from the post-chain release
   * paths (publish complete/error, onSettled). Returns immediately (no drain)
   * if busy became true in the meantime or a drain is already in flight.
   *
   * Guard invariants:
   * - The guard is held for the WHOLE drain, including any incorporation turn
   *   an idle apply triggers — `drainHoldsGuard` marks the guard as
   *   drain-owned so applyAnswer's isBusy ("a chain turn is in progress")
   *   stays false mid-drain while POST /api/turns still sees busy.
   * - endTurn is owner-checked: if the guard was force-released (e.g.
   *   autopilotStop) and re-acquired by a newer turn during the drain, this
   *   drain's cleanup must not null that newer guard.
   */
  private async drainWithGuard(): Promise<void> {
    if (this.busy || this.answerQueue.isDraining) {
      return;
    }
    const abort = this.beginTurn();
    this.drainHoldsGuard = true;
    try {
      await this.answerQueue.drain();
    } finally {
      this.drainHoldsGuard = false;
      this.endTurn(abort);
    }
  }

  /**
   * Drains the answer queue serially. Re-entrancy-guarded by the core
   * AnswerQueue so a second trigger (e.g. the next phase's executeTurn while
   * an immediate apply is running) returns immediately instead of overlapping
   * applies.
   */
  private async runQueuedAnswers(): Promise<void> {
    await this.answerQueue.drain();
  }

  /**
   * Applies one queued answer via the core answer-applier. The core AnswerQueue
   * publishes the applying/applied/failed frames around this call. Never throws
   * out: apply failures fold into `{ ok: false }` so the queue keeps draining.
   */
  private async applyAnswerNow(itemId: string, answer: string): Promise<AnswerApplyResult> {
    try {
      const result = await applyAnswer(this.answerApplierDeps(), itemId, answer);
      this.recordAnswerThreadRow(result.updatedItem, answer);
      return { ok: true, item: result.updatedItem, affectedDocs: result.affectedDocs };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  /**
   * Appends the `kind:'recorded'` thread row for an answer applied through the
   * answer queue — the production answer path (POST /api/portal/:id/answer →
   * queueAnswer → applyAnswerNow). Items with no thread get no row: there is no
   * conversation to attach the committed answer to.
   *
   * `confirmThreadProposal` calls applyAnswer directly and appends its own
   * recorded row, so it never passes through here — the two paths cannot
   * double-append.
   *
   * @param item Item as returned by applyAnswer (post-apply state).
   * @param answer The committed answer text.
   */
  private recordAnswerThreadRow(item: PortalItem, answer: string): void {
    const rows = Array.isArray(item?.meta?.thread) ? item.meta!.thread : [];
    if (rows.length === 0) return;
    this.appendThreadMessage(item.id, {
      role: 'user',
      intent: 'answer',
      kind: 'recorded',
      text: answer,
      ts: Date.now()
    });
  }

  // ── Portal research gate ────────────────────────────────────────────

  /** Item ids with a research-gate run in flight (in-memory dedupe only). */
  private readonly gateInFlight = new Set<string>();

  /** Research-all backfill single-run guard (in-memory, per session). */
  private researchAllInFlight = false;

  /**
   * Fires the research gate for one newly-intaken open question — async,
   * never awaited by the publishing turn. Dedupe: items already
   * researching/proposed/auto-applied or with a run in flight are skipped.
   */
  private maybeRunResearchGate(item: PortalItem): void {
    if (!item || item.type !== 'question' || item.status !== 'open' || !item.docPath) return;
    if (item.meta?.researching === true || item.meta?.proposedAnswer || item.meta?.autoApplied) return;
    if (this.gateInFlight.has(item.id)) return;
    this.gateInFlight.add(item.id);
    // Per-item wall-clock cap (same race as the legacy backfill loop): a hung
    // research turn / verify fetch / critic call must not wedge intake
    // forever. On timeout the hung run is abandoned (not cancelled — no
    // AbortSignal), the researching flag is cleared and the item stays a
    // plain open question.
    void runGateWithTimeout(this.buildResearchGateDeps(), item)
      .then(({ outcome, timedOut }) => {
        if (timedOut) {
          setItemResearching(this.deps.stateManager, item.id, false);
          this.deps.logger?.warn(`Research gate timed out for item ${item.id} after ${RESEARCH_GATE_ITEM_TIMEOUT_MS}ms`);
          this.publish({ kind: 'status', message: `Research timed out for: ${shortResearchTitle(item.title)} — left as open question` });
          return;
        }
        // Enrichment: the same format-v2 sections + short-title rewrite the
        // legacy backfill applies, from real research output only.
        if (outcome.research?.answer.trim()) {
          const sections = buildQuestionSections(outcome.research, outcome.assessment);
          if (Object.keys(sections).length > 0) {
            enrichItem(this.deps.stateManager, item.id, sections);
          }
        }
      })
      .catch(err => this.deps.logger?.warn(`Research gate failed for item ${item.id}: ${err?.message ?? err}`))
      .finally(() => {
        this.gateInFlight.delete(item.id);
      });
  }

  /**
   * Starts the legacy backfill ("Research open questions") for POST
   * /api/portal/research-all: runs runResearchBackfill over the eligible
   * legacy items (listBackfillEligibleItems — not researching/proposed/
   * auto-applied, no meta.sections yet), sequentially, sharing gateInFlight
   * dedupe with the per-item gate. Single-run guarded; the route refuses
   * while the autopilot chain runs. Publishes the kickoff status event;
   * per-item events come from the gate machinery itself. Returns the
   * eligible-item count (0 → still started, nothing to do).
   */
  startResearchBackfill(): { started: boolean; count: number } {
    if (this.researchAllInFlight) return { started: false, count: 0 };
    this.researchAllInFlight = true;
    try {
      const eligible = listBackfillEligibleItems(this.deps.stateManager, this.gateInFlight);
      this.publish({ kind: 'status', message: `Researching ${eligible.length} open questions…` });
      void runResearchBackfill({ ...this.buildResearchGateDeps(), inFlight: this.gateInFlight })
        .catch(err => this.deps.logger?.warn(`Research-all backfill failed: ${err?.message ?? err}`))
        .finally(() => {
          this.researchAllInFlight = false;
        });
      return { started: true, count: eligible.length };
    } catch (err) {
      this.researchAllInFlight = false;
      throw err;
    }
  }

  /** Research-gate deps: drafting client for the loop, critic client for the rubric. */
  private buildResearchGateDeps(): ResearchGateDeps {
    return {
      client: this.roleClients.drafting.client,
      model: this.roleClients.drafting.model,
      criticClient: this.roleClients.critic.client,
      criticModel: this.roleClients.critic.model,
      projectPath: this.deps.projectPath,
      stateManager: this.deps.stateManager,
      toolRegistry: this.deps.toolRegistry,
      logger: this.deps.logger,
      emitStatus: (message) => this.publish({ kind: 'status', message }),
      applyAnswer: async (itemId, answer) => {
        const result = await applyAnswer(this.answerApplierDeps(), itemId, answer, { provenance: 'research-gate' });
        return { updatedItem: result.updatedItem, appendedText: result.appendedText };
      },
      // Verified-source corroboration: fetch the top cited URL with the
      // web_fetch handler (SSRF-guarded) so the critic grades real content.
      verifySource: async (url) => {
        const res = await webFetchHandler.execute(
          { url },
          { projectPath: this.deps.projectPath, stateManager: this.deps.stateManager }
        );
        return res.success ? { ok: true, excerpt: String(res.result ?? '') } : { ok: false };
      }
    };
  }

  /** Shared AnswerApplierDeps (answer queue drain, research gate, confirm route). */
  private answerApplierDeps(): AnswerApplierDeps {
    return {
      stateManager: this.deps.stateManager,
      projectPath: this.deps.projectPath,
      executeTurn: this.createAnswerExecuteTurn(),
      isBusy: () => this.busy && !this.drainHoldsGuard,
      emitStatus: (message) => this.publish({ kind: 'status', message }),
      emitPhase: (phaseId, status, name) => this.publish({ kind: 'phase', phaseId, status, name }),
      emitEvent: (ev) => this.publish(ev)
    };
  }

  /**
   * Confirms a research proposal (user YES or edited text): routes the answer
   * through the SAME answer-applier path with 'user-confirmed-research'
   * provenance. Throws on item-not-found / no-longer-open (route maps codes).
   */
  async applyConfirmedProposal(itemId: string, answer: string): Promise<void> {
    await applyAnswer(this.answerApplierDeps(), itemId, answer, { provenance: 'user-confirmed-research' });
  }

  /** Core undo wrapper with SSE status (route for POST /api/portal/:id/undo-auto). */
  async undoAutoAppliedAnswer(itemId: string): Promise<PortalItem> {
    return undoAutoApplied(
      {
        stateManager: this.deps.stateManager,
        projectPath: this.deps.projectPath,
        logger: this.deps.logger,
        emitStatus: (message) => this.publish({ kind: 'status', message })
      },
      itemId
    );
  }

  // ── T-C answer-thread (advisory specialist Q&A) ────────────────────

  /** Item ids with an advisory thread turn in flight (in-memory lock only). */
  private readonly threadInFlight = new Set<string>();

  /**
   * Mutates one item's thread rows: synchronous read-fresh → mutate → save
   * (atomic vs other async work in this process). Returns null when the item
   * no longer exists. Trimming is the caller's business (appendThreadMessage).
   */
  private mutateThread(
    itemId: string,
    mutate: (rows: PortalThreadMessage[]) => PortalThreadMessage[]
  ): PortalItem | null {
    const state = this.deps.stateManager.getState();
    const item = (state.portalItems || []).find(i => i.id === itemId);
    if (!item) return null;
    const prior = Array.isArray(item.meta?.thread) ? item.meta!.thread : [];
    item.meta = { ...(item.meta || {}), thread: mutate(prior) };
    item.updatedAt = new Date().toISOString();
    this.deps.stateManager.saveState(state);
    return item;
  }

  /**
   * Appends one thread message to a portal item. Trims past
   * THREAD_MESSAGE_CAP via the pure core rule (keeps the first row and every
   * `recorded`/`proposal` row). Returns null when the item no longer exists.
   */
  private appendThreadMessage(itemId: string, message: PortalThreadMessage): PortalItem | null {
    return this.mutateThread(itemId, rows => appendThreadRow(rows, message));
  }

  /**
   * One transcript rendering shared by the advisory and conclude turns.
   * Proposal rows are drafts, not conversation, so they are dropped; a recorded
   * row is labelled as the user's committed answer.
   *
   * @param history Thread rows, oldest first.
   * @returns One labelled line per non-proposal row.
   */
  private threadTranscript(history: PortalThreadMessage[]): string {
    return history
      .filter(m => m.kind !== 'proposal')
      .map(m => {
        if (m.role !== 'user') return `Specialist: ${m.text}`;
        return m.kind === 'recorded' ? `User (recorded answer): ${m.text}` : `User: ${m.text}`;
      })
      .join('\n');
  }

  /** Specialist package for the item's doc (docs/CONOPS.md → 'conops'); general fallback. */
  private specialistForDoc(docPath?: string): import('../specialists/types.js').SpecialistPackage {
    const base = docPath ? path.basename(docPath).replace(/\.md$/i, '').toLowerCase() : '';
    return this.deps.specialistRegistry.get(base) ?? this.deps.specialistRegistry.get('general')!;
  }

  /**
   * One advisory thread turn for ONE open question: quick read-only
   * specialist Q&A (runAgentToolLoop, THREAD_ALLOWED_TOOLS, fresh
   * priorMessages). Returns the sanitized plain-text reply, or null when the
   * turn produced nothing usable. Never throws (ESC abort propagates).
   */
  private async runAdvisoryTurn(item: PortalItem): Promise<string | null> {
    const specialist = this.specialistForDoc(item.docPath);
    const history = (Array.isArray(item.meta?.thread) ? item.meta!.thread : []) as PortalThreadMessage[];
    const sections = item.meta?.sections;
    const parts = [
      `OPEN QUESTION: ${item.title}`,
      sections
        ? `RECORDED SECTIONS:\n${[
            sections.bluf ? `BLUF: ${sections.bluf}` : '',
            sections.findings ? `Research findings: ${sections.findings}` : '',
            sections.suggestion ? `Main suggestion: ${sections.suggestion}` : '',
            sections.alternatives ? `Alternatives: ${sections.alternatives}` : '',
            sections.defer ? `Defer: ${sections.defer}` : ''
          ].filter(Boolean).join('\n')}`
        : '',
      item.meta?.proposedAnswer ? `RESEARCH PROPOSAL: ${item.meta.proposedAnswer.answer}` : '',
      history.length > 0 ? `THREAD HISTORY (oldest first):\n${this.threadTranscript(history)}` : '',
      `The user's new question follows. Reply with plain text only (no headings, no markdown fences), per your instructions.`
    ];
    const userMessage = parts.filter(Boolean).join('\n\n');
    try {
      const { runAgentToolLoop } = await import('../core/agent-loop.js');
      const result = await runAgentToolLoop({
        client: this.roleClients.drafting.client,
        model: this.roleClients.drafting.model,
        systemPrompt: `${specialist.systemPrompt}\n\n${ADVISORY_SYSTEM_DIRECTIVE}`,
        userMessage,
        toolRegistry: this.deps.toolRegistry,
        allowedTools: [...THREAD_ALLOWED_TOOLS],
        context: { projectPath: this.deps.projectPath, stateManager: this.deps.stateManager },
        maxTurns: THREAD_MAX_TURNS,
        priorMessages: [],
        logger: this.deps.logger,
        docId: 'advisory-thread'
      });
      const reply = (result.finalResponse || '')
        .split('\n')
        .map(sanitizeResearchLine)
        .join('\n')
        .trim();
      return reply ? reply.slice(0, THREAD_REPLY_CHAR_CAP) : null;
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err; // ESC must abort, not degrade silently.
      this.deps.logger?.warn(`Advisory thread turn failed for item ${item.id}: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Handles one user message on an open question's advisory thread (route for
   * POST /api/portal/:id/thread). Persists the user message, runs the
   * read-only advisory turn, persists the sanitized specialist reply, and
   * emits a status event. Serialized per item via threadInFlight — a second
   * turn on the SAME item while one is in flight throws (route maps to 409);
   * different items and chain turns are independent. Throws on
   * item-not-found / non-open / non-question items.
   *
   * `intent` 'ask' (default) is the unchanged advisory path; 'answer' marks the
   * persisted user row `intent:'answer'` and is otherwise identical.
   */
  async postThreadMessage(itemId: string, text: string, intent: 'ask' | 'answer' = 'ask'): Promise<PortalItem> {
    const state = this.deps.stateManager.getState();
    const item = (state.portalItems || []).find(i => i.id === itemId);
    if (!item) throw new Error(`Portal item not found: ${itemId}`);
    if (item.type !== 'question' || item.status !== 'open') {
      throw new Error('Thread is only available on open question items');
    }
    if (this.threadInFlight.has(itemId)) {
      throw new Error(`An advisory reply is already in progress for this item: ${itemId}`);
    }
    this.threadInFlight.add(itemId);
    try {
      this.appendThreadMessage(itemId, {
        role: 'user',
        text,
        ts: Date.now(),
        // An answer-intent row is a committed answer: `kind:'recorded'` keeps it
        // out of the 20-row trim (recorded rows are never dropped).
        ...(intent === 'answer' ? { intent, kind: 'recorded' as const } : {})
      });
      const fresh = (this.deps.stateManager.getState().portalItems || []).find(i => i.id === itemId)!;
      const reply = await this.runAdvisoryTurn(fresh);
      if (reply) {
        this.appendThreadMessage(itemId, { role: 'specialist', text: reply, ts: Date.now() });
        this.publish({ kind: 'status', message: 'Advisory reply added' });
      } else {
        this.publish({ kind: 'status', message: 'Advisory reply failed — try again' });
      }
      const updated = (this.deps.stateManager.getState().portalItems || []).find(i => i.id === itemId);
      return updated ?? item;
    } finally {
      this.threadInFlight.delete(itemId);
    }
  }

  /**
   * One read-only conclude turn over the whole thread: asks the specialist for
   * a short proposed answer + a one-line rationale (same allow-list and turn
   * budget as the advisory turn) and parses them back out of the reply.
   * Returns null when nothing usable came back — including a reply WITHOUT the
   * `PROPOSED ANSWER:` marker, so raw reply text is never recorded; throws only
   * on abort.
   */
  private async runConcludeTurn(
    item: PortalItem,
    history: PortalThreadMessage[]
  ): Promise<{ answer: string; rationale: string } | null> {
    const specialist = this.specialistForDoc(item.docPath);
    const transcript = this.threadTranscript(history);
    const userMessage = [
      `OPEN QUESTION: ${item.title}`,
      item.meta?.proposedAnswer ? `RESEARCH PROPOSAL: ${item.meta.proposedAnswer.answer}` : '',
      `THREAD (oldest first):\n${transcript}`,
      CONCLUDE_INSTRUCTION
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const { runAgentToolLoop } = await import('../core/agent-loop.js');
      const result = await runAgentToolLoop({
        client: this.roleClients.drafting.client,
        model: this.roleClients.drafting.model,
        systemPrompt: `${specialist.systemPrompt}\n\n${CONCLUDE_SYSTEM_DIRECTIVE}`,
        userMessage,
        toolRegistry: this.deps.toolRegistry,
        allowedTools: [...THREAD_ALLOWED_TOOLS],
        context: { projectPath: this.deps.projectPath, stateManager: this.deps.stateManager },
        maxTurns: THREAD_MAX_TURNS,
        priorMessages: [],
        logger: this.deps.logger,
        docId: 'conclude-thread'
      });
      const reply = (result.finalResponse || '')
        .split('\n')
        .map(sanitizeResearchLine)
        .join('\n')
        .trim();
      if (!reply) return null;
      const rationaleIdx = reply.search(/RATIONALE:/i);
      const answerBlock = rationaleIdx >= 0 ? reply.slice(0, rationaleIdx) : reply;
      const rationaleRaw = rationaleIdx >= 0 ? reply.slice(rationaleIdx) : '';
      const marker = CONCLUDE_ANSWER_MARKER_RE.exec(answerBlock);
      // No marker → the reply is prompt text, not an answer. Record nothing: the
      // caller throws so the user retries instead of recording the wrong text.
      if (!marker) return null;
      // Order matters: drop the leaked sentence first, then the residual
      // markdown wrappers it may have been wrapped in (`**… .** Nothing …`).
      const answer = stripNonCommitSentence(answerBlock.slice(marker.index + marker[0].length).replace(/\s+/g, ' '))
        .replace(/^[\s*_`#]+/, '')
        .replace(/[\s*_`]+$/, '')
        .slice(0, CONCLUDE_ANSWER_CHAR_CAP);
      if (!answer) return null;
      const rationale = rationaleRaw
        .replace(/^[*_]{0,2}\s*RATIONALE\s*:?\s*[*_]{0,2}\s*/i, '')
        .split('\n')[0]
        .replace(/\s+/g, ' ')
        .replace(/^[\s*_`#]+/, '')
        .replace(/[\s*_`]+$/, '')
        .trim();
      return { answer, rationale };
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err; // ESC must abort, not degrade silently.
      this.deps.logger?.warn(`Conclude turn failed for item ${item.id}: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Concludes an open question's conversation: ONE read-only turn drafts a
   * short proposed answer + rationale, appended as a pending `kind:'proposal'`
   * row (any earlier pending proposal flips to 'superseded'). Never writes a
   * doc — only confirmThreadProposal records. Throws on item-not-found /
   * non-open / no-specialist-reply / in-flight (route maps the codes).
   */
  async concludeThread(itemId: string): Promise<PortalItem> {
    const state = this.deps.stateManager.getState();
    const item = (state.portalItems || []).find(i => i.id === itemId);
    if (!item) throw new Error(`Portal item not found: ${itemId}`);
    if (item.type !== 'question' || item.status !== 'open') {
      throw new Error('Thread is only available on open question items');
    }
    if (this.threadInFlight.has(itemId)) {
      throw new Error(`An advisory reply is already in progress for this item: ${itemId}`);
    }
    const history = (Array.isArray(item.meta?.thread) ? item.meta!.thread : []) as PortalThreadMessage[];
    // A concluded draft needs at least one real specialist reply (proposal
    // rows are drafts, not replies).
    if (!history.some(m => m.role === 'specialist' && (m.kind ?? 'message') === 'message')) {
      throw new Error('No specialist reply in this thread to conclude');
    }
    this.threadInFlight.add(itemId);
    try {
      const turn = await this.runConcludeTurn(item, history);
      if (!turn) throw new Error('The specialist returned no PROPOSED ANSWER block — try again');
      // Re-read after the turn: an answer/confirm that landed while the turn ran
      // closes the item, and a proposal on a closed item can never be confirmed
      // (409) and must not render — abort without writing a row.
      const freshItem = (this.deps.stateManager.getState().portalItems || []).find(i => i.id === itemId);
      if (!freshItem || freshItem.status !== 'open') {
        throw new Error(`Portal item no longer open (${freshItem?.status ?? 'missing'})`);
      }
      // Recorded rows are part of the conversation the draft is based on (the
      // conclude transcript renders them); proposal rows are drafts, not messages.
      const freshHistory = (Array.isArray(freshItem.meta?.thread) ? freshItem.meta!.thread : []) as PortalThreadMessage[];
      const basedOn = freshHistory.filter(m => m.kind !== 'proposal').length;
      const updated = this.mutateThread(itemId, rows =>
        appendThreadRow(
          rows.map(r =>
            r.kind === 'proposal' && r.proposal?.status === 'pending'
              ? { ...r, proposal: { ...r.proposal!, status: 'superseded' as const } }
              : r
          ),
          {
            role: 'specialist',
            text: turn.rationale || 'Drafted from the conversation above.',
            ts: Date.now(),
            kind: 'proposal',
            proposal: { status: 'pending', basedOn, text: turn.answer }
          }
        )
      );
      this.publish({ kind: 'status', message: 'Proposed answer drafted from the conversation' });
      return updated ?? item;
    } finally {
      this.threadInFlight.delete(itemId);
    }
  }

  /**
   * Records an accepted thread proposal as the item's answer through the SAME
   * core applier the answer queue drains (applyAnswer), then flips the row to
   * 'accepted' and appends the `kind:'recorded'` row. `editedText` wins over
   * the drafted text. Throws on item-not-found / unknown ts / not-pending /
   * item-no-longer-open / turn-in-flight (route maps the codes).
   */
  async confirmThreadProposal(itemId: string, proposalTs: number, editedText?: string): Promise<PortalItem> {
    const state = this.deps.stateManager.getState();
    const item = (state.portalItems || []).find(i => i.id === itemId);
    if (!item) throw new Error(`Portal item not found: ${itemId}`);
    const row = (Array.isArray(item.meta?.thread) ? item.meta!.thread : []).find(
      r => r.kind === 'proposal' && r.ts === proposalTs
    );
    if (!row) throw new Error(`No thread proposal at ts ${proposalTs} for item ${itemId}`);
    if (row.proposal?.status !== 'pending') {
      throw new Error(`Thread proposal is no longer pending (${row.proposal?.status ?? 'unknown'})`);
    }
    const edited = (editedText ?? '').trim();
    const finalText = edited || row.proposal.text;
    if (!finalText) throw new Error('No answer text to record');
    // Same pipeline as POST /api/portal/:id/answer (applyAnswer); no duplicated
    // doc/portal/incorporation logic here. applyAnswer is an unguarded doc
    // read-modify-write, so this path MUST hold the busy guard (the same pair
    // drainWithGuard uses): a chain/agent turn in flight would otherwise lose
    // the pending block, and a drain in flight would let a SECOND incorporation
    // turn start (`isBusy` is false while the drain owns the guard). The guard
    // covers the doc write AND the row flip below. drainHoldsGuard marks the
    // guard as ours so applyAnswer's own incorporation turn may run.
    if (this.busy) throw new Error('A turn is running — retry in a moment');
    const abort = this.beginTurn();
    this.drainHoldsGuard = true;
    let updated: PortalItem | null;
    try {
      await applyAnswer(this.answerApplierDeps(), itemId, finalText);
      // Inside the guard too: the row flip is part of the same commit.
      updated = this.mutateThread(itemId, rows => {
        const next = rows.map(r =>
          r.kind === 'proposal' && r.ts === proposalTs
            ? {
                ...r,
                proposal: { ...r.proposal!, status: 'accepted' as const, ...(edited ? { editedText: edited } : {}) }
              }
            : r
        );
        return appendThreadRow(next, {
          role: 'user',
          intent: 'answer',
          kind: 'recorded',
          text: finalText,
          ts: Date.now()
        });
      });
    } finally {
      this.drainHoldsGuard = false;
      this.endTurn(abort);
    }
    this.publish({ kind: 'status', message: 'Proposed answer recorded' });
    return updated ?? item;
  }

  /**
   * Rejects a pending thread proposal: flips the row to 'rejected' and records
   * nothing (no doc write, no answer). Throws on item-not-found / unknown ts /
   * not-pending (route maps the codes).
   */
  async rejectThreadProposal(itemId: string, proposalTs: number): Promise<PortalItem> {
    const state = this.deps.stateManager.getState();
    const item = (state.portalItems || []).find(i => i.id === itemId);
    if (!item) throw new Error(`Portal item not found: ${itemId}`);
    const row = (Array.isArray(item.meta?.thread) ? item.meta!.thread : []).find(
      r => r.kind === 'proposal' && r.ts === proposalTs
    );
    if (!row) throw new Error(`No thread proposal at ts ${proposalTs} for item ${itemId}`);
    if (row.proposal?.status !== 'pending') {
      throw new Error(`Thread proposal is no longer pending (${row.proposal?.status ?? 'unknown'})`);
    }
    const updated = this.mutateThread(itemId, rows =>
      rows.map(r =>
        r.kind === 'proposal' && r.ts === proposalTs
          ? { ...r, proposal: { ...r.proposal!, status: 'rejected' as const } }
          : r
      )
    );
    return updated ?? item;
  }

  autopilotResume(docId?: string): void {
    // Prevent double-start: if already running, reject.
    const st = this.deps.stateManager.getState();
    if (st.autopilot?.running || this.autopilotDriver) {
      throw new Error('Autopilot is already running');
    }
    if (!this.autopilotDriver) {
      // Create a fresh driver if none exists
      const abort = this.beginTurn();
      this.autopilotController = abort;

      const deps = {
        stateManager: this.deps.stateManager,
        projectPath: this.deps.projectPath,
        executeTurn: this.makeExecuteTurn(abort),
        logger: this.deps.logger,
        onSettled: () => {
          // Owner-token release (same rationale as autopilotStart): if
          // 'complete' was already published, the guard now belongs to the
          // post-chain drain — this stale owner's endTurn must not null it.
          this.endTurn(abort);
          // Guarded drain: the post-chain answer apply (and any incorporation
          // turn it triggers) holds the busy guard so a concurrent turn start
          // cannot slip in (see drainWithGuard).
          void this.drainWithGuard();
        }
      };

      this.autopilotDriver = new AutopilotDriver(deps, (ev) => this.publish(ev));
    }
    this.autopilotDriver.resume(docId);
  }

  /**
   * Runs one agent turn, emitting SSE-style events through the emitter:
   * status, tool_call, checkpoint, complete, error.
   */
  async runTurn(prompt: string, emit: TurnEmitter): Promise<TurnResult> {
    const abort = this.beginTurn();

    try {
      const result = await CoreRunner.executeTurn({
        userPrompt: prompt,
        projectPath: this.deps.projectPath,
        stateManager: this.deps.stateManager,
        client: this.roleClients.drafting.client,
        model: this.roleClients.drafting.model,
        draftingProviderName: this.roleClients.drafting.providerName,
        criticClient: this.roleClients.critic.client,
        criticModel: this.roleClients.critic.model,
        classifierClient: this.roleClients.classifier.client,
        classifierModel: this.roleClients.classifier.model,
        compactionClient: this.roleClients.compaction.client,
        compactionModel: this.roleClients.compaction.model,
        transcriberClient: this.roleClients.transcriber?.client,
        transcriberModel: this.roleClients.transcriber?.model,
        transcriptionEnabled: this.deps.transcriptionEnabled,
        toolRegistry: this.deps.toolRegistry,
        specialistRegistry: this.deps.specialistRegistry,
        sessionMessages: this.sessionMessages,
        compressionThreshold: this.deps.compressionThreshold,
        keepRecentTokens: this.deps.keepRecentTokens,
        logger: this.deps.logger,
        signal: abort.signal,
        onStatusUpdate: status => emit('status', { status }),
        onToolCall: (tool, args) => emit('tool_call', { tool, args })
      });

      this.sessionMessages = result.sessionMessages;

      if (result.requiresReview) {
        this.pending = {
          specialistId: result.specialistId,
          specialistName: result.specialistName,
          output: result.output,
          criticResult: result.criticResult,
          createdAt: new Date().toISOString()
        };
        emit('checkpoint', this.pending);
      }

      emit('complete', {
        specialistId: result.specialistId,
        specialistName: result.specialistName,
        output: result.output,
        criticResult: result.criticResult,
        requiresReview: result.requiresReview,
        aborted: result.aborted ?? false
      });

      return result;
    } finally {
      // Drain queued answers while the turn's busy guard is still held so a
      // concurrent POST /api/turns (or /api/autopilot/start) cannot pass the
      // busy check while an answer apply is writing state.json.
      await this.answerQueue.drain();
      this.endTurn();
    }
  }

  /**
   * Resolves the pending checkpoint. Thin adapter over the core
   * `resolvePendingCheckpoint` leaf: builds outPath, injects the disk read
   * (verbatim fs read + '# ' check), the approval call (with the session-bound
   * change-impact callback), the post-approval active-phase read, and the
   * saved-path normalization. Clears the pending checkpoint on success;
   * approval errors propagate (the checkpoint stays pending).
   */
  async resolveCheckpoint(decision: CheckpointDecision, feedback?: string): Promise<{
    status: 'approved' | 'revision_requested' | 'discarded';
    savedPath?: string;
    revisionPrompt?: string;
    nextPhase?: string;
  }> {
    const pending = this.pending;
    if (!pending) {
      throw new Error('No checkpoint is pending');
    }

    const { projectPath, stateManager } = this.deps;
    const outPath = path.join(projectPath, 'docs', `${pending.specialistId.toUpperCase()}.md`);

    const outcome = await resolvePendingCheckpoint(pending, decision, feedback, {
      outPath,
      readDiskArtifact: out => {
        try {
          const onDisk = fs.readFileSync(out, 'utf-8').trim();
          return onDisk && onDisk.startsWith('# ') ? onDisk : null;
        } catch {
          // no disk file yet — use the turn output
          return null;
        }
      },
      readActivePhase: () => stateManager.getState().workflow.activePhase,
      normalizeSavedPath: abs => path.relative(projectPath, abs).replace(/\\/g, '/'),
      approve: async args => {
        await applyArtifactApproval({
          ...args,
          projectPath,
          stateManager,
          runChangeImpact: phaseId => this.runChangeImpactForApproval(phaseId)
        });
      }
    });

    this.pending = null;
    return outcome;
  }

  /**
   * Runs the change-impact package programmatically with the drafting client
   * (web parity with the CLI re-approval flow). Returns affected phase ids.
   * Kept in the server layer (not core) because it imports the agent tool loop.
   */
  async runChangeImpactForApproval(phaseId: string): Promise<string[]> {
    const { projectPath, stateManager, toolRegistry } = this.deps;
    try {
      const { runAgentToolLoop } = await import('../core/agent-loop.js');
      const { changeImpactPackage } = await import('../specialists/packages/change-impact/index.js');
      const impactResult = await runAgentToolLoop({
        client: this.roleClients.drafting.client,
        model: this.roleClients.drafting.model,
        systemPrompt: changeImpactPackage.systemPrompt,
        userMessage: `Analyze the impact of changes to ${phaseId}. Compare the current docs/${phaseId}.md against all other approved/draft documents in docs/. Identify which downstream documents are now inconsistent and what specific sections/interfaces/requirements are affected.`,
        toolRegistry,
        allowedTools: changeImpactPackage.allowedTools,
        context: { projectPath, stateManager }
      });
      return parseAffectedPhaseIds(impactResult.finalResponse);
    } catch (err: any) {
      this.deps.logger?.error(`Change-impact analysis failed: ${err?.message ?? err}`);
      return [];
    }
  }
}

function cloneAssignments(a: Assignments): Assignments {
  return {
    drafting: { ...a.drafting },
    critic: { ...a.critic },
    classifier: { ...a.classifier },
    compaction: { ...a.compaction },
    transcriber: { ...a.transcriber }
  };
}
