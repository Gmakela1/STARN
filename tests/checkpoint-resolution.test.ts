import { describe, it, expect, vi } from 'vitest';
import {
  resolvePendingCheckpoint,
  PendingCheckpoint,
  CheckpointResolutionDeps
} from '../src/core/checkpoint-resolution.js';

const basePending: PendingCheckpoint = {
  specialistId: 'action-03',
  specialistName: 'Action 03',
  output: '# Action 03 (turn output)',
  criticResult: {
    passed: false,
    score: 6.5,
    summary: 'Needs work',
    strengths: [],
    weaknesses: ['Missing safety analysis', 'Vague acceptance criteria'],
    actionableGuidance: 'Add a dedicated safety section.'
  },
  createdAt: '2026-11-03T00:00:00.000Z'
};

/** Standard mock deps: no real fs, no real state manager, no session. */
function makeDeps(overrides: Partial<CheckpointResolutionDeps> = {}): CheckpointResolutionDeps {
  return {
    outPath: '/proj/docs/ACTION-03.md',
    readDiskArtifact: vi.fn(() => null),
    readActivePhase: vi.fn(() => 'verify'),
    normalizeSavedPath: vi.fn((abs: string) => abs.replace(/^\/proj\//, '').replace(/\\/g, '/')),
    approve: vi.fn(async () => {}),
    ...overrides
  };
}

describe('resolvePendingCheckpoint', () => {
  it('discard returns { status: "discarded" } and never calls approve or reads disk', async () => {
    const deps = makeDeps();
    const result = await resolvePendingCheckpoint(basePending, 'discard', 'ignore me', deps);
    expect(result).toEqual({ status: 'discarded' });
    expect(deps.approve).not.toHaveBeenCalled();
    expect(deps.readDiskArtifact).not.toHaveBeenCalled();
    expect(deps.readActivePhase).not.toHaveBeenCalled();
  });

  it('revise enriches the feedback with the critic guidance', async () => {
    const deps = makeDeps();
    const result = await resolvePendingCheckpoint(basePending, 'revise', 'Please address the gaps', deps);
    expect(result.status).toBe('revision_requested');
    if (result.status !== 'revision_requested') return;
    expect(result.revisionPrompt).toContain('Please address the gaps');
    expect(result.revisionPrompt).toContain('Missing safety analysis');
    expect(result.revisionPrompt).toContain('Vague acceptance criteria');
    expect(result.revisionPrompt).toContain('Actionable Guidance: Add a dedicated safety section.');
    expect(deps.approve).not.toHaveBeenCalled();
  });

  it('revise falls back to the default instruction when feedback is undefined', async () => {
    const deps = makeDeps();
    const result = await resolvePendingCheckpoint(basePending, 'revise', undefined, deps);
    expect(result.status).toBe('revision_requested');
    if (result.status !== 'revision_requested') return;
    expect(result.revisionPrompt).toContain('Please revise the deliverable.');
  });

  it('approve prefers the "# "-headed disk artifact over the turn output', async () => {
    const diskContent = '# Action 03\n\nApproved by human.';
    const deps = makeDeps({ readDiskArtifact: vi.fn(() => diskContent) });

    const result = await resolvePendingCheckpoint(basePending, 'approve', undefined, deps);

    expect(result).toEqual({ status: 'approved', savedPath: 'docs/ACTION-03.md', nextPhase: 'verify' });
    expect(deps.readDiskArtifact).toHaveBeenCalledWith('/proj/docs/ACTION-03.md');
    expect(deps.normalizeSavedPath).toHaveBeenCalledWith('/proj/docs/ACTION-03.md');
    expect(deps.approve).toHaveBeenCalledTimes(1);
    expect(deps.approve).toHaveBeenCalledWith({
      specialistId: 'action-03',
      content: diskContent,
      title: 'Action 03 Document',
      criticScore: 6.5
    });
  });

  it('approve falls back to the turn output when the disk artifact is null', async () => {
    const deps = makeDeps({ readDiskArtifact: vi.fn(() => null) });

    const result = await resolvePendingCheckpoint(basePending, 'approve', undefined, deps);

    expect(result.status).toBe('approved');
    expect(deps.approve).toHaveBeenCalledTimes(1);
    expect(deps.approve).toHaveBeenCalledWith({
      specialistId: 'action-03',
      content: basePending.output,
      title: 'Action 03 Document',
      criticScore: 6.5
    });
  });

  it('approve omits criticScore when the pending checkpoint has no critic result', async () => {
    const pendingNoCritic = { ...basePending, criticResult: undefined };
    const deps = makeDeps();

    const result = await resolvePendingCheckpoint(pendingNoCritic, 'approve', undefined, deps);

    expect(result.status).toBe('approved');
    expect(deps.approve).toHaveBeenCalledTimes(1);
    expect(deps.approve).toHaveBeenCalledWith({
      specialistId: 'action-03',
      content: pendingNoCritic.output,
      title: 'Action 03 Document',
      criticScore: undefined
    });
  });

  it('approve reads nextPhase from state AFTER approval resolves', async () => {
    const state = { workflow: { activePhase: 'bom' } };
    const deps = makeDeps({
      readActivePhase: vi.fn(() => state.workflow.activePhase),
      approve: vi.fn(async () => {
        // The approval advances the workflow to the next phase.
        state.workflow.activePhase = 'verify';
      })
    });

    const result = await resolvePendingCheckpoint(basePending, 'approve', undefined, deps);

    expect(result.status).toBe('approved');
    if (result.status !== 'approved') return;
    expect(result.nextPhase).toBe('verify');
  });

  it('approve errors propagate to the caller (not swallowed)', async () => {
    const deps = makeDeps({
      approve: vi.fn(async () => {
        throw new Error('write failed');
      })
    });

    await expect(resolvePendingCheckpoint(basePending, 'approve', undefined, deps)).rejects.toThrow('write failed');
  });
});