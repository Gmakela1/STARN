import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentToolLoop } from '../src/core/agent-loop.js';
import { CriticEvaluator } from '../src/core/critic.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { OpenRouterClient } from '../src/openrouter/client.js';

describe('Agent Tool Loop', () => {
  let mockClient: OpenRouterClient;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    mockClient = new OpenRouterClient({ apiKey: 'mock' });
    toolRegistry = new ToolRegistry();
  });

  it('runs tool execution and returns final assistant message', async () => {
    let callCount = 0;
    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: null,
          toolCalls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'state_read', arguments: '{}' }
            }
          ],
          raw: {}
        };
      }
      return {
        content: 'Finalized physical project analysis.',
        raw: {}
      };
    });

    const context = { projectPath: '.', stateManager: { getState: () => ({ name: 'Test' }) } as any };
    const result = await runAgentToolLoop({
      client: mockClient,
      model: 'test-model',
      systemPrompt: 'System instructions',
      userMessage: 'Analyze project',
      toolRegistry,
      allowedTools: ['state_read'],
      context
    });

    expect(result.finalResponse).toBe('Finalized physical project analysis.');
    expect(callCount).toBe(2);
  });
});

describe('Critic Evaluator', () => {
  it('parses structured JSON evaluation scorecard from Critic', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: JSON.stringify({
        passed: true,
        score: 9.1,
        summary: 'Excellent hardware specs',
        strengths: ['Clear load calculations'],
        weaknesses: [],
        actionableGuidance: ''
      }),
      raw: {}
    });

    const critic = new CriticEvaluator(mockClient);
    const result = await critic.evaluate({
      model: 'test-model',
      artifactContent: '# WBS\n1.0 Framing',
      rubric: 'Rigorous engineering',
      secretSauceExamples: ['# Example\n1.0 Foundation'],
      userExamples: []
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(9.1);
  });
});
