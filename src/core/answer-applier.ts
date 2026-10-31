import fs from 'node:fs';
import path from 'node:path';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES, defaultAutopilotState } from '../workspace/state.js';
import { PortalItem } from '../workspace/types.js';
import { TurnResult } from './runner.js';
import { addPortalItem, answerPortalItem, ANSWER_HISTORY_CAP } from './question-portal.js';
import { PENDING_INCORPORATION_MARKER, stripPendingBlock, INCORPORATION_CRITIC_FOCUS, buildIncorporationPrompt } from './incorporation-prompt.js';
import { runRippleScan, summarizeDiff, RippleDeps } from './ripple.js';
import type { AutopilotEvent, AutopilotDocStatus } from './autopilot.js';

export interface AnswerApplierDeps {
  stateManager: ProjectStateManager;
  projectPath: string;
  executeTurn: (opts: {
    userPrompt: string;
    forceSpecialistId: string;
    /** Scoped evaluation directive threaded to the critic (incorporation turn). */
    criticFocus?: string;
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
    }>) => void;
    /** Live status updates from the runner (ripple scan/fix turns). */
    onStatusUpdate?: (status: string) => void;
    /** Live tool call notifications from the runner (ripple turns). */
    onToolCall?: (tool: string, args: unknown) => void;
  }) => Promise<import('./runner.js').TurnResult>;
  /**
   * True while the owning session is mid-chain (a turn or autopilot chain is
   * running). When true, applyAnswer takes ONLY the plain-edit path: the
   * answer is appended to the pending-answers block and the running chain's
   * own incorporation path handles it — no incorporation turn runs mid-chain.
   */
  isBusy?: () => boolean;
  /**
   * Optional status-event sink (the server adapter publishes these onto the
   * autopilot SSE stream). Emitted around the idle incorporation turn.
   */
  emitStatus?: (message: string) => void;
  /**
   * Optional phase-event sink, fired when a successful incorporation turn
   * marks the doc 'revised' (only from 'auto-approved'/'passed').
   */
  emitPhase?: (phaseId: string, status: AutopilotDocStatus, name: string) => void;
  /**
   * Optional raw-event sink for the shared ripple machinery (src/core/
   * ripple.ts): question frames for failed ripple fixes and any other
   * event kinds the status/phase sinks do not cover.
   */
  emitEvent?: (ev: AutopilotEvent) => void;
}

/**
 * Derive the phase id from a docPath like "docs/CONOPS.md".
 * Validates against ORDERED_WORKFLOW_PHASES.
 */
function phaseIdFromDocPath(docPath: string): string {
  const m = docPath.match(/^docs\/(.+)\.md$/i);
  if (!m) {
    throw new Error(`Cannot derive phase from docPath: ${docPath}`);
  }
  const raw = m[1].toLowerCase();
  // Normalize: try exact match first, then normalized
  for (const p of ORDERED_WORKFLOW_PHASES) {
    if (p.id.toLowerCase() === raw) {
      return p.id;
    }
  }
  throw new Error(`Unknown phase derived from docPath: ${docPath}`);
}

/**
 * Apply an answer to a portal question. Every answer — busy or idle — applies
 * immediately as a plain doc edit: it is appended to the doc's
 * '## User Answers (Pending Incorporation)' block (created if missing) and the
 * item is marked answered. When the LAST open question for that docPath is
 * answered and the session is idle, ONE incorporation turn runs (specialist +
 * hybrid criticFocus, same prompt machinery as the autopilot chain's
 * pre-phase incorporation); on success the pending block is stripped and the
 * doc is marked 'revised' (from 'auto-approved'/'passed' only). Returns
 * counter-questions raised by the incorporation turn.
 */
export async function applyAnswer(
  deps: AnswerApplierDeps,
  itemId: string,
  answerText: string
): Promise<{
  updatedItem: PortalItem;
  affectedDocs: string[];
  counterQuestions: PortalItem[];
}> {
  const { stateManager, projectPath } = deps;

  // 1. Look up the item by itemId
  const state = stateManager.getState();
  const item = (state.portalItems || []).find(i => i.id === itemId);
  if (!item) {
    throw new Error(`Portal item not found: ${itemId}`);
  }
  // Freshness check: a queued answer that lands after the item was already
  // answered/dismissed must not rewrite the portal (prevents double-apply of
  // stale queue entries).
  if (item.status !== 'open') {
    throw new Error(`Portal item no longer open (${item.status})`);
  }
  if (!item.docPath) {
    throw new Error(`Portal item ${itemId} has no docPath`);
  }

  // 2. Determine originating phase from docPath
  const phaseId = phaseIdFromDocPath(item.docPath);

  // 3. Read the current doc content from disk
  const docFilePath = path.join(projectPath, 'docs', `${phaseId.toUpperCase()}.md`);
  let existingContent = '';
  try {
    existingContent = fs.readFileSync(docFilePath, 'utf-8');
  } catch {
    // If doc doesn't exist yet, use empty string (the turn will create it)
    existingContent = '';
  }

  // 3b. PLAIN-EDIT PATH (busy AND idle alike): every answer applies
  // immediately as a plain doc edit appended to the pending incorporation
  // block (created if missing) — no per-answer specialist turn. If the doc
  // is missing/empty there is nothing to edit; the answer still lands on the
  // item and reaches the next turn via context.
  if (existingContent.trim()) {
    const displayTitle = item.title.replace(/^Q\d+[\.:\)]\s*/, '');
    const pendingBlock = `${existingContent.trimEnd()}\n\n${PENDING_INCORPORATION_MARKER}\n\n**${displayTitle}**\nAnswer: ${answerText}\n`;
    fs.writeFileSync(docFilePath, pendingBlock, 'utf-8');
  }

  // 4. Mark the item answered.
  const updatedItem = answerPortalItem(stateManager, itemId, answerText);

  // 5. Incorporation trigger: when the LAST open question for this docPath is
  // answered (recounted AFTER this answer landed — the answered item does not
  // count) AND the session is idle, run ONE incorporation turn reusing the
  // same prompt machinery as the autopilot chain's pre-phase incorporation.
  const counterQuestions: PortalItem[] = [];
  const openRemaining = (stateManager.getState().portalItems || [])
    .filter(i => i.docPath === item.docPath && i.status === 'open' && i.meta?.archived !== true)
    .length;
  if (openRemaining === 0 && !deps.isBusy?.()) {
    const phase = ORDERED_WORKFLOW_PHASES.find(p => p.id === phaseId)!;
    const counterQuestionItems: Array<{
      type: 'question';
      severity: 'normal';
      docPath: string;
      title: string;
      detail?: string;
      source: 'autopilot';
    }> = [];
    deps.emitStatus?.(`Incorporating pending user answers in ${phase.name}…`);
    let result: TurnResult;
    try {
      result = await deps.executeTurn({
        userPrompt: buildIncorporationPrompt(phaseId),
        forceSpecialistId: phaseId,
        // Scope the critic to incorporation accuracy (hybrid directive shared
        // with the autopilot chain's incorporation turns).
        criticFocus: INCORPORATION_CRITIC_FOCUS,
        onQuestions: (items) => {
          for (const q of items) {
            counterQuestionItems.push(q);
          }
        }
      });
    } catch (err: any) {
      deps.emitStatus?.(`Incorporation of pending answers into ${phase.name} failed — the pending block is kept for retry. (${String(err?.message ?? err).slice(0, 200)})`);
      return { updatedItem, affectedDocs: [], counterQuestions };
    }
    // The pending block is the only record of the user's answers. On error or
    // criticFailed it stays in place (retryable — the next chain start
    // re-runs incorporation) and a status event surfaces the failure.
    if (result?.error || result?.criticFailed) {
      deps.emitStatus?.(`Incorporation of pending answers into ${phase.name} failed — the pending block is kept for retry.`);
      return { updatedItem, affectedDocs: [], counterQuestions };
    }
    // 6. Success: capture the specialist's edit footprint BEFORE the guard
    // strip (mirrors the autopilot: a no-op incorporation compares
    // byte-identical to the pre-answer content and never ripples), then strip
    // a pending block the specialist left behind (same deterministic guard
    // as the autopilot's incorporation turns).
    let postTurnContent: string | null = null;
    try {
      postTurnContent = fs.readFileSync(docFilePath, 'utf-8');
    } catch {
      // ignore: unreadable/missing doc
    }
    if (postTurnContent !== null && postTurnContent.includes(PENDING_INCORPORATION_MARKER)) {
      try {
        fs.writeFileSync(docFilePath, stripPendingBlock(postTurnContent), 'utf-8');
      } catch {
        // ignore: unwritable doc — the block stays on disk, still recoverable
      }
    }
    // 7. Mark the doc 'revised' — completed by the incorporation turn, NOT
    // re-approved — but only from 'auto-approved'/'passed'; never touch
    // 'idle'/'parked' statuses.
    const state = stateManager.getState();
    state.autopilot = state.autopilot ?? defaultAutopilotState();
    const currentStatus = state.autopilot.docStatus[phaseId];
    if (currentStatus === 'auto-approved' || currentStatus === 'passed') {
      state.autopilot.docStatus[phaseId] = 'revised';
      stateManager.saveState(state);
      deps.emitPhase?.(phaseId, 'revised', phase.name);
    }
    deps.emitStatus?.(`Incorporated answers into ${phase.name} — awaiting review`);
    // 8b. Immediate ripple (user-mandated): the incorporation turn succeeded
    // and the chain is idle — run the SAME change-impact scan + scoped
    // critic-free fix turns the autopilot chain runs (shared src/core/
    // ripple.ts machinery), sourced from the incorporation doc's diff.
    if (postTurnContent !== null && postTurnContent !== existingContent) {
      const diff = summarizeDiff(existingContent, postTurnContent);
      if (diff) {
        const rippleDeps: RippleDeps = {
          stateManager,
          executeTurn: deps.executeTurn,
          emit: (ev: AutopilotEvent) => {
            if (ev.kind === 'status') {
              deps.emitStatus?.(ev.message);
              return;
            }
            if (ev.kind === 'phase') {
              deps.emitPhase?.(ev.phaseId, ev.status, ev.name);
              return;
            }
            deps.emitEvent?.(ev);
          }
        };
        await runRippleScan(rippleDeps, [{ phaseId, diff, external: false }], new Set<string>());
      }
    }
    // 8. Counter-questions raised by the incorporation turn become portal
    // items on the original thread (same as the autopilot's incorporation).
    const threadId = item.threadId || item.id;
    for (const q of counterQuestionItems) {
      counterQuestions.push(addPortalItem(stateManager, {
        type: 'question',
        severity: 'normal',
        docPath: q.docPath,
        title: q.title,
        detail: q.detail,
        source: 'autopilot',
        threadId
      }));
    }
  }

  // 10. Board #52 — follow-up questions reopened after this answer inherit the
  // item's full answer history, so the thread keeps its saved Q&A record.
  // NOTE: getState() re-parses the store, so re-read fresh before saving —
  // saving the earlier snapshot would wipe answerPortalItem's history append.
  if (counterQuestions.length > 0) {
    const history = updatedItem.meta?.answerHistory;
    if (Array.isArray(history)) {
      // Cap on inherit too, so a follow-up thread can never carry more saved
      // answers than an in-place append would.
      const capped = history.slice(-ANSWER_HISTORY_CAP);
      const fresh = stateManager.getState();
      const byId = new Map((fresh.portalItems || []).map(i => [i.id, i]));
      for (const cq of counterQuestions) {
        // Answer history stays scoped: only follow-ups on the SAME document
        // inherit the thread's saved answers — unrelated documents must not
        // inherit decisions they have nothing to do with.
        if (cq.docPath !== item.docPath) {
          continue;
        }
        cq.meta = { ...(cq.meta || {}), answerHistory: capped };
        const stored = byId.get(cq.id);
        if (stored) {
          stored.meta = { ...(stored.meta || {}), answerHistory: capped };
        }
      }
      stateManager.saveState(fresh);
    }
  }

  return { updatedItem, affectedDocs: [], counterQuestions };
}
