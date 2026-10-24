import fs from 'node:fs';
import path from 'node:path';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES, defaultAutopilotState } from '../workspace/state.js';
import { PortalItem, PortalItemType, AutopilotState, ProjectState } from '../workspace/types.js';
import { TurnResult } from './runner.js';
import { approveArtifact } from './approvals.js';
import { addPortalItem, answerPortalItem, listPortalItems } from './question-portal.js';

export type AutopilotDocStatus = 'idle' | 'drafting' | 'critic' | 'revising' | 'passed' | 'parked';

export type AutopilotEvent =
  | { kind: 'start'; total: number }
  | { kind: 'phase'; phaseId: string; status: AutopilotDocStatus }
  | { kind: 'question'; item: PortalItem }
  | { kind: 'parked'; item: PortalItem }
  | { kind: 'complete'; result: { passed: string[]; parked: string[] } }
  | { kind: 'error'; message: string };

export interface AutopilotDeps {
  stateManager: ProjectStateManager;
  projectPath: string;
  executeTurn: (opts: {
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
  }) => Promise<TurnResult>;
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
      return; // no-op when already running
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

        // Emit drafting event
        state = this.readState();
        state.autopilot.currentPhaseId = phase.id;
        state.autopilot.docStatus[phase.id] = 'drafting';
        stateManager.saveState(state);
        this.emit({ kind: 'phase', phaseId: phase.id, status: 'drafting' });

        // Execute the turn
        const turnResult = await executeTurn({
          userPrompt: `Generate the ${phase.name} deliverable for this project now (autopilot run). Follow the specialist's instructions fully.`,
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
          }
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
            result: { passed, parked }
          });
          return;
        }

        // Track revisions used
        state = this.readState();
        state.autopilot.revisionsUsed[phase.id] = turnResult.autoRevisionsRun ?? 0;
        stateManager.saveState(state);

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
            result: { passed, parked }
          });
          return;
        }

        // Non-critic specialists (e.g. change-impact): only mark passed when
        // the turn produced a document. Intake interviews and error turns
        // that don't write an artifact must NOT silently pass.
        if (!turnResult.requiresReview) {
          const content = readDocContent(projectPath, phase.id);
          if (content !== null) {
            state.autopilot.docStatus[phase.id] = 'passed';
            passed.push(phase.id);
            stateManager.saveState(state);
            this.emit({ kind: 'phase', phaseId: phase.id, status: 'passed' });
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

        // Mark passed
        state = this.readState();
        state.autopilot.docStatus[phase.id] = 'passed';
        passed.push(phase.id);
        stateManager.saveState(state);
        this.emit({ kind: 'phase', phaseId: phase.id, status: 'passed' });
      }

      // Chain complete — all phases processed
      state = this.readState();
      state.autopilot.running = false;
      state.autopilot.currentPhaseId = undefined;
      stateManager.saveState(state);
      this.emit({
        kind: 'complete',
        result: { passed, parked }
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
