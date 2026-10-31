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
import { applyAnswer } from '../core/answer-applier.js';
import { AnswerQueue, AnswerApplyResult, AnswerFrameEvent } from '../core/answer-queue.js';
import { EventBus } from '../core/event-bus.js';

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

  /** Ends the turn: clears the active AbortController. */
  private endTurn(): void {
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
      // ends. The core AnswerQueue re-entrancy guard keeps this drain from
      // overlapping one already in flight (e.g. makeExecuteTurn's between-phase
      // drain).
      void this.answerQueue.drain();
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
    signal?: AbortSignal;
    onQuestions?: (items: Array<{
      type: 'question';
      severity: 'normal';
      docPath: string;
      title: string;
      detail?: string;
      source: 'autopilot';
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
      // leave the session wedged busy. Release is idempotent.
      onSettled: () => {
        this.endTurn();
        void this.answerQueue.drain();
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
   * path, where busy is known to be false. Returns immediately (no drain) if
   * busy somehow became true in the meantime.
   */
  private async drainWithGuard(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.beginTurn();
    try {
      await this.answerQueue.drain();
    } finally {
      this.endTurn();
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
      const result = await applyAnswer(
        {
          stateManager: this.deps.stateManager,
          projectPath: this.deps.projectPath,
          executeTurn: this.createAnswerExecuteTurn(),
          isBusy: () => this.busy,
          runChangeImpact: (phaseId) => this.runChangeImpactForApproval(phaseId) ?? Promise.resolve([])
        },
        itemId,
        answer
      );
      return { ok: true, item: result.updatedItem, affectedDocs: result.affectedDocs };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
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
          this.endTurn();
          void this.answerQueue.drain();
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
