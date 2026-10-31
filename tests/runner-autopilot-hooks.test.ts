import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CoreRunner } from '../src/core/runner.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { ProjectStateManager } from '../src/workspace/state.js';

/**
 * Autopilot hooks: forceSpecialistId routing, post-critic onQuestions parsing,
 * and the criticFailed flag. Mock pattern mirrors core-loop.test.ts — a mock
 * OpenRouterClient whose chatCompletion is content-routed by marker lines
 * (classifier 'Request Classifier for STARN', specialist prompt, critic 'Harsh Critic').
 */

interface BomMockOptions {
  /** Content written to docs/BOM.md on the initial draft tool-loop call. */
  draftContent: string;
  /** When set, content written to docs/BOM.md on a critic-triggered revision call. */
  revisionContent?: string;
  /** Ordered critic evaluation results, consumed per critic call. */
  criticResults: Array<{ passed: boolean; score: number }>;
  /** When true, the classifier branch THROWS if it is ever invoked. */
  classifierThrows?: boolean;
  /** Counter incremented whenever the classifier marker is seen. */
  onClassifier?: () => void;
}

function bomDocWithOpenQuestions(questionTexts: string[]): string {
  const questions = questionTexts.map((q, i) => `Q${i + 1}. ${q}`).join('\n');
  return `# Bill of Materials (BOM)\n\n## 1. Master Ledger\n\n| Item | Part |\n| --- | --- |\n\n## Open Questions\n${questions}\n`;
}

function installBomMock(dir: string, client: OpenRouterClient, opts: BomMockOptions) {
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  return vi.spyOn(client, 'chatCompletion').mockImplementation(async (o: any) => {
    const msg = o.messages[0];
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.includes('Request Classifier for STARN')) {
      opts.onClassifier?.();
      if (opts.classifierThrows) {
        throw new Error('classifier must never fire when forceSpecialistId is set');
      }
      return { content: JSON.stringify({ specialistId: 'bom', reason: 'classify' }), raw: {} };
    }
    if (content.includes('Harsh Critic')) {
      const res = opts.criticResults.shift() ?? { passed: true, score: 9.0 };
      return {
        content: JSON.stringify({
          passed: res.passed,
          score: res.score,
          summary: 'critic review',
          strengths: [],
          weaknesses: res.passed ? [] : ['Open questions section needs revision'],
          actionableGuidance: res.passed ? '' : 'Rewrite the open questions section'
        }),
        raw: {}
      };
    }
    // Specialist drafting/revision call (BOM system prompt marker).
    if (content.includes('Bill of Materials (BOM) Specialist') || content.includes('EXISTING BASELINE')) {
      const userMsg = o.messages.find((m: any) => m.role === 'user');
      const userText = typeof userMsg?.content === 'string' ? userMsg.content : '';
      let writeContent = opts.draftContent;
      if (opts.revisionContent && userText.includes('The Critic evaluated your')) {
        writeContent = opts.revisionContent;
      }
      fs.writeFileSync(path.join(docsDir, 'BOM.md'), writeContent, 'utf-8');
      return { content: 'I drafted the BOM.', raw: {} };
    }
    return { content: '', raw: {} };
  });
}

function approveRequirements(stateMgr: ProjectStateManager, dir: string): void {
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'REQUIREMENTS.md'), '# Requirements\nApproved baseline.', 'utf-8');
  stateMgr.recordArtifact({
    id: 'REQUIREMENTS',
    title: 'Engineering Requirements',
    path: 'docs/REQUIREMENTS.md',
    status: 'approved',
    criticScore: 8.8
  });
}

describe('Core Runner autopilot hooks', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;
  let mockClient: OpenRouterClient;
  let toolRegistry: ToolRegistry;
  let specialistRegistry: SpecialistRegistry;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-autopilot-hooks-' + Date.now() + '-' + Math.random().toString(36).substring(2));
    fs.mkdirSync(tempDir, { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('p1', 'Tractor Test');
    stateMgr.completeIntake();
    mockClient = new OpenRouterClient({ apiKey: 'mock' });
    toolRegistry = new ToolRegistry();
    specialistRegistry = new SpecialistRegistry();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('forceSpecialistId routes directly and the classifier is never called', async () => {
    approveRequirements(stateMgr, tempDir);
    let classifierCalls = 0;
    installBomMock(tempDir, mockClient, {
      draftContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter before ordering.']),
      criticResults: [{ passed: true, score: 9.0 }],
      classifierThrows: true,
      onClassifier: () => { classifierCalls++; }
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      sessionMessages: []
    });

    expect(classifierCalls).toBe(0);
    expect(result.specialistId).toBe('bom');
  });

  it('forceSpecialistId still produces a normal specialist TurnResult', async () => {
    approveRequirements(stateMgr, tempDir);
    installBomMock(tempDir, mockClient, {
      draftContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter.']),
      criticResults: [{ passed: true, score: 9.2 }]
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      sessionMessages: []
    });

    expect(result.specialistId).toBe('bom');
    expect(result.specialistName).toBe('Bill of Materials (BOM)');
    expect(result.requiresReview).toBe(true);
    expect(result.criticResult?.passed).toBe(true);
    expect(result.output).toContain('I drafted the BOM');
    expect(fs.existsSync(path.join(tempDir, 'docs', 'BOM.md'))).toBe(true);
  });

  it('forceSpecialistId with an unknown id falls back to normal classification', async () => {
    approveRequirements(stateMgr, tempDir);
    let classifierCalls = 0;
    installBomMock(tempDir, mockClient, {
      draftContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter.']),
      criticResults: [{ passed: true, score: 9.0 }],
      onClassifier: () => { classifierCalls++; }
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'no-such-specialist',
      sessionMessages: []
    });

    expect(classifierCalls).toBe(1);
    expect(result.specialistId).toBe('bom');
  });

  it('onQuestions fires exactly once with all parsed open questions', async () => {
    approveRequirements(stateMgr, tempDir);
    installBomMock(tempDir, mockClient, {
      draftContent: bomDocWithOpenQuestions([
        'Confirm motor shaft pilot diameter before ordering.',
        'Select the main contactor mounting location.',
        'Verify brake resistor wattage for regenerative braking.'
      ]),
      criticResults: [{ passed: true, score: 8.9 }]
    });
    const hook = vi.fn();

    await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      onQuestions: hook,
      sessionMessages: []
    });

    expect(hook).toHaveBeenCalledTimes(1);
    const items = hook.mock.calls[0][0];
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      type: 'question',
      severity: 'normal',
      docPath: 'docs/BOM.md',
      source: 'autopilot'
    });
    expect(items[0].title).toContain('pilot diameter');
    expect(items.map((i: { title: string }) => i.title)).toEqual([
      'Confirm motor shaft pilot diameter before ordering.',
      'Select the main contactor mounting location.',
      'Verify brake resistor wattage for regenerative braking.'
    ]);
  });

  it('onQuestions parses the FINAL content after critic revisions settle', async () => {
    approveRequirements(stateMgr, tempDir);
    installBomMock(tempDir, mockClient, {
      // Initial draft contains question A; the critic-triggered revision
      // REWRITES the doc with question B.
      draftContent: bomDocWithOpenQuestions(['Question A from the initial draft.']),
      revisionContent: bomDocWithOpenQuestions(['Question B written during the critic revision.']),
      criticResults: [
        { passed: false, score: 4.0 },
        { passed: true, score: 8.5 }
      ]
    });
    const hook = vi.fn();

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      onQuestions: hook,
      sessionMessages: []
    });

    expect(result.autoRevisionsRun).toBe(1);
    expect(hook).toHaveBeenCalledTimes(1);
    const items = hook.mock.calls[0][0];
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('Question B');
    expect(items[0].title).not.toContain('Question A');
  });

  it('onQuestions posts only NEW questions — pre-existing open questions are never re-posted', async () => {
    approveRequirements(stateMgr, tempDir);
    // The doc already had an open question before this turn ran.
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'BOM.md'),
      bomDocWithOpenQuestions(['Old question already on the board.']),
      'utf-8'
    );
    installBomMock(tempDir, mockClient, {
      // The regenerated doc keeps the old question (renumbered) and adds one new.
      draftContent: bomDocWithOpenQuestions([
        'Old question already on the board.',
        'Fresh question raised this turn.'
      ]),
      criticResults: [{ passed: true, score: 9.0 }]
    });
    const hook = vi.fn();

    await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      onQuestions: hook,
      sessionMessages: []
    });

    expect(hook).toHaveBeenCalledTimes(1);
    const items = hook.mock.calls[0][0];
    expect(items.map((i: { title: string }) => i.title)).toEqual([
      'Fresh question raised this turn.'
    ]);
  });

  it('criticFailed is true only when the critic loop exhausts both revisions without passing', async () => {
    approveRequirements(stateMgr, tempDir);
    installBomMock(tempDir, mockClient, {
      draftContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter.']),
      criticResults: [
        { passed: false, score: 3.0 },
        { passed: false, score: 3.2 },
        { passed: false, score: 3.5 }
      ]
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      sessionMessages: []
    });

    expect(result.autoRevisionsRun).toBe(2);
    expect(result.criticResult?.passed).toBe(false);
    expect(result.criticFailed).toBe(true);
  });

  it('criticFailed is false when the critic passes on a later revision', async () => {
    approveRequirements(stateMgr, tempDir);
    installBomMock(tempDir, mockClient, {
      draftContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter.']),
      revisionContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter.']),
      criticResults: [
        { passed: false, score: 4.0 },
        { passed: true, score: 8.7 }
      ]
    });

    const passedOnRevision2 = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      sessionMessages: []
    });

    expect(passedOnRevision2.autoRevisionsRun).toBe(1);
    expect(passedOnRevision2.criticResult?.passed).toBe(true);
    expect(passedOnRevision2.criticFailed).toBe(false);

    // Passed on the FIRST attempt (no revisions at all).
    const docsDir = path.join(tempDir, 'docs');
    fs.rmSync(path.join(docsDir, 'BOM.md'), { force: true });
    installBomMock(tempDir, mockClient, {
      draftContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter.']),
      criticResults: [{ passed: true, score: 9.0 }]
    });

    const passedOnRevision0 = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      sessionMessages: []
    });

    expect(passedOnRevision0.autoRevisionsRun).toBe(0);
    expect(passedOnRevision0.criticResult?.passed).toBe(true);
    expect(passedOnRevision0.criticFailed).toBe(false);
  });

  it('manual turn without forceSpecialistId still calls the classifier once', async () => {
    approveRequirements(stateMgr, tempDir);
    let classifierCalls = 0;
    installBomMock(tempDir, mockClient, {
      draftContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter.']),
      criticResults: [{ passed: true, score: 9.0 }],
      onClassifier: () => { classifierCalls++; }
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    expect(classifierCalls).toBe(1);
    expect(result.specialistId).toBe('bom');
  });

  it('onQuestions fires with an empty array for a turn with no open questions', async () => {
    approveRequirements(stateMgr, tempDir);
    installBomMock(tempDir, mockClient, {
      draftContent: '# Bill of Materials (BOM)\n\n## 1. Master Ledger\n\nAll questions resolved.\n',
      criticResults: [{ passed: true, score: 9.0 }]
    });
    const hook = vi.fn();

    await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      onQuestions: hook,
      sessionMessages: []
    });

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0]).toEqual([]);
  });

  it('fires natural-language onStatusUpdate strings (discovery, draft, critic baseline, polishing)', async () => {
    approveRequirements(stateMgr, tempDir);
    installBomMock(tempDir, mockClient, {
      draftContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter.']),
      revisionContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter.']),
      criticResults: [
        { passed: false, score: 4.0 },
        { passed: true, score: 8.7 }
      ]
    });
    const statusUpdates: string[] = [];

    await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      onStatusUpdate: (msg: string) => statusUpdates.push(msg),
      sessionMessages: []
    });

    // §4.1 natural-English replacements fired on this multi-revision turn.
    expect(statusUpdates).toContain('Skimming the project folder for related documents and decisions…');
    expect(statusUpdates).toContain('Asking Bill of Materials (BOM) to prepare the first draft…');
    expect(statusUpdates).toContain('Comparing the draft against the approved project baseline…');
    expect(statusUpdates).toContain('Baseline review suggests refinements (score: 4/10). Polishing — pass 1 of 2…');

    // Old engine-speak is gone
    expect(statusUpdates.join('|')).not.toContain('Classifying request');
    expect(statusUpdates.join('|')).not.toContain('Executing specialist');
    expect(statusUpdates.join('|')).not.toContain('harsh critic');
    expect(statusUpdates.join('|')).not.toContain('Running mandatory');
  });

  // ── Specialist turn budget: maxTurns 24 + forced final write ───────────

  it('specialist drafting loop gets 24 tool turns before the forced final write (maxTurns: 24 threading)', async () => {
    approveRequirements(stateMgr, tempDir);
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const draftCalls: any[] = [];
    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (o: any) => {
      const content = typeof o.messages[0].content === 'string' ? o.messages[0].content : '';
      if (content.includes('Harsh Critic')) {
        return {
          content: JSON.stringify({ passed: true, score: 9.0, summary: 'ok', strengths: [], weaknesses: [], actionableGuidance: '' }),
          raw: {}
        };
      }
      if (content.includes('Bill of Materials (BOM) Specialist')) {
        draftCalls.push(o);
        const lastMsg = o.messages[o.messages.length - 1];
        const lastText = typeof lastMsg.content === 'string' ? lastMsg.content : '';
        if (lastText.includes('Stop using tools')) {
          // Forced final write: the model delivers the document as plain text.
          return { content: '# Bill of Materials (BOM)\n\nRescued deliverable.\n', raw: {} };
        }
        // Turns 1..24: keep tool-calling (unknown tool → fast error tool result).
        return {
          content: '',
          toolCalls: [{ id: 't' + draftCalls.length, type: 'function', function: { name: 'no_such_tool', arguments: '{}' } }],
          raw: {}
        };
      }
      return { content: '', raw: {} };
    });

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      sessionMessages: []
    });

    // 24 tool-calling turns + 1 forced final write = 25 drafting calls.
    // With the old 8-turn default this would have been 9.
    expect(draftCalls).toHaveLength(25);
    expect(draftCalls[24].tools).toBeUndefined();
    expect(result.requiresReview).toBe(true);
    expect(result.criticResult?.passed).toBe(true);
  });

  // ── Logging: errorResult path and critic verdict path ──────────────────

  it('logger.warn fires on the errorResult path with classification, turn and tool-call counts', async () => {
    approveRequirements(stateMgr, tempDir);
    // Drafting call returns commentary, never calls tools, never writes —
    // classification lands on 'no-tool-calls-no-document' → errorResult.
    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (o: any) => {
      const content = typeof o.messages[0].content === 'string' ? o.messages[0].content : '';
      if (content.includes('Harsh Critic')) {
        throw new Error('critic must never run on an error turn');
      }
      return { content: 'Let me think about which parts to list.', raw: {} };
    });
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as any;

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      logger,
      sessionMessages: []
    });

    expect(result.error).toBe(true);
    const warnMsgs = logger.warn.mock.calls.map((c: any[]) => String(c[0]));
    expect(warnMsgs.some((m: string) => m.includes('Turn error for bom'))).toBe(true);
    expect(warnMsgs.some((m: string) => m.includes('classification=none/no-tool-calls-no-document'))).toBe(true);
    expect(warnMsgs.some((m: string) => m.includes('turnsUsed=1'))).toBe(true);
    expect(warnMsgs.some((m: string) => m.includes('toolCallCount=0'))).toBe(true);
  });

  it('logger.info fires on the critic verdict path with docId and verdict', async () => {
    approveRequirements(stateMgr, tempDir);
    installBomMock(tempDir, mockClient, {
      draftContent: bomDocWithOpenQuestions(['Confirm motor shaft pilot diameter.']),
      criticResults: [{ passed: true, score: 9.1 }]
    });
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as any;

    await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      logger,
      sessionMessages: []
    });

    const infoMsgs = logger.info.mock.calls.map((c: any[]) => String(c[0]));
    expect(infoMsgs.some((m: string) => m.includes('Critic verdict for bom') && m.includes('pass'))).toBe(true);
  });
});
