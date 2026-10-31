// Purpose: unit tests for the critic's stage hint (Stage-1 pre-sourcing
// exemption) and the grounding carve-outs for truthful pre-sourcing BOM rows.
import { describe, it, expect, vi } from 'vitest';
import { CriticEvaluator, CriticEvaluateOptions, detectStageHint } from '../src/core/critic.js';

function makeCritic(capturedPrompt: string[]): CriticEvaluator {
  const mockClient = {
    chatCompletion: vi.fn(async (opts: any) => {
      capturedPrompt.push(opts.messages[0].content);
      return {
        content: JSON.stringify({
          passed: true,
          score: 8.5,
          summary: 'ok',
          strengths: [],
          weaknesses: [],
          actionableGuidance: ''
        }),
        toolCalls: []
      };
    })
  } as any;
  return new CriticEvaluator(mockClient);
}

function makeOptions(overrides: Partial<CriticEvaluateOptions> = {}): CriticEvaluateOptions {
  return {
    model: 'test-model',
    artifactContent: '# BOM\n\nStage: 1 — Pre-Sourcing (Grocery List)\n\n| SS01-01 | Candidate — unverified |',
    rubric: 'BOM Rubric',
    secretSauceExamples: [],
    userExamples: [],
    ...overrides
  };
}

describe('detectStageHint', () => {
  it('returns the stage number from a Stage marker line', () => {
    expect(detectStageHint('# BOM\n\nStage: 1 — Pre-Sourcing (Grocery List)\n')).toBe('1');
    expect(detectStageHint('# BOM\n\nStage: 2 — Sourced (Procurement Ledger)\n')).toBe('2');
  });

  it('returns undefined when no stage marker is present', () => {
    expect(detectStageHint('# BOM\n\nNo marker here')).toBeUndefined();
    expect(detectStageHint('')).toBeUndefined();
  });

  it('ignores stage mentions not at line start', () => {
    expect(detectStageHint('# BOM\n\nsee Stage: 1 for details')).toBeUndefined();
  });
});

describe('CriticEvaluator stage hint + grounding carve-outs', () => {
  it('injects a Stage-1 exemption block when stageHint is set', async () => {
    const captured: string[] = [];
    const critic = makeCritic(captured);
    await critic.evaluate(makeOptions({ stageHint: '1' }));
    expect(captured[0]).toContain('STAGE HINT (Stage 1)');
    expect(captured[0]).toContain('EXEMPT from verified-URL');
    expect(captured[0]).toContain('variance not computable yet');
  });

  it('omits the stage block when no stageHint is given', async () => {
    const captured: string[] = [];
    const critic = makeCritic(captured);
    await critic.evaluate(makeOptions());
    expect(captured[0]).not.toContain('STAGE HINT');
  });

  it('full-mode prompt carries the grounding carve-outs', async () => {
    const captured: string[] = [];
    const critic = makeCritic(captured);
    await critic.evaluate(makeOptions({ artifactContent: '# BOM' }));
    // (a) user-supplied PNs/URLs are grounded, not invented
    expect(captured[0]).toContain('count as grounded, NOT invented');
    // (b) Blocked/TBD rows tied to open questions are honest
    expect(captured[0]).toContain('honest flags, NOT vague placeholders');
    // (c) trade-study alternatives must be generic classes unless user-sourced
    expect(captured[0]).toContain('generic part classes unless user-sourced');
    // (d) variance satisfied by explicit why-not-computable statement
    expect(captured[0]).toContain('why variance is not yet computable');
    // baseline figures stay binding despite user reconsideration requests
    expect(captured[0]).toContain('REMAINS the approved basis pending formal revision');
  });

  it('delta-mode prompt carries the user-supplied grounding carve-out', async () => {
    const captured: string[] = [];
    const critic = makeCritic(captured);
    await critic.evaluate(makeOptions({
      mode: 'delta',
      artifactContent: '# BOM',
      priorScore: 8.5,
      userPrompt: 'incorporate answer'
    }));
    expect(captured[0]).toContain('DELTA EVALUATION');
    expect(captured[0]).toContain('count as grounded, NOT invented');
    expect(captured[0]).toContain('honest flags, NOT vague placeholders');
  });
});
