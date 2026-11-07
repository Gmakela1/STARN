import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CoreRunner } from '../src/core/runner.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { CriticEvaluator } from '../src/core/critic.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import {
  buildUpstreamQuestionContext,
  UPSTREAM_OPEN_QUESTIONS_HEADING
} from '../src/core/open-questions-parser.js';
import { QUESTION_CAP_PER_DOC } from '../src/specialists/open-questions.js';

/**
 * T3 upstream-question injection: buildUpstreamQuestionContext extraction
 * contracts (open questions, current-doc exclusion, answered pending blocks,
 * char cap) plus runner prompt-assembly injection (block present when upstream
 * questions exist, absent when none, literal framing lines intact).
 * Mock pattern mirrors runner-autopilot-hooks.test.ts.
 */

function docWithOpenQuestions(title: string, questions: string[], extraSections = ''): string {
  const questionsMd = questions.map((q, i) => `**Q${i + 1}. ${q}.** Why it matters: context.\n`).join('\n');
  return `# ${title}\n\n## 1. Overview\n\nBaseline content.\n\n## Open Questions\n\n${questionsMd}\n${extraSections}`;
}

describe('buildUpstreamQuestionContext', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-upstream-ctx-' + Date.now() + '-' + Math.random().toString(36).substring(2));
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts open questions from other docs with doc-relative heading and slug titles', () => {
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'REQUIREMENTS.md'),
      docWithOpenQuestions('Requirements', ['Confirm motor shaft pilot diameter', 'Confirm max operating temperature']),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'CONOPS.md'),
      docWithOpenQuestions('CONOPS', ['Confirm mission profile duration']),
      'utf-8'
    );

    const block = buildUpstreamQuestionContext(tempDir, path.join(tempDir, 'docs', 'BOM.md'));

    expect(block).toContain(UPSTREAM_OPEN_QUESTIONS_HEADING);
    expect(block).toContain('These questions are ALREADY TRACKED in upstream documents. Do NOT restate or re-ask them');
    expect(block).toContain('If your deliverable depends on them, reference them as dependencies (e.g. depends on Requirements Q3).');
    expect(block).toContain('STILL OPEN (TRACKED — DO NOT RE-ASK):');
    expect(block).toContain('### docs/REQUIREMENTS.md');
    expect(block).toContain('Q1: confirm motor shaft pilot diameter');
    expect(block).toContain('Q2: confirm max operating temperature');
    expect(block).toContain('### docs/CONOPS.md');
    // "Why it matters" bodies are dropped entirely.
    expect(block).not.toContain('Why it matters');
  });

  it('excludes the current deliverable document and keeps topic tags', () => {
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'BOM.md'),
      docWithOpenQuestions('BOM', ['Own question never surfaces']),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'REQUIREMENTS.md'),
      docWithOpenQuestions('Requirements', ['[ELECTRICAL] Confirm connector pin diameter']),
      'utf-8'
    );

    const block = buildUpstreamQuestionContext(tempDir, path.join(tempDir, 'docs', 'BOM.md'));

    expect(block).not.toContain('docs/BOM.md');
    expect(block).not.toContain('Own question never surfaces');
    expect(block).toContain('Q1 [electrical]: confirm connector pin diameter');
  });

  it('carries the SHORT header-contract title, not the untrimmed raw header', () => {
    // The "?"-tail is dropped by the header contract: the injected list must
    // stay a compact re-ask guard, so it slugs the short title.
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'REQUIREMENTS.md'),
      docWithOpenQuestions('Requirements', [
        '[ELECTRICAL] Main bus voltage? Because the load profile and the thermal derating both drive this choice'
      ]),
      'utf-8'
    );

    const block = buildUpstreamQuestionContext(tempDir, path.join(tempDir, 'docs', 'BOM.md'));

    expect(block).toContain('Q1 [electrical]: main bus voltage');
    expect(block).not.toContain('because the load profile');
  });

  it('returns empty string when no upstream doc has open questions or docs dir is missing', () => {
    fs.writeFileSync(path.join(tempDir, 'docs', 'REQUIREMENTS.md'), '# Requirements\n\nApproved baseline.\n', 'utf-8');
    expect(buildUpstreamQuestionContext(tempDir, path.join(tempDir, 'docs', 'BOM.md'))).toBe('');
    expect(buildUpstreamQuestionContext(os.tmpdir(), path.join(os.tmpdir(), 'docs', 'BOM.md'))).toBe('');
  });

  it('surfaces pending user answers as PREVIOUSLY ANSWERED context (answered case)', () => {
    const answered = `## User Answers (Pending Incorporation)\n\n**Q1. Confirm motor shaft pilot diameter.**\nAnswer: 25 mm per vendor datasheet.\n`;
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'REQUIREMENTS.md'),
      docWithOpenQuestions('Requirements', ['Confirm motor shaft pilot diameter'], answered),
      'utf-8'
    );

    const block = buildUpstreamQuestionContext(tempDir, path.join(tempDir, 'docs', 'BOM.md'));

    expect(block).toContain('ALREADY ANSWERED (TREAT AS SETTLED — DO NOT RE-OPEN)');
    expect(block).toContain('PREVIOUSLY ANSWERED context from upstream docs:');
    expect(block).toContain('Answer: 25 mm per vendor datasheet.');
  });

  it('enforces the 6000-char hard cap and QUESTION_CAP_PER_DOC items per doc', () => {
    const manyQuestions = Array.from({ length: 20 }, (_, i) => `Long question number ${i} about some detailed aspect`);
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'REQUIREMENTS.md'),
      docWithOpenQuestions('Requirements', manyQuestions),
      'utf-8'
    );

    const block = buildUpstreamQuestionContext(tempDir, path.join(tempDir, 'docs', 'BOM.md'));

    expect(block).not.toBe('');
    expect(block.length).toBeLessThanOrEqual(6000);
    const qCount = (block.match(/^- Q\d+:/gm) ?? []).length;
    expect(qCount).toBe(QUESTION_CAP_PER_DOC);
  });
});

describe('runner upstream-question injection', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;
  let mockClient: OpenRouterClient;
  let toolRegistry: ToolRegistry;
  let specialistRegistry: SpecialistRegistry;
  let systemPrompts: string[];

  function installBomPromptCapture(dir: string, client: OpenRouterClient): void {
    const docsDir = path.join(dir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    vi.spyOn(client, 'chatCompletion').mockImplementation(async (o: any) => {
      const content = typeof o.messages[0]?.content === 'string' ? o.messages[0].content : '';
      if (content.includes('Request Classifier for STARN')) {
        return { content: JSON.stringify({ specialistId: 'bom', reason: 'classify' }), raw: {} };
      }
      if (content.includes('Bill of Materials (BOM) Specialist') || content.includes('EXISTING BASELINE')) {
        systemPrompts.push(content);
        const bomDoc = docWithOpenQuestions('Bill of Materials (BOM)', []);
        fs.writeFileSync(path.join(docsDir, 'BOM.md'), bomDoc, 'utf-8');
        return { content: 'I drafted the BOM.', raw: {} };
      }
      return { content: '', raw: {} };
    });
  }

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-upstream-inject-' + Date.now() + '-' + Math.random().toString(36).substring(2));
    fs.mkdirSync(tempDir, { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('p1', 'Tractor Test');
    stateMgr.completeIntake();
    mockClient = new OpenRouterClient({ apiKey: 'mock' });
    toolRegistry = new ToolRegistry();
    specialistRegistry = new SpecialistRegistry();
    systemPrompts = [];
    vi.spyOn(CriticEvaluator.prototype, 'evaluate').mockResolvedValue({
      passed: true,
      score: 9.0,
      summary: 'ok',
      strengths: [],
      weaknesses: [],
      actionableGuidance: ''
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function runBomTurn(): Promise<void> {
    await CoreRunner.executeTurn({
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
  }

  it('injects the upstream block into the specialist system prompt when upstream questions exist', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'REQUIREMENTS.md'),
      docWithOpenQuestions('Requirements', ['Confirm motor shaft pilot diameter']),
      'utf-8'
    );
    stateMgr.recordArtifact({
      id: 'REQUIREMENTS',
      title: 'Engineering Requirements',
      path: 'docs/REQUIREMENTS.md',
      status: 'approved',
      criticScore: 8.8
    });
    installBomPromptCapture(tempDir, mockClient);

    await runBomTurn();

    const prompt = systemPrompts[0] ?? '';
    expect(prompt).toContain(UPSTREAM_OPEN_QUESTIONS_HEADING);
    expect(prompt).toContain('These questions are ALREADY TRACKED in upstream documents. Do NOT restate or re-ask them');
    expect(prompt).toContain('STILL OPEN (TRACKED — DO NOT RE-ASK):');
    expect(prompt).toContain('Q1: confirm motor shaft pilot diameter');
  });

  it('omits the upstream block when no upstream questions exist', async () => {
    fs.writeFileSync(path.join(tempDir, 'docs', 'REQUIREMENTS.md'), '# Requirements\n\nApproved baseline.\n', 'utf-8');
    stateMgr.recordArtifact({
      id: 'REQUIREMENTS',
      title: 'Engineering Requirements',
      path: 'docs/REQUIREMENTS.md',
      status: 'approved',
      criticScore: 8.8
    });
    installBomPromptCapture(tempDir, mockClient);

    await runBomTurn();

    expect(systemPrompts[0] ?? '').not.toContain(UPSTREAM_OPEN_QUESTIONS_HEADING);
  });
});
