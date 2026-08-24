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
  it('parses structured JSON evaluation scorecard from Critic and includes program baseline', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    let capturedPrompt = '';
    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (opts) => {
      capturedPrompt = (opts.messages[0].content || '') as string;
      return {
        content: JSON.stringify({
          passed: true,
          score: 9.1,
          summary: 'Excellent hardware specs with verified program alignment',
          strengths: ['Clear load calculations', 'Aligned with approved CONOPS'],
          weaknesses: [],
          actionableGuidance: ''
        }),
        raw: {}
      };
    });

    const critic = new CriticEvaluator(mockClient);
    const result = await critic.evaluate({
      model: 'test-model',
      artifactContent: '# WBS\n1.0 Framing',
      rubric: 'Rigorous engineering',
      secretSauceExamples: ['# Example\n1.0 Foundation'],
      userExamples: [],
      programBaselineDocuments: [
        {
          id: 'CONOPS',
          path: 'docs/CONOPS.md',
          content: '# CONOPS\nOperating voltage: 72V DC'
        }
      ]
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(9.1);
    expect(capturedPrompt).toContain('APPROVED PROGRAM BASELINE');
    expect(capturedPrompt).toContain('Operating voltage: 72V DC');
    expect(capturedPrompt).toContain('Program Alignment & Cross-Document Traceability');
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

  it('injects existing baseline document to evolve when updating an existing document', async () => {
    // Write an existing CONOPS to docs/
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, 'CONOPS.md'),
      '# Concept of Operations\n## 1.0 Executive Summary\nOriginal tractor conversion baseline.',
      'utf-8'
    );
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'Concept of Operations',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.2
    });
    stateMgr.completeIntake();

    let capturedSystemPrompt = '';
    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (opts) => {
      const sysMsg = opts.messages.find(m => m.role === 'system');
      if (sysMsg) capturedSystemPrompt = sysMsg.content as string;
      return {
        content: '# Concept of Operations\n## 1.0 Executive Summary\nUpdated tractor conversion with limp-home mode.',
        raw: {}
      };
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Update CONOPS to add a limp-home mode',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    expect(capturedSystemPrompt).toContain('EXISTING BASELINE DOCUMENT (TO EVOLVE / UPDATE)');
    expect(capturedSystemPrompt).toContain('Original tractor conversion baseline');
    expect(result.output).toContain('Updated tractor conversion with limp-home mode');
  });
});
