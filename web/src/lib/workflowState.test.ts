import { describe, expect, it } from 'vitest';
import { docNeedsApproval, railStateFor } from './workflowState';

// Design §5.F — mapping table (real states → 5-state rail) plus the literal
// precedence order. Real literals verified against src/core/autopilot.ts
// (AutopilotDocStatus) and web/src/types/api.ts (RoadmapStatus).
describe('railStateFor', () => {
  // Every row of the design's mapping table + precedence conflicts. First match wins.
  it.each<[Record<string, string | number | boolean | undefined>, string]>([
    // 1. parked → error-parked
    [{ docStatus: 'parked' }, 'error-parked'],
    // precedence: parked beats COMPLETED / docExists
    [{ docStatus: 'parked', roadmapStatus: 'COMPLETED' }, 'error-parked'],
    [{ docStatus: 'parked', docExists: true, roadmapStatus: 'PENDING_REVIEW' }, 'error-parked'],

    // 2. drafting | critic | revising → in-progress
    [{ docStatus: 'drafting' }, 'in-progress'],
    [{ docStatus: 'critic' }, 'in-progress'],
    [{ docStatus: 'revising' }, 'in-progress'],
    // precedence: drafting beats PENDING_REVIEW + docExists
    [{ docStatus: 'drafting', roadmapStatus: 'PENDING_REVIEW', docExists: true }, 'in-progress'],
    // precedence: drafting beats LOCKED
    [{ docStatus: 'drafting', roadmapStatus: 'LOCKED' }, 'in-progress'],

  // 3. passed | auto-approved + open questions flagged on the doc, user not
  // approved yet → needs-review (design §6 "Completed, needs approval"; wins
  // over draft). docStatus passed/auto-approved persists until the user
  // approves (server clears it on approve), so it is the not-user-approved signal.
  [{ docStatus: 'passed', openQuestions: 2 }, 'needs-review'],
  [{ docStatus: 'auto-approved', openQuestions: 1 }, 'needs-review'],
  // wins over draft even with docExists + PENDING_REVIEW
  [{ docStatus: 'passed', docExists: true, roadmapStatus: 'PENDING_REVIEW', openQuestions: 3 }, 'needs-review'],
  [{ docStatus: 'auto-approved', docExists: true, roadmapStatus: 'PENDING_REVIEW', openQuestions: 1 }, 'needs-review'],
  // still needs-review when the artifact was auto-approved (roadmap COMPLETED)
  [{ docStatus: 'auto-approved', roadmapStatus: 'COMPLETED', openQuestions: 1 }, 'needs-review'],
  // parked beats needs-review
  [{ docStatus: 'parked', openQuestions: 2 }, 'error-parked'],
  // drafting beats needs-review
  [{ docStatus: 'drafting', openQuestions: 2 }, 'in-progress'],

  // 2.5 revised (ripple fix applied, critic-free, not re-approved) → needs-review
  [{ docStatus: 'revised' }, 'needs-review'],
  // revised stays needs-review regardless of questions/roadmap (user must review)
  [{ docStatus: 'revised', openQuestions: 2 }, 'needs-review'],
  [{ docStatus: 'revised', roadmapStatus: 'COMPLETED' }, 'needs-review'],

    // 3. auto-approved → approved (+auto); passed → approved
    [{ docStatus: 'auto-approved' }, 'approved'],
    [{ docStatus: 'passed' }, 'approved'],
    // openQuestions 0/absent → plain approved
    [{ docStatus: 'passed', openQuestions: 0 }, 'approved'],
    [{ docStatus: 'auto-approved', roadmapStatus: 'IN_PROGRESS' }, 'approved'],
    [{ docStatus: 'passed', roadmapStatus: 'COMPLETED' }, 'approved'],

    // 4. roadmap COMPLETED → approved
    [{ roadmapStatus: 'COMPLETED' }, 'approved'],
    // precedence: COMPLETED beats docExists
    [{ docExists: true, roadmapStatus: 'COMPLETED' }, 'approved'],
    // board #56/#57 — server-autopilot test 14 web-side mirror: after the user
    // approves, the server clears the autopilot docStatus marker to 'idle' and
    // the roadmap phase is COMPLETED, so the rail must resolve Approved (never
    // Drafted via the docExists rule).
    [{ docStatus: 'idle', docExists: true, roadmapStatus: 'COMPLETED' }, 'approved'],

    // 5. docExists → drafted; PENDING_REVIEW → drafted
    [{ docExists: true }, 'drafted'],
    [{ roadmapStatus: 'PENDING_REVIEW' }, 'drafted'],
    [{ docExists: true, roadmapStatus: 'PENDING_REVIEW' }, 'drafted'],
    // precedence: docExists beats idle + absent roadmap
    [{ docStatus: 'idle', docExists: true }, 'drafted'],

    // 6. roadmap IN_PROGRESS → in-progress
    [{ roadmapStatus: 'IN_PROGRESS' }, 'in-progress'],

    // 7. LOCKED → not-started (+locked sub-flag)
    [{ roadmapStatus: 'LOCKED' }, 'not-started'],

    // 8. default → not-started (idle, no doc, roadmap PENDING/absent)
    [{ docStatus: 'idle', docExists: false, roadmapStatus: 'PENDING' }, 'not-started'],
    [{ docStatus: 'idle' }, 'not-started'],
    [{}, 'not-started'],
  ])('railStateFor(%j).state === %s', (input, expected) => {
    expect(railStateFor(input).state).toBe(expected);
  });

  it('applies the exact design labels', () => {
    expect(railStateFor({ docStatus: 'idle' }).label).toBe('Not started');
    expect(railStateFor({ docStatus: 'drafting' }).label).toBe('In progress');
    expect(railStateFor({ docExists: true }).label).toBe('Drafted — awaiting review');
    expect(railStateFor({ docStatus: 'passed' }).label).toBe('Approved');
    expect(railStateFor({ docStatus: 'parked' }).label).toBe('Error — needs attention');
    // revised: completed by a critic-free ripple fix, not re-approved
    expect(railStateFor({ docStatus: 'revised' }).label).toBe('Completed — not approved');
    // locked variant label
    expect(railStateFor({ roadmapStatus: 'LOCKED' }).label).toBe('Locked — reopen the upstream document');
  });

  it('marks auto-approved with the auto sub-flag; human/roadmap approval without it', () => {
    expect(railStateFor({ docStatus: 'auto-approved' })).toMatchObject({ state: 'approved', auto: true });
    expect(railStateFor({ docStatus: 'auto-approved' }).label).toBe('Approved');
    expect(railStateFor({ docStatus: 'passed' }).auto).toBe(false);
    expect(railStateFor({ roadmapStatus: 'COMPLETED' }).auto).toBe(false);
  });

  it('marks LOCKED as not-started with the locked sub-flag', () => {
    expect(railStateFor({ roadmapStatus: 'LOCKED' })).toMatchObject({ state: 'not-started', locked: true });
    expect(railStateFor({ roadmapStatus: 'PENDING' }).locked).toBe(false);
    expect(railStateFor({}).locked).toBe(false);
  });

  // Design §6 — 4th state: "Completed, needs approval".
  it('marks autopilot-completed docs with open questions as needs-review with the exact label', () => {
    const passed = railStateFor({ docStatus: 'passed', openQuestions: 2 });
    expect(passed.state).toBe('needs-review');
    expect(passed.label).toBe('Completed — needs approval');
    expect(passed.auto).toBe(false);
    const auto = railStateFor({ docStatus: 'auto-approved', openQuestions: 1 });
    expect(auto.state).toBe('needs-review');
    expect(auto.auto).toBe(true);
  });

  it('docNeedsApproval: autopilot completed + open questions flagged on the doc', () => {
    expect(docNeedsApproval({ docStatus: 'passed', openQuestions: 1 })).toBe(true);
    expect(docNeedsApproval({ docStatus: 'auto-approved', openQuestions: 3 })).toBe(true);
    // no questions → plain approved semantics
    expect(docNeedsApproval({ docStatus: 'passed', openQuestions: 0 })).toBe(false);
    expect(docNeedsApproval({ docStatus: 'auto-approved' })).toBe(false);
    // not autopilot-completed → not this state (plain draft / approved / parked)
    expect(docNeedsApproval({ docStatus: 'idle', openQuestions: 5 })).toBe(false);
    expect(docNeedsApproval({ docStatus: 'drafting', openQuestions: 5 })).toBe(false);
    expect(docNeedsApproval({ docStatus: 'parked', openQuestions: 5 })).toBe(false);
  });
});