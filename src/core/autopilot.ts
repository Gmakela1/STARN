import fs from 'node:fs';
import path from 'node:path';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES, defaultAutopilotState } from '../workspace/state.js';
import { PortalItem, PortalItemType, AutopilotState, ProjectState } from '../workspace/types.js';
import { TurnResult } from './runner.js';
import { approveArtifact, parseAffectedPhaseIds } from './approvals.js';
import { addPortalItem, answerPortalItem, listPortalItems } from './question-portal.js';
import { Logger } from '../util/logger.js';

export type AutopilotDocStatus = 'idle' | 'drafting' | 'critic' | 'revising' | 'passed' | 'auto-approved' | 'parked';

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
    /** Scoped evaluation directive threaded to the critic (incorporation turns). */
    criticFocus?: string;
    signal?: AbortSignal;
    onQuestions?: (items: Array<{
      type: 'question';
      severity: 'normal';
      docPath: string;
      title: string;
      detail?: string;
      source: 'autopilot';
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

/** Marker block that answer-applier appends for mid-chain answers not yet incorporated. */
const PENDING_INCORPORATION_MARKER = '## User Answers (Pending Incorporation)';

/**
 * Removes a '## User Answers (Pending Incorporation)' block from doc content:
 * the marker heading and everything up to the next heading of any level (or
 * end of document). Used as the deterministic guard when a specialist turn
 * fails to strip the block itself.
 */
function stripPendingBlock(content: string): string {
  const idx = content.indexOf(PENDING_INCORPORATION_MARKER);
  if (idx < 0) {
    return content;
  }
  const head = content.slice(0, idx);
  let tail = content.slice(idx);
  const nl = tail.indexOf('\n');
  if (nl >= 0) {
    tail = tail.slice(nl + 1);
    const nextHeading = tail.match(/^#{1,6} /m);
    if (nextHeading && nextHeading.index !== undefined) {
      return (head + tail.slice(nextHeading.index)).trimEnd() + '\n';
    }
  }
  // No later heading: the block extends to end of document.
  return head.trimEnd() + '\n';
}

const DIFF_MAX_LINES_PER_SECTION = 6;
const DIFF_LINE_MAX_CHARS = 120;
const DIFF_SUMMARY_MAX_CHARS = 1200;
const FLAGGED_DETAILS_MAX_CHARS = 1000;

/**
 * Compact before/after diff summary for the ripple scan prompt: groups added
 * ("+ ") / removed ("- ") lines by their nearest enclosing markdown heading.
 * When no headings are identifiable, falls back to the first changed lines.
 * Returns '' when the two contents are identical.
 */
function summarizeDiff(before: string, after: string): string {
  if (before === after) return '';
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const headingOf = (lines: string[], idx: number): string | null => {
    for (let j = idx; j >= 0; j--) {
      if (/^#{1,6} /.test(lines[j])) return lines[j];
    }
    return null;
  };

  const entries: Array<{ heading: string | null; line: string }> = [];
  afterLines.forEach((line, idx) => {
    if (!beforeSet.has(line)) {
      entries.push({ heading: headingOf(afterLines, idx), line: `+ ${line.trim().slice(0, DIFF_LINE_MAX_CHARS)}` });
    }
  });
  beforeLines.forEach((line, idx) => {
    if (!afterSet.has(line)) {
      entries.push({ heading: headingOf(beforeLines, idx), line: `- ${line.trim().slice(0, DIFF_LINE_MAX_CHARS)}` });
    }
  });

  const sections = new Map<string, string[]>();
  for (const e of entries) {
    const key = e.heading ?? '';
    const lines = sections.get(key) ?? [];
    if (lines.length < DIFF_MAX_LINES_PER_SECTION) lines.push(e.line);
    sections.set(key, lines);
  }
  let summary = '';
  for (const [heading, lines] of sections) {
    summary += `${heading ? `${heading}: ` : ''}${lines.join(' | ')}; `;
  }
  summary = summary.trimEnd().replace(/; $/, '');
  if (summary.length > DIFF_SUMMARY_MAX_CHARS) {
    summary = summary.slice(0, DIFF_SUMMARY_MAX_CHARS) + '...';
  }
  return summary;
}

/**
 * Extracts the ripple-report fragment that describes the flags for one doc
 * (from its docs/<ID>.md reference to the next doc reference or the report
 * end). Falls back to the whole report when the doc is not named.
 */
function flaggedDetailsForDoc(report: string, artifactId: string): string {
  const docRe = /docs\/[A-Za-z0-9_-]+\.md/gi;
  let m: RegExpExecArray | null;
  while ((m = docRe.exec(report)) !== null) {
    const raw = m[0].slice(5, -3).replace(/_/g, '').replace(/-/g, '').toLowerCase();
    if (raw === artifactId.toLowerCase()) {
      const next = docRe.exec(report);
      const end = next ? next.index : report.length;
      return report.slice(m.index, end).trim().slice(0, FLAGGED_DETAILS_MAX_CHARS);
    }
  }
  return report.trim().slice(0, FLAGGED_DETAILS_MAX_CHARS);
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
        // runs — chain-start/resume and between-phases routing.
        await this.incorporatePendingAnswers(i, signal);
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
          signal,
          onQuestions: (items) => {
            for (const item of items) {
              const portalItem = addPortalItem(stateManager, {
                ...item,
                source: 'autopilot'
              });
              this.emit({ kind: 'question', item: portalItem });
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
            signal,
            onQuestions: (items) => {
              for (const item of items) {
                const portalItem = addPortalItem(stateManager, {
                  ...item,
                  source: 'autopilot'
                });
                this.emit({ kind: 'question', item: portalItem });
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
  private async incorporatePendingAnswers(beforeIdx: number, signal?: AbortSignal): Promise<void> {
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
      const result = await executeTurn({
        userPrompt: `USER ANSWERS PENDING INCORPORATION detected in docs/${phaseId.toUpperCase()}.md.

User answers below are pending incorporation: revise the document's normative text to incorporate them per your answer-handling instructions, then REMOVE the '## User Answers (Pending Incorporation)' block once incorporated.

You MUST write the complete updated document to docs/${phaseId.toUpperCase()}.md using fs_write (or apply the edits with fs_edit). Your response must be the complete document content starting with a heading.`,
        forceSpecialistId: phaseId,
        // The doc is already approved; scope the critic to incorporation
        // accuracy so the turn is not re-graded against the full rubric.
        criticFocus: 'Grade the incorporation turn on: (1) PRIMARY — each pending user answer accurately incorporated into normative text, no invented facts, block handled per instructions; (2) MANDATORY FULL-DOC CONSISTENCY SCAN — read the entire document and fail (score < 8.0) if the incorporation introduced any NEW contradiction, regression, or damage in ANY section; (3) baseline-binding and anti-fabrication guards apply in full. Do NOT deduct for imperfections that pre-date this turn and were not touched by the incorporation — those belong to the approved baseline and the normal phase flow, not this gate. Pass >= 8.0 when incorporation is accurate, complete, and the full-doc scan finds no new damage.',
        signal,
        onQuestions: (items) => {
          for (const item of items) {
            const portalItem = addPortalItem(stateManager, {
              ...item,
              source: 'autopilot'
            });
            this.emit({ kind: 'question', item: portalItem });
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
        continue;
      }
      // Guard: if the specialist turn left the block in place, strip it so
      // the chain never re-runs incorporation on a stale block forever.
      const docPath = path.join(projectPath, 'docs', `${phaseId.toUpperCase()}.md`);
      // postTurnContent is the specialist's own edit footprint, read BEFORE
      // the deterministic guard strip below — so a no-op incorporation that
      // leaves the block untouched compares byte-identical to beforeContent.
      let postTurnContent: string | null = null;
      try {
        const content = fs.readFileSync(docPath, 'utf-8');
        postTurnContent = content;
        if (content.includes(PENDING_INCORPORATION_MARKER)) {
          const stripped = stripPendingBlock(content);
          fs.writeFileSync(docPath, stripped, 'utf-8');
          logger?.info(`Autopilot: incorporation turn left the pending block in docs/${phaseId.toUpperCase()}.md — stripped it`);
        }
      } catch {
        // ignore: unreadable/missing doc — nothing to strip
      }
      // Ripple scan gate (two triggers only): the incorporation turn just
      // incorporated pending open-question answers (inherent to this path)
      // AND the doc actually changed. No ripple on no-op incorporations.
      if (postTurnContent === null || postTurnContent === beforeContent) {
        continue;
      }
      const diff = summarizeDiff(beforeContent, postTurnContent);
      if (!diff) {
        continue;
      }
      await this.runRippleScan(phaseId, diff, signal);
    }
  }

  /**
   * Read-only ripple scan after a successful incorporation: runs the
   * change-impact specialist (non-critic, no criticFocus) over the compact
   * incorporation diff to flag downstream approved docs whose content is now
   * discrepant, then runs ONE scoped fix turn per flagged doc with its owning
   * specialist (the incorporation doc itself is excluded). One ripple turn
   * per doc per run — no loops. Scan/fix failures are logged and surfaced via
   * a status event, never fatal; the affected doc is separate from the
   * incorporation doc, so nothing is stripped on failure.
   */
  private async runRippleScan(incorporatedPhaseId: string, diffSummaryText: string, signal?: AbortSignal): Promise<void> {
    const { executeTurn, logger } = this.deps;
    const artifactId = incorporatedPhaseId.toUpperCase();
    let scanResult: TurnResult;
    try {
      scanResult = await executeTurn({
        userPrompt: `UPSTREAM CHANGE DIFF in docs/${artifactId}.md (pending user answers incorporated): ${diffSummaryText}\n\nRead the downstream approved docs. Flag every document/section where this change creates a discrepancy, contradiction, or stale value. Output format: per affected doc — path, section heading, what is now discrepant, and the scoped update that would fix it. ANALYSIS ONLY — do NOT write or edit any document.`,
        forceSpecialistId: 'change-impact',
        signal,
        onStatusUpdate: (msg) => this.emit({ kind: 'status', message: msg }),
        onToolCall: (tool, args) => this.emit({ kind: 'tool_call', tool, args })
      });
    } catch (err: any) {
      logger?.warn(`Autopilot: ripple scan for docs/${artifactId}.md failed (${err?.message ?? String(err)})`);
      this.emit({ kind: 'status', message: 'Ripple scan failed — continuing.' });
      return;
    }
    if (scanResult?.error || scanResult?.criticFailed || scanResult?.aborted) {
      logger?.warn(`Autopilot: ripple scan for docs/${artifactId}.md failed (${scanResult?.output?.slice(0, 120) || 'unknown error'})`);
      this.emit({ kind: 'status', message: 'Ripple scan failed — continuing.' });
      return;
    }
    const affectedPhaseIds = parseAffectedPhaseIds(scanResult.output)
      .filter(id => id !== incorporatedPhaseId);
    this.emit({ kind: 'status', message: `Ripple scan: ${affectedPhaseIds.length} documents flagged` });
    for (const targetId of affectedPhaseIds) {
      const targetPhase = ORDERED_WORKFLOW_PHASES.find(p => p.id === targetId)!;
      if (signal?.aborted) {
        return;
      }
      const details = flaggedDetailsForDoc(scanResult.output, targetPhase.id.toUpperCase());
      let fixResult: TurnResult;
      try {
        fixResult = await executeTurn({
          userPrompt: `CHANGE-IMPACT RIPPLE: docs/${artifactId}.md was updated (upstream decision change). Update ONLY these flagged sections: ${details}. Keep everything else untouched. You may ground fixes with your tools; if a fix requires changing an approved upstream baseline figure, apply the baseline-conflict protocol instead (keep figure binding, mark pending reconciliation, record Open Question). You MUST write the complete updated document to docs/${targetPhase.id.toUpperCase()}.md using fs_write (or apply the edits with fs_edit).`,
          forceSpecialistId: targetId,
          signal,
          onStatusUpdate: (msg) => this.emit({ kind: 'status', message: msg }),
          onToolCall: (tool, args) => this.emit({ kind: 'tool_call', tool, args })
        });
      } catch (err: any) {
        logger?.warn(`Autopilot: ripple fix turn for ${targetId} failed (${err?.message ?? String(err)})`);
        this.emit({ kind: 'status', message: `Ripple fix for ${targetPhase.name} failed — continuing.` });
        continue;
      }
      if (fixResult?.error || fixResult?.criticFailed) {
        logger?.warn(`Autopilot: ripple fix turn for ${targetId} failed (${fixResult?.output?.slice(0, 120) || 'unknown error'})`);
        this.emit({ kind: 'status', message: `Ripple fix for ${targetPhase.name} failed — continuing.` });
        continue;
      }
      this.emit({ kind: 'status', message: `Ripple fix: docs/${targetPhase.id.toUpperCase()}.md updated` });
    }
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
