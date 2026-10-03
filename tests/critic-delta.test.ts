import { describe, it, expect, vi } from 'vitest';
import { CriticEvaluator, CriticEvaluateOptions } from '../src/core/critic.js';
import { EditEntry } from '../src/tools/types.js';

describe('CriticEvaluator Delta Review Mode', () => {
  it('generates a specialized Delta Review prompt when mode is delta', async () => {
    let capturedPrompt = '';
    const mockClient = {
      chatCompletion: vi.fn(async (opts: any) => {
        capturedPrompt = opts.messages[0].content;
        return {
          content: JSON.stringify({
            passed: true,
            score: 9.0,
            summary: 'Edits accurately integrated with zero regressions.',
            strengths: ['Accurate PTO integration'],
            weaknesses: [],
            actionableGuidance: ''
          }),
          toolCalls: []
        };
      })
    } as any;

    const edits: EditEntry[] = [
      {
        path: 'docs/ARCHITECTURE.md',
        oldText: 'TBD: rear power delivery',
        newText: 'Rear 540 RPM PTO with independent clutch',
        matchedLineRange: { start: 50, end: 50 },
        timestamp: '2026-10-03T00:00:00.000Z'
      }
    ];

    const critic = new CriticEvaluator(mockClient);
    const options: CriticEvaluateOptions = {
      model: 'test-model',
      artifactContent: '# System Architecture\n\nRear 540 RPM PTO with independent clutch',
      rubric: 'Architecture Rubric',
      secretSauceExamples: [],
      userExamples: [],
      mode: 'delta',
      priorScore: 8.9,
      userPrompt: 'Use a rear 540 RPM PTO for power delivery',
      appliedEdits: edits
    };

    const result = await critic.evaluate(options);

    expect(result.passed).toBe(true);
    expect(result.score).toBe(9.0);

    // Delta-specific prompt verifications
    expect(capturedPrompt).toContain('DELTA EVALUATION');
    expect(capturedPrompt).toContain('USER REQUEST / ANSWERS TO INCORPORATE:');
    expect(capturedPrompt).toContain('Use a rear 540 RPM PTO for power delivery');
    expect(capturedPrompt).toContain('PRIOR BASELINE SCORE: 8.9/10');
    expect(capturedPrompt).toContain('TARGETED EDITS APPLIED THIS TURN');
    expect(capturedPrompt).toContain('Rear 540 RPM PTO with independent clutch');
    expect(capturedPrompt).toContain('Intent Fidelity');
    expect(capturedPrompt).toContain('Document-Wide Consistency');
    expect(capturedPrompt).toContain('Do NOT fail or dock points for styling, depth, or formatting in sections that were NOT touched by these edits');
    // Ensure clean-sheet generic header is NOT used in delta mode
    expect(capturedPrompt).not.toContain('apples-to-oranges');
  });

  it('preserves clean-sheet full review prompt when mode is full or omitted', async () => {
    let capturedPrompt = '';
    const mockClient = {
      chatCompletion: vi.fn(async (opts: any) => {
        capturedPrompt = opts.messages[0].content;
        return {
          content: JSON.stringify({
            passed: true,
            score: 8.5,
            summary: 'Initial draft approved',
            strengths: ['Complete coverage'],
            weaknesses: [],
            actionableGuidance: ''
          }),
          toolCalls: []
        };
      })
    } as any;

    const critic = new CriticEvaluator(mockClient);
    await critic.evaluate({
      model: 'test-model',
      artifactContent: '# System Architecture\nFull draft',
      rubric: 'Architecture Rubric',
      secretSauceExamples: [],
      userExamples: []
    });

    expect(capturedPrompt).toContain('Conduct an "apples-to-oranges" quality comparison');
    expect(capturedPrompt).not.toContain('DELTA EVALUATION');
    expect(capturedPrompt).not.toContain('PRIOR BASELINE SCORE:');
  });
});
