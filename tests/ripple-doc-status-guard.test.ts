import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runRippleScan } from '../src/core/ripple.js';
import { ProjectStateManager, defaultAutopilotState } from '../src/workspace/state.js';
import type { AutopilotEvent } from '../src/core/autopilot.js';
import type { TurnResult } from '../src/core/runner.js';

/**
 * Unit seam for the ripple fix-success docStatus guard (critic 55e60194
 * item 3): a successful ripple fix marks a doc 'revised' ONLY from
 * completed statuses ('auto-approved'/'passed') — never from 'idle'/'parked'.
 */
function makeTurnResult(specialistId: string, output: string): TurnResult {
  return {
    specialistId,
    specialistName: specialistId,
    output,
    criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' },
    autoRevisionsRun: 0,
    requiresReview: true,
    sessionMessages: []
  };
}

describe('runRippleScan fix-success docStatus guard', () => {
  let tempDir: string;
  let stateManager: ProjectStateManager;
  let events: AutopilotEvent[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-ripple-guard-'));
    fs.mkdirSync(path.join(tempDir, 'docs', 'work_instructions'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'artifacts'), { recursive: true });
    stateManager = new ProjectStateManager(tempDir);
    stateManager.getOrCreateState('p1', 'Ripple Guard Test');
    events = [];
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('marks an auto-approved doc revised after a successful ripple fix', async () => {
    const st = stateManager.getState();
    st.autopilot = { ...defaultAutopilotState(), docStatus: { conops: 'auto-approved', architecture: 'auto-approved' } };
    stateManager.saveState(st);

    const executeTurn = vi.fn()
      .mockResolvedValueOnce(makeTurnResult('change-impact', 'Discrepancy: docs/ARCHITECTURE.md — Power section stale.'))
      .mockResolvedValueOnce(makeTurnResult('architecture', 'Fixed docs/ARCHITECTURE.md'));

    await runRippleScan(
      { stateManager, executeTurn, emit: ev => events.push(ev) },
      [{ phaseId: 'conops', diff: 'bus voltage changed', external: false }],
      new Set<string>()
    );

    expect(executeTurn).toHaveBeenCalledTimes(2);
    const after = stateManager.getState();
    expect(after.autopilot.docStatus['architecture']).toBe('revised');
    expect(events.some(e => e.kind === 'phase' && e.phaseId === 'architecture' && e.status === 'revised')).toBe(true);
  });

  it('leaves a parked doc untouched after a successful ripple fix', async () => {
    const st = stateManager.getState();
    st.autopilot = { ...defaultAutopilotState(), docStatus: { conops: 'auto-approved', architecture: 'parked' } };
    stateManager.saveState(st);

    const executeTurn = vi.fn()
      .mockResolvedValueOnce(makeTurnResult('change-impact', 'Discrepancy: docs/ARCHITECTURE.md — Power section stale.'))
      .mockResolvedValueOnce(makeTurnResult('architecture', 'Fixed docs/ARCHITECTURE.md'));

    await runRippleScan(
      { stateManager, executeTurn, emit: ev => events.push(ev) },
      [{ phaseId: 'conops', diff: 'bus voltage changed', external: false }],
      new Set<string>()
    );

    expect(executeTurn).toHaveBeenCalledTimes(2);
    const after = stateManager.getState();
    expect(after.autopilot.docStatus['architecture']).toBe('parked');
    expect(events.some(e => e.kind === 'phase' && e.phaseId === 'architecture' && e.status === 'revised')).toBe(false);
  });
});
