import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES, defaultAutopilotState } from '../workspace/state.js';
import { PortalItem, PortalItemType, AutopilotState, ProjectState } from '../workspace/types.js';
import { TurnResult } from './runner.js';
import { approveArtifact } from './approvals.js';
import { addPortalItem, answerPortalItem, listPortalItems, type PortalItemInput } from './question-portal.js';
import type { QuestionSections } from './open-questions-parser.js';
import { PENDING_INCORPORATION_MARKER, stripPendingBlock, extractPendingBlock, INCORPORATION_CRITIC_FOCUS, buildIncorporationPrompt } from './incorporation-prompt.js';
import { runRippleScan, summarizeDiff, RippleSource, RippleDeps } from './ripple.js';
import { Logger } from '../util/logger.js';

export type AutopilotDocStatus = 'idle' | 'drafting' | 'critic' | 'revising' | 'passed' | 'auto-approved' | 'revised' | 'parked';

export type AutopilotEvent =
  | { kind: 'start'; total: number }
  | { kind: 'phase'; phaseId: string; status: AutopilotDocStatus; name: string }
  | { kind: 'question'; item: PortalItem }
  | { kind: 'parked'; item: PortalItem }
  | { kind: 'status'; message: string }
  | { kind: 'tool_call'; tool: string; args: unknown }
  | { kind: 'complete'; result: { passed: string[]; parked: string[] }; reason: 'finished' | 'stopped' }
  | { kind: 'error'; message: string }
  // Question-portal answer queue frames (published by the server session through
  // the shared event bus). The SSE writer wraps these as { status: ev } on the
  // autopilot stream; the CLI ignores kinds it does not render.
  | { kind: 'answer_queued'; itemId: string; title: string }
  | { kind: 'answer_applying'; itemId: string }
  | { kind: 'answer_applied'; itemId: string; item: PortalItem; affectedDocs: string[] }
  | { kind: 'answer_failed'; itemId: string; error: string };

export interface AutopilotDeps {
  stateManager: ProjectStateManager;
  projectPath: string;
  executeTurn: (opts: {
    userPrompt: string;
    forceSpecialistId: string;
    /** Ripple fix turns: skip the critic loop in the runner. */
    criticDisabled?: boolean;
    /** Scoped evaluation directive threaded to the critic (incorporation turns). */
    criticFocus?: string;
    /** P3+P6 pre-turn research stages (document specialists only; runner gates). */
    preflight?: boolean;
    /** Fast-retry path skip for the pre-turn research stages. */
    skipPreflight?: boolean;
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
      /** Format-v2 decision-memo sections parsed tolerantly from the entry; undefined for legacy entries. */
      sections?: QuestionSections;
    }>) => void;
    /** Live status updates from the runner (discovery, drafting, critic). */
    onStatusUpdate?: (status: string) => void;
    /** Live tool call notifications from the runner. */
    onToolCall?: (tool: string, args: unknown) => void;
  }) => Promise<TurnResult>;
  /**
   * Optional settlement hook fired exactly once whenever the chain ends, on
   * ANY exit path (normal finish, error, abort, or a no-op start). The server
   * adapter uses this to release the turn guard in a finally so a chain that
   * never emits 'complete' cannot leave the session wedged busy.
   */
  onSettled?: () => void;
  /** Optional logger for routing decisions (pending-answer incorporation). */
  logger?: Logger;
}

/**
 * Runner onQuestions payload → portal input; the flat ICD-system topic tag
 * parsed from the question title lands on meta.topic (undefined when untagged).
 */
function questionPayloadToPortalInput(item: {
  type: 'question';
  severity: 'normal';
  docPath: string;
  title: string;
  detail?: string;
  source: 'autopilot';
  topic?: string;
  sections?: QuestionSections;
}): PortalItemInput {
  const { topic, sections, ...rest } = item;
  // Format-v2 decision-memo sections land on meta.sections alongside the topic tag.
  const meta = topic || sections
    ? { ...(topic ? { topic } : {}), ...(sections ? { sections } : {}) }
    : undefined;
  return { ...rest, meta };
}

/**
 * SHA-256 hex digest of doc content — compared against the approved
 * artifact's approvedContentHash for the hash-based ripple trigger.
 */
function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Resolves the doc file content for a specialist phase. Reads from the
 * standard `docs/{ID}.md` location on disk.
 */
function readDocContent(projectPath: string, specialistId: string): string | null {
  const docPath = path.join(projectPath, 'docs', `${specialistId.toUpperCase()}.md`);
  try {
    if (fs.existsSync(docPath)) {
      return fs.readFileSync(docPath, 'utf-8');
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Core autopilot chain driver. Drives the 13-document specialist chain
 * hands-off with critic gating (park on criticFailed), question capture,
 * resume/park/resume lifecycle, and abort support.
 *
 * This driver is I/O-agnostic: it receives `executeTurn` as a closure and
 * never constructs a CoreRunner. The server adapter provides the closure
 * wired with the real runner.
 */
export class AutopilotDriver {
  private deps: AutopilotDeps;
  private onEvent?: (ev: AutopilotEvent) => void;
  private abortController: AbortController | null = null;
  private runningPromise: Promise<void> | null = null;
  /** Tracks phases that have already been retried (one retry per phase). */
  private _retriedPhase: Set<string> = new Set();
  /** Ripple sources already scanned/fixed this run — prevents in-run cascade
   * so each doc ripples at most once per run (depth-1 recursion across runs:
   * approvedContentHash is only updated by approvals, so the next run
   * re-detects an un-re-approved change). */
  private _rippleProcessed: Set<string> = new Set();

  constructor(deps: AutopilotDeps, onEvent?: (ev: AutopilotEvent) => void) {
    this.deps = deps;
    this.onEvent = onEvent;
  }

  /**
   * Fire-and-forget async run. Sets running=true, emits {kind:'start'},
   * then drives the chain. Idempotent when already running.
   */
  start(): void {
    const state = this.deps.stateManager.getState();
    if (state.autopilot?.running) {
      // No-op when already running. Still settle: the caller may have acquired
      // a turn guard for this start; release it now that nothing will run.
      this.deps.onSettled?.();
      return;
    }

    this.abortController = new AbortController();
    this.runningPromise = this.runChain();
  }

  /**
   * Sets the abort signal so the current in-flight executeTurn stops at
   * the next phase boundary. The current turn finishes; no further phases
   * start.
   */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    const state = this.deps.stateManager.getState();
    if (!state.autopilot) {
      state.autopilot = defaultAutopilotState();
    }
    state.autopilot.running = false;
    if (state.autopilot.currentPhaseId) {
      state.autopilot.docStatus[state.autopilot.currentPhaseId] = 'idle';
    }
    this.deps.stateManager.saveState(state);
  }

  /**
   * Resumes a parked phase (re-runs it), or continues from the first
   * unapproved phase when no docId given. When the resumed phase passes,
   * its parked portal item is marked resolved and the chain continues.
   */
  resume(docId?: string): void {
    const state = this.deps.stateManager.getState();
    if (!state.autopilot) {
      state.autopilot = defaultAutopilotState();
    }

    // If a specific docId is given, mark its parked items as answered
    // (they will be set to 'resolved' after a successful re-run)
    if (docId) {
      const parkedItems = listPortalItems(this.deps.stateManager, { type: 'parked' });
      for (const item of parkedItems) {
        if (item.status === 'open' && item.docPath?.toLowerCase().includes(docId.toLowerCase())) {
          answerPortalItem(this.deps.stateManager, item.id, 'Resuming autopilot for re-draft...');
        }
      }
    }

    // Start the chain from the specified phase or first unapproved
    this.abortController = new AbortController();
    this.runningPromise = this.runChain(docId);
  }

  /**
   * Live snapshot of the autopilot run-state from the state manager.
   */
  getState(): AutopilotState {
    const state = this.deps.stateManager.getState();
    if (!state.autopilot) {
      state.autopilot = defaultAutopilotState();
    }
    return { ...state.autopilot };
  }

  // ── Internal chain driver ─────────────────────────────────────────────

  /**
   * Reads state from the state manager, ensuring autopilot is initialized.
   */
  private readState(): ProjectState & { autopilot: AutopilotState } {
    const st = this.deps.stateManager.getState();
    if (!st.autopilot) {
      st.autopilot = defaultAutopilotState();
    }
    return st as ProjectState & { autopilot: AutopilotState };
  }

  private async runChain(resumeFrom?: string): Promise<void> {
    try {
      await this.runChainInternal(resumeFrom);
    } finally {
      // Guarantee settlement on every exit path. The chain normally publishes
      // 'complete'/'error', but a hang or a swallowed terminal event must not
      // leave the turn guard held. Releasing twice is safe (idempotent).
      this.runningPromise = null;
      this.deps.onSettled?.();
    }
  }

  private async runChainInternal(resumeFrom?: string): Promise<void> {
    const { stateManager, projectPath, executeTurn } = this.deps;
    const signal = this.abortController?.signal;

    let state = this.readState();

    // Determine start phase: resumeFrom, or first unapproved in order
    let startIdx = 0;
    if (resumeFrom) {
      const idx = ORDERED_WORKFLOW_PHASES.findIndex(p => p.id === resumeFrom);
      if (idx >= 0) {
        startIdx = idx;
      }
    } else {
      // Find first unapproved phase (skip already-approved ones)
      for (let i = 0; i < ORDERED_WORKFLOW_PHASES.length; i++) {
        const p = ORDERED_WORKFLOW_PHASES[i];
        if (!stateManager.isArtifactApproved(p.id.toUpperCase())) {
          startIdx = i;
          break;
        }
      }
    }

    state.autopilot.running = true;
    state.autopilot.startedAt = new Date().toISOString();
    state.autopilot.blocks = state.autopilot.blocks ?? 0;
    stateManager.saveState(state);

    const total = ORDERED_WORKFLOW_PHASES.length;
    this.emit({ kind: 'start', total });

    // Fresh ripple ledger per run: every changed approved doc ripples at most
    // once per chain run.
    this._rippleProcessed = new Set();

    const passed: string[] = [];
    const parked: string[] = [];

    try {
      for (let i = startIdx; i < ORDERED_WORKFLOW_PHASES.length; i++) {
        // Check abort before each phase
        if (signal?.aborted) {
          break;
        }

        const phase = ORDERED_WORKFLOW_PHASES[i];

        // Skip phases already approved
        if (stateManager.isArtifactApproved(phase.id.toUpperCase())) {
          continue;
        }

        // Skip phases whose prerequisites are not met: check that all phases
        // before this one in the canonical order are approved.
        const prereqMet = this.checkPrerequisitesMet(i);
        if (!prereqMet) {
          continue; // skip silently — prereqs unmet
        }

        // Pending user answers (appended mid-chain by answer-applier) must be
        // incorporated into their originating approved docs BEFORE this phase
        // runs; then every approved doc whose on-disk content no longer matches
        // its approvedContentHash joins the ripple scan (v2 hash trigger).
        await this.runPrePhaseRipples(i, signal);
        if (signal?.aborted) {
          break;
        }

        // Emit drafting event
        state = this.readState();
        state.autopilot.currentPhaseId = phase.id;
        state.autopilot.docStatus[phase.id] = 'drafting';
        stateManager.saveState(state);
        this.emit({ kind: 'phase', phaseId: phase.id, status: 'drafting', name: phase.name });

        // Execute the turn
        let turnResult = await executeTurn({
          userPrompt: `Generate the ${phase.name} deliverable for this project now (autopilot run). Follow the specialist's instructions fully.\n\nIMPORTANT: You MUST write the deliverable to docs/${phase.id.toUpperCase()}.md using the fs_write tool. Your response must be the COMPLETE document content starting with a heading. Do not return commentary or summaries.`,
          forceSpecialistId: phase.id,
          // P3+P6 pre-turn research stages: document specialists only (the
          // runner additionally excludes general/change-impact).
          preflight: true,
          signal,
          onQuestions: (items) => {
            for (const item of items) {
              try {
                const portalItem = addPortalItem(stateManager, questionPayloadToPortalInput(item));
                this.emit({ kind: 'question', item: portalItem });
              } catch (err) {
                // Empty-title guard (F3): skip the malformed entry, never
                // park the whole phase run on one junk question.
                this.deps.logger?.warn(`Skipped malformed question item: ${err instanceof Error ? err.message : err}`);
              }
            }
          },
          onStatusUpdate: (msg) => this.emit({ kind: 'status', message: msg }),
          onToolCall: (tool, args) => this.emit({ kind: 'tool_call', tool, args })
        });

        // Check abort after turn (in case signal fired mid-turn)
        if (signal?.aborted || turnResult.aborted) {
          state = this.readState();
          state.autopilot.running = false;
          if (state.autopilot.currentPhaseId) {
            state.autopilot.docStatus[state.autopilot.currentPhaseId] = 'idle';
          }
          stateManager.saveState(state);
          this.emit({
            kind: 'complete',
            result: { passed, parked },
            reason: 'stopped'
          });
          return;
        }

        // Track revisions used
        state = this.readState();
        state.autopilot.revisionsUsed[phase.id] = turnResult.autoRevisionsRun ?? 0;
        stateManager.saveState(state);

        // Retry once on error: the model may have returned commentary instead of
        // writing the document. Re-run with a stronger instruction.
        if (turnResult.error && !this._retriedPhase.has(phase.id)) {
          this._retriedPhase.add(phase.id);
          this.emit({ kind: 'status', message: `The first pass didn't produce a usable ${phase.name} document — retrying with clearer instructions…` });
          const overrideSentence = phase.id === 'bom'
            ? "\n\nOVERRIDES: Skip discovery reads and web_search entirely. Immediately write the Stage-1 grocery-list skeleton to docs/BOM.md with a # heading, then finish your reply with the document."
            : '';
          const retryResult = await executeTurn({
            userPrompt: `You previously failed to produce the ${phase.name} deliverable. This is a retry.\n\nCRITICAL: You MUST write the file docs/${phase.id.toUpperCase()}.md using fs_write. Your response MUST be the complete document content starting with a level-1 heading (#).\n\nDo NOT return commentary, explanations, or summaries. Only the document itself.${overrideSentence}`,
            forceSpecialistId: phase.id,
            // Fast-retry path: the override prompt already says "skip
            // discovery reads and web_search entirely" — both pre-turn stages
            // honor that by skipping.
            skipPreflight: true,
            signal,
            onQuestions: (items) => {
              for (const item of items) {
                try {
                  const portalItem = addPortalItem(stateManager, questionPayloadToPortalInput(item));
                  this.emit({ kind: 'question', item: portalItem });
                } catch (err) {
                  // Empty-title guard (F3): skip the malformed entry, never
                  // park the whole phase run on one junk question.
                  this.deps.logger?.warn(`Skipped malformed question item: ${err instanceof Error ? err.message : err}`);
                }
              }
            },
            onStatusUpdate: (msg) => this.emit({ kind: 'status', message: msg }),
            onToolCall: (tool, args) => this.emit({ kind: 'tool_call', tool, args })
          });
          // Use the retry result instead of the original; if it still errors,
          // fall through to the normal error/park handling below.
          turnResult = retryResult;
        }

        // Handle criticFailed (hard-stop)
        if (turnResult.criticFailed) {
          // Persist a parked portal item first (this saves fresh state to disk)
          const parkedItem = addPortalItem(stateManager, {
            type: 'parked',
            severity: 'blocking',
            docPath: `docs/${phase.id.toUpperCase()}.md`,
            title: `${phase.name} parked after critic review`,
            detail: turnResult.criticResult?.summary
              ? `Critic summary: ${turnResult.criticResult.summary}`
              : 'The critic loop exhausted its maximum attempts without passing.',
            gaps: turnResult.criticResult?.weaknesses ?? [],
            source: 'autopilot'
          });
          this.emit({ kind: 'parked', item: parkedItem });

          // Re-read state after addPortalItem mutated it, then apply stop
          state = this.readState();
          state.autopilot.docStatus[phase.id] = 'parked';
          state.autopilot.blocks = (state.autopilot.blocks ?? 0) + 1;
          parked.push(phase.id);
          state.autopilot.running = false;
          stateManager.saveState(state);
          this.emit({
            kind: 'complete',
            result: { passed, parked },
            reason: 'stopped'
          });
          return;
        }

        // Non-critic specialists (e.g. change-impact): only mark passed when
        // the turn produced a document. Intake interviews and error turns
        // that don't write an artifact must NOT silently pass.
        if (!turnResult.requiresReview) {
          // If the turn was redirected (e.g. prerequisite gate, classifier fallback),
          // the specialistId won't match. Surface the explanation instead of parking.
          if (turnResult.specialistId !== phase.id) {
            state.autopilot.lastError = `${phase.name}: ${turnResult.output?.slice(0, 200) || 'preconditions not met'}`;
            state.autopilot.docStatus[phase.id] = 'parked';
            state.autopilot.blocks++;
            state.autopilot.running = false;
            stateManager.saveState(state);
            this.emit({ kind: 'error', message: `Phase ${phase.id} blocked: ${turnResult.output?.slice(0, 120) || 'prerequisites not met'}` });
            return;
          }
          const content = readDocContent(projectPath, phase.id);
          if (content !== null) {
            state.autopilot.docStatus[phase.id] = 'passed';
            passed.push(phase.id);
            stateManager.saveState(state);
            this.emit({ kind: 'phase', phaseId: phase.id, status: 'passed', name: phase.name });
            continue;
          }
          // No artifact written: park with error
          state.autopilot.docStatus[phase.id] = 'parked';
          state.autopilot.blocks++;
          state.autopilot.lastError = `${phase.name}: turn produced no artifact (requires review: false, no doc written)`;
          state.autopilot.running = false;
          stateManager.saveState(state);
          this.emit({ kind: 'error', message: `Phase ${phase.id} produced no document` });
          return;
        }

        // Normal critic pass: approve the artifact
        const content = readDocContent(projectPath, phase.id);
        if (content !== null) {
          await approveArtifact({
            projectPath,
            stateManager,
            specialistId: phase.id,
            content,
            title: `${phase.name} Document`,
            criticScore: turnResult.criticResult?.score
          });
        }

        // Resolve any parked items for this phase (from a previous park/resume)
        this.resolveParkedItems(phase.id);

        // Mark auto-approved (critic passed, autopilot approved)
        state = this.readState();
        state.autopilot.docStatus[phase.id] = 'auto-approved';
        passed.push(phase.id);
        stateManager.saveState(state);
        this.emit({ kind: 'phase', phaseId: phase.id, status: 'auto-approved', name: phase.name });
      }

      // Chain complete — all phases processed
      state = this.readState();
      state.autopilot.running = false;
      state.autopilot.currentPhaseId = undefined;
      stateManager.saveState(state);
      this.emit({
        kind: 'complete',
        result: { passed, parked },
        reason: 'finished'
      });
    } catch (err: any) {
      state = this.readState();
      state.autopilot.running = false;
      state.autopilot.lastError = err?.message ?? String(err);
      stateManager.saveState(state);
      this.emit({
        kind: 'error',
        message: err?.message ?? String(err)
      });
    }
  }

  /**
   * Finds approved phases (indices < beforeIdx) whose docs/ID.md still carry
   * a '## User Answers (Pending Incorporation)' block — mid-chain answers
   * appended by answer-applier but never incorporated into normative text.
   */
  private findPendingIncorporationPhases(beforeIdx: number): string[] {
    const pending: string[] = [];
    for (let j = 0; j < beforeIdx; j++) {
      const phase = ORDERED_WORKFLOW_PHASES[j];
      if (!this.deps.stateManager.isArtifactApproved(phase.id.toUpperCase())) {
        continue;
      }
      const content = readDocContent(this.deps.projectPath, phase.id);
      if (content && content.includes(PENDING_INCORPORATION_MARKER)) {
        pending.push(phase.id);
      }
    }
    return pending;
  }

  /**
   * Pre-phase ripple step (v2, subsumes the v1 incorporation-only trigger):
   * 1. Runs incorporation turns for pending user answers; a changed doc is
   *    captured as a ripple source with its diff.
   * 2. Hash trigger: for EVERY approved artifact whose doc is saved on disk
   *    with content hash ≠ approvedContentHash, adds that doc as an external
   *    ripple source (byte-identical docs are skipped).
   * 3. Runs ONE combined intent-aware change-impact scan over all sources.
   * Each changed doc is processed at most once per run; failures are
   * logged/emitted and never fatal.
   */
  private async runPrePhaseRipples(beforeIdx: number, signal?: AbortSignal): Promise<void> {
    const sources: RippleSource[] = [];
    await this.incorporatePendingAnswers(beforeIdx, signal, sources);
    // Hash trigger: compare each approved doc's on-disk content hash against
    // the approvedContentHash stored at approval time. Ripple edits do NOT
    // update the hash (only approvals do), so an un-re-approved change keeps
    // re-triggering on subsequent runs — depth-1 recursion per run.
    const state = this.readState();
    for (const phase of ORDERED_WORKFLOW_PHASES) {
      if (sources.some(s => s.phaseId === phase.id) || this._rippleProcessed.has(phase.id)) {
        continue;
      }
      if (!this.deps.stateManager.isArtifactApproved(phase.id.toUpperCase())) {
        continue;
      }
      const artifact = state.artifacts.find(a => a.id.toUpperCase() === phase.id.toUpperCase());
      if (!artifact?.approvedContentHash) {
        continue;
      }
      const content = readDocContent(this.deps.projectPath, phase.id);
      if (content === null || sha256Hex(content) === artifact.approvedContentHash) {
        continue;
      }
      sources.push({ phaseId: phase.id, external: true });
    }
    if (sources.length === 0) {
      return;
    }
    for (const s of sources) {
      this._rippleProcessed.add(s.phaseId);
    }
    await runRippleScan(this.rippleDeps(), sources, this._rippleProcessed, signal);
  }

  /**
   * Runs one incorporation specialist turn per approved doc that still
   * carries a pending-answers block, before the current phase executes. The
   * specialist revises its own document's normative text to incorporate the
   * answers and removes the pending block per its instructions. Only a
   * successful turn may strip a block the specialist left behind — on error
   * or criticFailed the block is left intact (it is the only record of the
   * user's answers) so the next chain start re-runs incorporation. Failures
   * are logged and surfaced via a status event, never fatal; each phase
   * boundary re-attempts incorporation at most once per run.
   */
  private async incorporatePendingAnswers(beforeIdx: number, signal?: AbortSignal, rippleSources?: RippleSource[]): Promise<void> {
    const { stateManager, projectPath, executeTurn, logger } = this.deps;
    const pendingPhaseIds = this.findPendingIncorporationPhases(beforeIdx);
    for (const phaseId of pendingPhaseIds) {
      const phase = ORDERED_WORKFLOW_PHASES.find(p => p.id === phaseId)!;
      logger?.info(
        `Autopilot: pending user answers found in docs/${phaseId.toUpperCase()}.md — running incorporation turn for ${phaseId} before the current phase`
      );
      this.emit({ kind: 'status', message: `Incorporating pending user answers in ${phase.name} before continuing…` });
      // Capture the pre-turn content: the ripple scan only fires when the
      // incorporation turn actually edited the document (no-op incorporations
      // never ripple).
      const beforeContent = readDocContent(projectPath, phaseId) ?? '';
      // Pre-turn snapshot of the pending block: a failed turn may still have
      // consumed the block (e.g. the agent-loop budget rescue forced a final
      // no-tools write of the full doc without it). The snapshot is the only
      // way to restore the answers for the next chain start.
      const pendingBlockSnapshot = extractPendingBlock(beforeContent);
      const result = await executeTurn({
        userPrompt: buildIncorporationPrompt(phaseId),
        forceSpecialistId: phaseId,
        // The doc is already approved; scope the critic to incorporation
        // accuracy so the turn is not re-graded against the full rubric.
        criticFocus: INCORPORATION_CRITIC_FOCUS,
        signal,
        onQuestions: (items) => {
          for (const item of items) {
            try {
              const portalItem = addPortalItem(stateManager, questionPayloadToPortalInput(item));
              this.emit({ kind: 'question', item: portalItem });
            } catch (err) {
              // Empty-title guard (F3): skip the malformed entry, never
              // park the whole phase run on one junk question.
              this.deps.logger?.warn(`Skipped malformed question item: ${err instanceof Error ? err.message : err}`);
            }
          }
        },
        onStatusUpdate: (msg) => this.emit({ kind: 'status', message: msg }),
        onToolCall: (tool, args) => this.emit({ kind: 'tool_call', tool, args })
      });
      // The pending block is the only record of the user's answers. Strip a
      // block the specialist left behind ONLY when the turn succeeded (no
      // error, critic passed). On error or criticFailed: signal and continue
      // with the block intact — the next chain start re-runs incorporation.
      if (result?.error || result?.criticFailed) {
        logger?.warn(`Autopilot: incorporation turn for ${phaseId} failed (${result.output?.slice(0, 120) || 'unknown error'})`);
        this.emit({ kind: 'status', message: `Incorporation turn for ${phase.name} failed — continuing with the pending answers left in place for the next chain start.` });
        if (pendingBlockSnapshot) {
          this.restoreConsumedPendingBlock(phaseId, pendingBlockSnapshot);
        }
        continue;
      }
      // Guard: if the specialist turn left the block in place, strip it so
      // the chain never re-runs incorporation on a stale block forever.
      const docPath = path.join(projectPath, 'docs', `${phaseId.toUpperCase()}.md`);
      // postTurnContent is the specialist's own edit footprint, read BEFORE
      // the deterministic guard strip below — so a no-op incorporation that
      // leaves the block untouched compares byte-identical to beforeContent.
      let postTurnContent: string | null = null;
      let guardStripped = false;
      try {
        const content = fs.readFileSync(docPath, 'utf-8');
        postTurnContent = content;
        if (content.includes(PENDING_INCORPORATION_MARKER)) {
          const stripped = stripPendingBlock(content);
          fs.writeFileSync(docPath, stripped, 'utf-8');
          guardStripped = true;
          logger?.info(`Autopilot: incorporation turn left the pending block in docs/${phaseId.toUpperCase()}.md — stripped it`);
        }
      } catch {
        // ignore: unreadable/missing doc — nothing to strip
      }
      if (postTurnContent === null) {
        continue;
      }
      if (postTurnContent === beforeContent) {
        // No-op incorporation: when the deterministic guard stripped the block
        // here, only the non-normative pending block was removed — nothing
        // normative changed. Suppress the ripple for the REST of this run; the
        // next run still re-detects the hash mismatch until re-approval.
        if (guardStripped) {
          this._rippleProcessed.add(phaseId);
        }
        continue;
      }
      // Ripple source capture: the incorporation turn just incorporated
      // pending open-question answers AND the doc actually changed. The
      // source joins the combined pre-phase ripple scan.
      const diff = summarizeDiff(beforeContent, postTurnContent);
      if (!diff) {
        continue;
      }
      rippleSources?.push({ phaseId, diff, external: false });
    }
  }

  /**
   * Preserve-answers guarantee for failed incorporation turns: a failed turn
   * may have consumed the pending block anyway (budget-exhaustion rescue
   * write, overzealous specialist edit). Re-reads the doc from disk; when
   * the block is ABSENT and the pre-turn snapshot exists, re-appends the
   * snapshot block (with the marker) to the end of the doc so the answers
   * stay retryable on the next chain start. A block still present on disk
   * (normal failure path) is left untouched, and a doc whose body already
   * contains the first answer line (half-moved block) is not duplicated.
   * Never throws: an unreadable/unwritable doc skips the restore.
   *
   * @param phaseId Workflow phase id — derives docs/ID.md.
   * @param snapshot Pending block text captured before the turn (starts with
   *   the marker heading); must be non-null.
   */
  private restoreConsumedPendingBlock(phaseId: string, snapshot: string): void {
    const { projectPath, logger } = this.deps;
    const content = readDocContent(projectPath, phaseId);
    if (content === null) {
      return;
    }
    if (content.includes(PENDING_INCORPORATION_MARKER)) {
      // Normal failure path: the block survived the turn — nothing to do.
      return;
    }
    // Half-moved guard: if the first answer line is already in the doc body,
    // restoring the snapshot would duplicate it.
    const firstAnswerLine = snapshot
      .slice(snapshot.indexOf('\n') + 1)
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0);
    if (firstAnswerLine && content.includes(firstAnswerLine)) {
      return;
    }
    try {
      const restored = content.trimEnd() + '\n\n' + snapshot.trimEnd() + '\n';
      fs.writeFileSync(path.join(projectPath, 'docs', `${phaseId.toUpperCase()}.md`), restored, 'utf-8');
      logger?.warn(`Restored unincorporated answers block for ${phaseId} after failed incorporation turn`);
    } catch {
      // ignore: unwritable doc — nothing more we can do here
    }
  }

  /**
   * Ripple deps adapter: binds the driver's closures/deps to the shared
   * ripple module (src/core/ripple.ts) — the SAME scan/fix machinery the
   * answer applier's immediate post-incorporation ripple uses.
   */
  private rippleDeps(): RippleDeps {
    return {
      stateManager: this.deps.stateManager,
      executeTurn: this.deps.executeTurn,
      emit: (ev) => this.emit(ev),
      logger: this.deps.logger
    };
  }

  /**
   * Checks whether all phases before the given index in ORDERED_WORKFLOW_PHASES
   * are approved. If any prior phase is unapproved, the current phase's
   * prerequisites are not met and it should be skipped.
   */
  private checkPrerequisitesMet(phaseIndex: number): boolean {
    if (phaseIndex === 0) return true; // conops has no prereq
    const { stateManager } = this.deps;
    for (let i = 0; i < phaseIndex; i++) {
      const prior = ORDERED_WORKFLOW_PHASES[i];
      const approved = stateManager.isArtifactApproved(prior.id.toUpperCase());
      if (!approved) {
        return false;
      }
    }
    return true;
  }

  /**
   * Resolves all parked portal items whose docPath matches the given phase id.
   * Used after a successful re-run of a previously-parked phase. Decrements
   * the autopilot blocks counter for each resolved item.
   */
  private resolveParkedItems(phaseId: string): void {
    const parkedItems = listPortalItems(this.deps.stateManager, { type: 'parked' });
    let resolvedCount = 0;
    for (const item of parkedItems) {
      if (
        (item.status === 'open' || item.status === 'answered') &&
        item.docPath?.toLowerCase().includes(phaseId.toLowerCase())
      ) {
        const state = this.deps.stateManager.getState();
        const stored = (state.portalItems || []).find(i => i.id === item.id);
        if (stored) {
          stored.status = 'resolved';
          stored.updatedAt = new Date().toISOString();
          resolvedCount++;
          this.deps.stateManager.saveState(state);
        }
      }
    }
    // Decrement blocks for each resolved parked item
    if (resolvedCount > 0) {
      const state = this.deps.stateManager.getState();
      state.autopilot!.blocks = Math.max(0, (state.autopilot!.blocks ?? 0) - resolvedCount);
      this.deps.stateManager.saveState(state);
    }
  }

  private emit(ev: AutopilotEvent): void {
    this.onEvent?.(ev);
  }
}
