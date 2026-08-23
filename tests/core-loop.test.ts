import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runAgentToolLoop } from '../src/core/agent-loop.js';
import { CriticEvaluator } from '../src/core/critic.js';
import { CoreRunner } from '../src/core/runner.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { ProjectStateManager } from '../src/workspace/state.js';

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

describe('Core Runner Intake & Multi-Turn', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;
  let mockClient: OpenRouterClient;
  let toolRegistry: ToolRegistry;
  let specialistRegistry: SpecialistRegistry;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-runner-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('p1', 'Tractor Test');
    mockClient = new OpenRouterClient({ apiKey: 'mock' });
    toolRegistry = new ToolRegistry();
    specialistRegistry = new SpecialistRegistry();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('blocks RTM execution if REQUIREMENTS artifact is not approved', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: JSON.stringify({ specialistId: 'rtm', reason: 'RTM requested' }),
      raw: {}
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Generate an RTM matrix for the tractor',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    expect(result.specialistId).toBe('general');
    expect(result.output).toContain('Prerequisite Required');
    expect(result.output).toContain('REQUIREMENTS.md');
  });

  it('initiates 1-by-1 intake when no CONOPS exists on a new project', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: JSON.stringify({ specialistId: 'conops', reason: 'CONOPS requested' }),
      raw: {}
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Start the project and make a CONOPS',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    expect(result.specialistId).toBe('conops');
    expect(result.requiresReview).toBe(false); // Question turn, not a full document
    expect(result.output).toContain('What is the project?');
  });
});
