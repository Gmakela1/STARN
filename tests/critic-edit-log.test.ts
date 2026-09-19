import { describe, it, expect, vi } from 'vitest';
import { CriticEvaluator } from '../src/core/critic.js';
import { EditEntry } from '../src/tools/types.js';

describe('Critic appliedEdits change log', () => {
  it('includes the change log in the critic prompt when appliedEdits is provided', async () => {
    const captured: string[] = [];
    const mockClient = {
      chatCompletion: vi.fn(async (opts: any) => {
        captured.push(opts.messages[0].content);
        return {
          content: JSON.stringify({
            passed: true,
            score: 9,
            summary: 'ok',
            strengths: ['good'],
            weaknesses: [],
            actionableGuidance: ''
          }),
          toolCalls: []
        };
      })
    } as any;

    const edits: EditEntry[] = [
      {
        path: 'docs/CONOPS.md',
        oldText: 'TBD: battery',
        newText: '48V LiFePO4',
        matchedLineRange: { start: 42, end: 42 },
        timestamp: '2026-09-16T00:00:00.000Z'
      }
    ];

    const critic = new CriticEvaluator(mockClient);
    await critic.evaluate({
      model: 'test-model',
      artifactContent: '# CONOPS\n\n48V LiFePO4',
      rubric: 'rubric',
      secretSauceExamples: [],
      userExamples: [],
      appliedEdits: edits
    });

    expect(captured.length).toBe(1);
    const prompt = captured[0];
    expect(prompt).toContain('TARGETED EDITS APPLIED THIS TURN');
    expect(prompt).toContain('docs/CONOPS.md');
    expect(prompt).toContain('TBD: battery');
    expect(prompt).toContain('48V LiFePO4');
    expect(prompt).toContain('L42-42');
  });

  it('omits the change log section when appliedEdits is empty or absent', async () => {
    const captured: string[] = [];
    const mockClient = {
      chatCompletion: vi.fn(async (opts: any) => {
        captured.push(opts.messages[0].content);
        return {
          content: JSON.stringify({ passed: true, score: 9, summary: 'ok', strengths: [], weaknesses: [], actionableGuidance: '' }),
          toolCalls: []
        };
      })
    } as any;

    const critic = new CriticEvaluator(mockClient);
    await critic.evaluate({
      model: 'test-model',
      artifactContent: '# Doc',
      rubric: 'r',
      secretSauceExamples: [],
      userExamples: []
    });

    expect(captured[0]).not.toContain('TARGETED EDITS APPLIED THIS TURN');
  });
});
