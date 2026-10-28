/**
 * 5-state progress-rail mapper (design §5.F).
 * Collapses the real doc/roadmap signals into five honest rail states.
 * Real literals: AutopilotDocStatus (src/core/autopilot.ts) and
 * RoadmapStatus (web/src/types/api.ts).
 */

export type RailState = 'not-started' | 'in-progress' | 'drafted' | 'approved' | 'error-parked';

export interface PhaseRailView {
  state: RailState;
  /** Sub-flag: approved via auto-approved (no human gate). */
  auto: boolean;
  /** Sub-flag: roadmap LOCKED — upstream document must be reopened. */
  locked: boolean;
  label: string;
}

export function railStateFor(input: {
  docStatus?: string;
  roadmapStatus?: string;
  docExists?: boolean;
}): PhaseRailView {
  const { docStatus, roadmapStatus, docExists } = input;

  // Precedence is literal — first match wins (design §5.F rules of precedence).
  // 1. parked → error-parked
  if (docStatus === 'parked') return view('error-parked', 'Error — needs attention');

  // 2. drafting | critic | revising → in-progress
  if (docStatus === 'drafting' || docStatus === 'critic' || docStatus === 'revising') {
    return view('in-progress', 'In progress');
  }

  // 3. auto-approved → approved (+auto); passed → approved
  if (docStatus === 'auto-approved') {
    return { state: 'approved', auto: true, locked: false, label: 'Approved' };
  }
  if (docStatus === 'passed') return view('approved', 'Approved');

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
