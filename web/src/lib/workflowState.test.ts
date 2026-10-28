import { describe, expect, it } from 'vitest';
import { railStateFor } from './workflowState';

// Design §5.F — mapping table (real states → 5-state rail) plus the literal
// precedence order. Real literals verified against src/core/autopilot.ts
// (AutopilotDocStatus) and web/src/types/api.ts (RoadmapStatus).
describe('railStateFor', () => {
  // Every row of the design's mapping table + precedence conflicts. First match wins.
  it.each<[Record<string, string | boolean | undefined>, string]>([
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

    // 3. auto-approved → approved (+auto); passed → approved
    [{ docStatus: 'auto-approved' }, 'approved'],
    [{ docStatus: 'passed' }, 'approved'],
    // precedence: auto-approved beats roadmap IN_PROGRESS
    [{ docStatus: 'auto-approved', roadmapStatus: 'IN_PROGRESS' }, 'approved'],
    [{ docStatus: 'passed', roadmapStatus: 'COMPLETED' }, 'approved'],

    // 4. roadmap COMPLETED → approved
    [{ roadmapStatus: 'COMPLETED' }, 'approved'],
    // precedence: COMPLETED beats docExists
    [{ docExists: true, roadmapStatus: 'COMPLETED' }, 'approved'],

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
});