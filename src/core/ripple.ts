/**
 * Shared change-impact ripple machinery (v2, from c8adf83): ONE intent-aware
 * change-impact scan over all ripple sources, then ONE scoped critic-free fix
 * turn per flagged doc with its owning specialist. Used by BOTH the autopilot
 * chain (pre-phase ripples) and the answer applier (immediate ripple after a
 * successful last-answer incorporation turn) so the two paths cannot drift.
 */
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES, defaultAutopilotState } from '../workspace/state.js';
import { TurnResult } from './runner.js';
import { parseAffectedPhaseIds } from './approvals.js';
import { addPortalItem } from './question-portal.js';
import { Logger } from '../util/logger.js';
import type { AutopilotEvent } from './autopilot.js';

/**
 * One upstream change feeding the ripple scan:
 * - incorporation: the owning specialist just incorporated pending user
 *   answers (diff captured before/after the turn);
 * - external: the saved doc's on-disk content no longer matches its
 *   approvedContentHash (edited outside the approval flow, not re-approved).
 */
export interface RippleSource {
  phaseId: string;
  /** Compact before/after diff text; present only for incorporation sources. */
  diff?: string;
  /** True when the change came from a hash mismatch instead of incorporation. */
  external: boolean;
}

export interface RippleDeps {
  stateManager: ProjectStateManager;
  executeTurn: (opts: {
    userPrompt: string;
    forceSpecialistId: string;
    /** Ripple fix turns: skip the critic loop in the runner. */
    criticDisabled?: boolean;
    signal?: AbortSignal;
    onStatusUpdate?: (status: string) => void;
    onToolCall?: (tool: string, args: unknown) => void;
  }) => Promise<TurnResult>;
  /** Event sink (status/phase/question frames on the autopilot stream). */
  emit: (ev: AutopilotEvent) => void;
  logger?: Logger;
}

const DIFF_MAX_LINES_PER_SECTION = 6;
const DIFF_LINE_MAX_CHARS = 120;
const DIFF_SUMMARY_MAX_CHARS = 1200;
const FLAGGED_DETAILS_MAX_CHARS = 1000;

/**
 * Compact before/after diff of the changed doc, grouped by nearest markdown
 * heading. Returns '' when the two contents are identical.
 */
export function summarizeDiff(before: string, after: string): string {
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
 * Adds a non-fatal portal question for a failed ripple fix turn so the
 * user sees it (error excerpt + flagged discrepancy summary).
 */
function addFailedRipplePortalItem(deps: RippleDeps, targetPhase: { id: string; name: string }, errorExcerpt: string, flaggedDetails: string, scanReport: string): void {
  const item = addPortalItem(deps.stateManager, {
    type: 'question',
    severity: 'normal',
    docPath: `docs/${targetPhase.id.toUpperCase()}.md`,
    title: `Ripple fix failed: ${targetPhase.name}`,
    detail: `The autopilot could not apply the ripple fix. Error: ${errorExcerpt || 'unknown error'}. Flagged discrepancy: ${flaggedDetails || scanReport.slice(0, 300)}`,
    source: 'autopilot'
  });
  deps.emit({ kind: 'question', item });
}

/**
 * Intent-aware ripple scan: runs the change-impact specialist (non-critic)
 * once over ALL combined ripple sources — each diff plus its intent (the
 * incorporated user answers for incorporation sources; a neutral
 * 'changed outside the approval flow' note for external hash-mismatch
 * sources) — to flag downstream approved docs whose content is now
 * discrepant, then runs ONE scoped fix turn per flagged doc with its owning
 * specialist (source docs themselves are excluded). Fix turns run with the
 * critic disabled; a successful fix marks the doc 'revised' (completed,
 * NOT re-approved) and a failed fix adds a portal item so the user sees
 * it. One ripple turn per doc per run — no loops. `processed` is the
 * caller's per-run ledger: scanned/flagged phases are recorded there so
 * each doc ripples at most once per run. Scan/fix failures are logged and
 * surfaced, never fatal; nothing is stripped on failure.
 */
export async function runRippleScan(deps: RippleDeps, sources: RippleSource[], processed: Set<string>, signal?: AbortSignal): Promise<void> {
  const { executeTurn } = deps;
  const sourcePhaseIds = sources.map(s => s.phaseId);
  const sourceLineFor = (s: RippleSource): string => {
    const doc = `docs/${s.phaseId.toUpperCase()}.md`;
    if (s.external) {
      return `UPSTREAM CHANGE in ${doc} (document content changed outside the approval flow — edited after approval, not yet re-approved): read the current on-disk content and flag downstream discrepancies it creates.`;
    }
    return `UPSTREAM CHANGE DIFF in ${doc} (pending user answers incorporated): ${s.diff}`;
  };
  let scanResult: TurnResult;
  try {
    scanResult = await executeTurn({
      userPrompt: `${sources.map(sourceLineFor).join('\n')}\n\nRead the downstream approved docs. Flag every document/section where these changes create a discrepancy, contradiction, or stale value. Output format: per affected doc — path, section heading, what is now discrepant, and the scoped update that would fix it. ANALYSIS ONLY — do NOT write or edit any document.`,
      forceSpecialistId: 'change-impact',
      signal,
      onStatusUpdate: (msg) => deps.emit({ kind: 'status', message: msg }),
      onToolCall: (tool, args) => deps.emit({ kind: 'tool_call', tool, args })
    });
  } catch (err: any) {
    deps.logger?.warn(`Autopilot: ripple scan failed (${err?.message ?? String(err)})`);
    deps.emit({ kind: 'status', message: 'Ripple scan failed — continuing.' });
    return;
  }
  if (scanResult?.error || scanResult?.criticFailed || scanResult?.aborted) {
    deps.logger?.warn(`Autopilot: ripple scan failed (${scanResult?.output?.slice(0, 120) || 'unknown error'})`);
    deps.emit({ kind: 'status', message: 'Ripple scan failed — continuing.' });
    return;
  }
  const affectedPhaseIds = parseAffectedPhaseIds(scanResult.output)
    .filter(id => !sourcePhaseIds.includes(id));
  deps.emit({ kind: 'status', message: `Ripple scan: ${affectedPhaseIds.length} documents flagged` });
  for (const targetId of affectedPhaseIds) {
    const targetPhase = ORDERED_WORKFLOW_PHASES.find(p => p.id === targetId)!;
    // Record in the ledger immediately, success or failure. The actual
    // at-most-once-per-run dedupe lives in the ledger gate at the call site,
    // not here — a later-boundary scan in a NEW run can legitimately re-fix
    // the same doc for NEW upstream changes.
    processed.add(targetId);
    if (signal?.aborted) {
      return;
    }
    const details = flaggedDetailsForDoc(scanResult.output, targetPhase.id.toUpperCase());
    let fixResult: TurnResult;
    try {
      fixResult = await executeTurn({
        userPrompt: `CHANGE-IMPACT RIPPLE: ${sourcePhaseIds.map(id => `docs/${id.toUpperCase()}.md`).join(', ')} was updated (upstream decision change). Update ONLY these flagged sections: ${details}. Keep everything else untouched. You may ground fixes with your tools; if a fix requires changing an approved upstream baseline figure, apply the baseline-conflict protocol instead (keep figure binding, mark pending reconciliation, record Open Question). You MUST write the complete updated document to docs/${targetPhase.id.toUpperCase()}.md using fs_write (or apply the edits with fs_edit).`,
        forceSpecialistId: targetId,
        // Critic-free ripple fixes: the owning specialist's scoped edit is
        // applied directly; the user reviews it via the 'revised' status.
        criticDisabled: true,
        signal,
        onStatusUpdate: (msg) => deps.emit({ kind: 'status', message: msg }),
        onToolCall: (tool, args) => deps.emit({ kind: 'tool_call', tool, args })
      });
    } catch (err: any) {
      deps.logger?.warn(`Autopilot: ripple fix turn for ${targetId} failed (${err?.message ?? String(err)})`);
      addFailedRipplePortalItem(deps, targetPhase, String(err?.message ?? err).slice(0, 400), details, scanResult.output);
      deps.emit({ kind: 'status', message: `Ripple fix for ${targetPhase.name} failed — continuing.` });
      continue;
    }
    if (fixResult?.error || fixResult?.criticFailed || fixResult?.aborted) {
      deps.logger?.warn(`Autopilot: ripple fix turn for ${targetId} failed (${fixResult?.output?.slice(0, 120) || 'unknown error'})`);
      addFailedRipplePortalItem(deps, targetPhase, (fixResult?.output ?? '').slice(0, 400), details, scanResult.output);
      deps.emit({ kind: 'status', message: `Ripple fix for ${targetPhase.name} failed — continuing.` });
      continue;
    }
    // Successful fix: mark the doc 'revised' — completed by a ripple fix,
    // NOT re-approved (approvedContentHash untouched; the next run re-checks).
    const state = deps.stateManager.getState();
    state.autopilot = state.autopilot ?? defaultAutopilotState();
    state.autopilot.docStatus[targetPhase.id] = 'revised';
    deps.stateManager.saveState(state);
    deps.emit({ kind: 'phase', phaseId: targetPhase.id, status: 'revised', name: targetPhase.name });
    deps.emit({ kind: 'status', message: `Ripple fix: docs/${targetPhase.id.toUpperCase()}.md updated` });
  }
}
