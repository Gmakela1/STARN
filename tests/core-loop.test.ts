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
      artifactContent: '# ARCHITECTURE\n1.0 System Architecture',
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
    tempDir = path.join(os.tmpdir(), 'starn-runner-test-' + Date.now() + '-' + Math.random().toString(36).substring(2));
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

  it('blocks RTM execution if BOM artifact is not approved', async () => {
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
    expect(result.output).toContain('BOM.md');
  });

  it('blocks Milestones execution if RTM artifact is not approved', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: JSON.stringify({ specialistId: 'milestones', reason: 'Milestones requested' }),
      raw: {}
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the project milestones',
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
    expect(result.output).toContain('RTM.md');
  });

  it('blocks Test Plans execution if MILESTONES artifact is not approved', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: JSON.stringify({ specialistId: 'testplans', reason: 'Test plans requested' }),
      raw: {}
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the test procedures',
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
    expect(result.output).toContain('MILESTONES.md');
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
    expect(result.output).toContain('captured your project description');
    expect(result.output).toContain('walk me through how you envision using this');
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

  it('reads the document from disk (not the model summary) when fs_edit was used this turn', async () => {
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, 'ARCHITECTURE.md'),
      '# System Architecture\n## 1 Overview\nOriginal architecture with TBD battery.\n',
      'utf-8'
    );
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'Concept of Operations',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.0
    });
    stateMgr.recordArtifact({
      id: 'ARCHITECTURE',
      title: 'System Architecture',
      path: 'docs/ARCHITECTURE.md',
      status: 'approved',
      criticScore: 9.0
    });
    stateMgr.completeIntake();

    let criticPrompt = '';
    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (opts) => {
      const msg = opts.messages[0];
      const content = typeof msg.content === 'string' ? msg.content : '';
      // Classifier call: route to architecture.
      if (content.includes('Request Classifier for STARN')) {
        return { content: '{"specialistId":"architecture","reason":"update"}', raw: {} };
      }
      // Agent-loop call: respond with a revision SUMMARY (not the doc),
      // but actually perform the edit on disk (as fs_edit would).
      if (content.includes('EXISTING BASELINE') || content.includes('System Architecture Specialist')) {
        fs.writeFileSync(
          path.join(docsDir, 'ARCHITECTURE.md'),
          '# System Architecture\n## 1 Overview\nUpdated architecture with 48V LiFePO4 battery.\n',
          'utf-8'
        );
        return {
          // A summary that contains a '# ' substring (a quoted heading) — the
          // old heuristic treats this as the document (the bug).
          content: 'I updated # 1 Overview to specify the 48V LiFePO4 battery per your answer.',
          raw: {}
        };
      }
      // The critic call: capture its prompt.
      if (content.includes('Harsh Critic')) {
        criticPrompt = content;
        return {
          content: JSON.stringify({ passed: true, score: 9.0, summary: 'ok', strengths: [], weaknesses: [], actionableGuidance: '' }),
          raw: {}
        };
      }
      return { content: '', raw: {} };
    });

    await CoreRunner.executeTurn({
      userPrompt: 'Update the architecture to use the 48V battery',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    // The critic must receive the FULL DOCUMENT from disk, not the summary.
    expect(criticPrompt).toContain('# System Architecture');
    expect(criticPrompt).toContain('Updated architecture with 48V LiFePO4 battery');
    expect(criticPrompt).not.toContain('I updated # 1 Overview to specify');
  });

  it('invokes Critic in delta mode with prior score and surgical revision guidance on edit turns', async () => {
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, 'CONOPS.md'),
      '# Concept of Operations\nBaseline',
      'utf-8'
    );
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'Concept of Operations',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.3
    });
    stateMgr.completeIntake();

    let capturedCriticPrompt = '';
    let capturedRevisionPrompt = '';

    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (opts: any) => {
      const msg = opts.messages[0];
      const content = typeof msg.content === 'string' ? msg.content : '';

      // Classifier
      if (content.includes('Request Classifier for STARN')) {
        return { content: '{"specialistId":"conops","reason":"edit"}', raw: {} };
      }
      // Specialist turn (simulating an edit)
      if (content.includes('CONOPS & Systems Architect Specialist') || content.includes('EXISTING BASELINE')) {
        // If this is a revision loop call, capture the revision user prompt
        const userMsg = opts.messages.find((m: any) => m.role === 'user');
        if (userMsg && userMsg.content.includes('The Critic evaluated your')) {
          capturedRevisionPrompt = userMsg.content;
        }

        fs.writeFileSync(
          path.join(docsDir, 'CONOPS.md'),
          '# Concept of Operations\nBaseline with 540 RPM PTO',
          'utf-8'
        );
        return { content: 'I updated Section 3 for PTO.', raw: {} };
      }
      // Critic evaluation
      if (content.includes('Critic')) {
        capturedCriticPrompt = content;
        // Fail the first critic call to trigger auto-revision
        return {
          content: JSON.stringify({
            passed: false,
            score: 7.5,
            summary: 'Minor inconsistency in Section 4',
            strengths: [],
            weaknesses: ['Section 4 still mentions belt drive'],
            actionableGuidance: 'Update Section 4 to match PTO'
          }),
          raw: {}
        };
      }
      return { content: '', raw: {} };
    });

    await CoreRunner.executeTurn({
      userPrompt: 'Add a 540 RPM PTO to CONOPS',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    // Critic prompt must be in delta mode with prior score and user prompt
    expect(capturedCriticPrompt).toContain('DELTA EVALUATION');
    expect(capturedCriticPrompt).toContain('PRIOR BASELINE SCORE: 9.3/10');
    expect(capturedCriticPrompt).toContain('Add a 540 RPM PTO to CONOPS');

    // Auto-revision prompt must instruct surgical fs_edit instead of full rewrite
    expect(capturedRevisionPrompt).toContain('targeted edits');
    expect(capturedRevisionPrompt).toContain('Use the fs_edit tool to surgically resolve');
    expect(capturedRevisionPrompt).not.toContain('Please revise the deliverable to resolve all weaknesses');
  });

  it('appends critic evaluation summary and actionable guidance to sessionMessages', async () => {
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'Concept of Operations',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.0
    });
    stateMgr.completeIntake();

    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (opts: any) => {
      const content = String(opts.messages[0]?.content || '');
      if (content.includes('Request Classifier for STARN')) {
        return { content: '{"specialistId":"conops","reason":"refine"}', raw: {} };
      }
      if (content.includes('CONOPS & Systems Architect Specialist') || content.includes('EXISTING BASELINE')) {
        return { content: '# Concept of Operations\n\nFull deliverable text.', raw: {} };
      }
      if (content.includes('Critic')) {
        return {
          content: JSON.stringify({
            passed: true,
            score: 8.9,
            summary: 'Strong CONOPS foundation.',
            strengths: ['Clear operational modes'],
            weaknesses: ['PTO spline dimension omitted'],
            actionableGuidance: 'Specify 1-3/8 inch 6-spline shaft in Section 3.2.'
          }),
          raw: {}
        };
      }
      return { content: '', raw: {} };
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Review the CONOPS',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    const lastMsg = result.sessionMessages[result.sessionMessages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('[Critic Review for CONOPS & User Intent]');
    expect(lastMsg.content).toContain('Score: 8.9/10');
    expect(lastMsg.content).toContain('Specify 1-3/8 inch 6-spline shaft in Section 3.2.');
    expect(lastMsg.content).toContain('PTO spline dimension omitted');
  });
});
