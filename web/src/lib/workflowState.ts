/**
 * Doc-state progress-rail mapper (design §5.F + §6).
 * Collapses the real doc/roadmap signals into six honest rail states.
 * Real literals: AutopilotDocStatus (src/core/autopilot.ts) and
 * RoadmapStatus (web/src/types/api.ts).
 */

export type RailState =
  | 'not-started'
  | 'in-progress'
  | 'drafted'
  | 'needs-review'
  | 'approved'
  | 'error-parked';

export interface PhaseRailView {
  state: RailState;
  /** Sub-flag: approved via auto-approved (no human gate). */
  auto: boolean;
  /** Sub-flag: roadmap LOCKED — upstream document must be reopened. */
  locked: boolean;
  label: string;
}

export interface DocStateInput {
  docStatus?: string;
  roadmapStatus?: string;
  docExists?: boolean;
  /** Open questions flagged on this doc (RoadmapPhase.openQuestions). */
  openQuestions?: number;
}

/**
 * Design §6 — "Completed, needs approval": the autopilot completed the doc
 * (docStatus 'passed' | 'auto-approved') and open questions are flagged on it,
 * so the user still has to review/approve. The autopilot docStatus marker
 * persists until the user approves (the server clears it on approve), which is
 * the "not user-approved" signal — a user-approved doc no longer carries it.
 */
export function docNeedsApproval(input: { docStatus?: string; openQuestions?: number }): boolean {
  const completed = input.docStatus === 'passed' || input.docStatus === 'auto-approved';
  return completed && (input.openQuestions ?? 0) > 0;
}

export function railStateFor(input: DocStateInput): PhaseRailView {
  const { docStatus, roadmapStatus, docExists } = input;

  // Precedence is literal — first match wins (design §5.F rules of precedence).
  // 1. parked → error-parked
  if (docStatus === 'parked') return view('error-parked', 'Error — needs attention');

  // 2. drafting | critic | revising → in-progress
  if (docStatus === 'drafting' || docStatus === 'critic' || docStatus === 'revising') {
    return view('in-progress', 'In progress');
  }

  // 3. autopilot completed the doc:
  //    open questions flagged → needs-review (§6, wins over draft);
  //    otherwise approved.
  if (docStatus === 'auto-approved') {
    if (docNeedsApproval(input)) {
      return { state: 'needs-review', auto: true, locked: false, label: 'Completed — needs approval' };
    }
    return { state: 'approved', auto: true, locked: false, label: 'Approved' };
  }
  if (docStatus === 'passed') {
    if (docNeedsApproval(input)) return view('needs-review', 'Completed — needs approval');
    return view('approved', 'Approved');
  }

  // 4. roadmap COMPLETED → approved
  if (roadmapStatus === 'COMPLETED') return view('approved', 'Approved');

  // 5. docExists → drafted; PENDING_REVIEW → drafted
  if (docExists === true) return view('drafted', 'Drafted — awaiting review');
  if (roadmapStatus === 'PENDING_REVIEW') return view('drafted', 'Drafted — awaiting review');

  // 6. roadmap IN_PROGRESS → in-progress
  if (roadmapStatus === 'IN_PROGRESS') return view('in-progress', 'In progress');

  // 7. roadmap LOCKED → not-started (+lock)
  if (roadmapStatus === 'LOCKED') {
    return { state: 'not-started', auto: false, locked: true, label: 'Locked — reopen the upstream document' };
  }

  // 8. default (idle / no doc / PENDING or absent roadmap) → not-started
  return view('not-started', 'Not started');
}

function view(state: RailState, label: string): PhaseRailView {
  return { state, auto: false, locked: false, label };
}
