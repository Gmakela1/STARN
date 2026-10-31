import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES } from '../src/workspace/state.js';
import { addPortalItem, answerPortalItem, dismissPortalItem } from '../src/core/question-portal.js';
import { buildUserAnswersBlock, applyAnswer, AnswerApplierDeps } from '../src/core/answer-applier.js';
import { PortalItem } from '../src/workspace/types.js';
import { TurnResult } from '../src/core/runner.js';

function makeTurnResult(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    specialistId: 'conops',
    specialistName: 'Conops',
    output: '# CONOPS\n\nUpdated.',
    criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' },
    autoRevisionsRun: 0,
    requiresReview: true,
    sessionMessages: [],
    ...overrides
  };
}

describe('buildUserAnswersBlock', () => {
  it('returns exact CLI format with whitespace and newlines', () => {
    const item: PortalItem = {
      id: 'p_test1',
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot',
      status: 'open',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    };
    const result = buildUserAnswersBlock(item, '12V nominal');
    const expected = `\n\nUSER ANSWERS TO OPEN QUESTIONS (incorporate per your instructions):\nQ1. What is the max voltage?\nAnswer: 12V nominal\n`;
    expect(result).toBe(expected);
  });

  it('extracts Q number from title when title starts with Q\d+.', () => {
    const item: PortalItem = {
      id: 'p_test2',
      type: 'question',
      severity: 'normal',
      docPath: 'docs/ARCHITECTURE.md',
      title: 'Q3. What bus voltage?',
      source: 'autopilot',
      status: 'open',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    };
    const result = buildUserAnswersBlock(item, '48V');
    const expected = `\n\nUSER ANSWERS TO OPEN QUESTIONS (incorporate per your instructions):\nQ3. What bus voltage?\nAnswer: 48V\n`;
    expect(result).toBe(expected);
  });

  it('uses 1 as default number when title has no Q prefix', () => {
    const item: PortalItem = {
      id: 'p_test3',
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Any constraints?',
      source: 'autopilot',
      status: 'open',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    };
    const result = buildUserAnswersBlock(item, 'None');
    const expected = `\n\nUSER ANSWERS TO OPEN QUESTIONS (incorporate per your instructions):\nQ1. Any constraints?\nAnswer: None\n`;
    expect(result).toBe(expected);
  });

  it('with context: lists prior history + other answered items and forbids re-asking (answer memory)', () => {
    const item: PortalItem = {
      id: 'p_test4',
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What fuse rating?',
      source: 'autopilot',
      status: 'open',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      meta: { answerHistory: [{ text: '32A earlier', at: '2025-01-01T00:00:00.000Z' }] }
    };
    const result = buildUserAnswersBlock(item, '40A final', {
      priorHistory: [{ text: '32A earlier' }],
      otherAnswered: [
        { id: 'p_other', title: 'What is the max voltage?', answer: '48V' },
        { id: 'p_other2', title: 'What gauge wire?', answer: '10 AWG' }
      ]
    });
    expect(result).toContain('PREVIOUSLY ANSWERED');
    expect(result).toContain('do NOT re-ask');
    expect(result).toContain('only genuinely NEW unresolved items'.replace('only', 'Only'));
    expect(result).toContain('32A earlier');
    expect(result).toContain('What is the max voltage?');
    expect(result).toContain('48V');
    expect(result).toContain('What gauge wire?');
    expect(result).toContain('10 AWG');
  });
});

describe('applyAnswer', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;
  let executeTurnMock: ReturnType<typeof vi.fn>;
  let runChangeImpactMock: ReturnType<typeof vi.fn>;
  let deps: AnswerApplierDeps;
  let docPath: string;

  function writeDocContent(phaseId: string, content: string): void {
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, `${phaseId.toUpperCase()}.md`), content, 'utf-8');
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-answer-applier-'));
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('p1', 'Answer Applier Test');

    // Write a baseline CONOPS doc on disk
    writeDocContent('conops', '# CONOPS\n\nBaseline content.\n\n## Open Questions\n\nQ1. What max voltage?\n');

    executeTurnMock = vi.fn();
    runChangeImpactMock = vi.fn().mockResolvedValue(['icd', 'requirements']);

    deps = {
      stateManager: stateMgr,
      projectPath: tmpDir,
      executeTurn: executeTurnMock,
      runChangeImpact: runChangeImpactMock
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds correct userPrompt with doc content and answers block', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({
      specialistId: 'conops',
      criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
    }));

    await applyAnswer(deps, item.id, '12V nominal');

    expect(executeTurnMock).toHaveBeenCalledTimes(1);
    const callOpts = executeTurnMock.mock.calls[0][0];
    expect(callOpts.userPrompt).toContain('# CONOPS');
    expect(callOpts.userPrompt).toContain('Baseline content.');
    expect(callOpts.userPrompt).toContain('USER ANSWERS TO OPEN QUESTIONS');
    expect(callOpts.userPrompt).toContain('Q1. What is the max voltage?');
    expect(callOpts.userPrompt).toContain('Answer: 12V nominal');
    expect(callOpts.userPrompt).toContain('Update the document in place');
  });

  it('sets forceSpecialistId to the phase derived from docPath', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({
      specialistId: 'conops',
      criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
    }));

    await applyAnswer(deps, item.id, '12V nominal');

    expect(executeTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ forceSpecialistId: 'conops' })
    );
  });

  it('approveArtifact called on critic pass and affectedDocs returned', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({
      specialistId: 'conops',
      criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
    }));

    const result = await applyAnswer(deps, item.id, '12V nominal');

    expect(runChangeImpactMock).toHaveBeenCalled();
    expect(result.affectedDocs).toEqual(['icd', 'requirements']);
  });

  it('returns counter-questions when onQuestions hook fires', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    const onQuestionsCb = vi.fn((items) => {
      // This simulates what the autopilot driver does when onQuestions fires
    });

    executeTurnMock.mockImplementation(async (opts: {
      userPrompt: string;
      forceSpecialistId: string;
      signal?: AbortSignal;
      onQuestions?: (items: Array<{
        type: 'question';
        severity: 'normal';
        docPath: string;
        title: string;
        detail?: string;
        source: 'autopilot';
      }>) => void;
    }) => {
      if (opts.onQuestions) {
        opts.onQuestions([
          { type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md', title: 'Q1. What gauge wire?', source: 'autopilot' },
          { type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md', title: 'Q2. Fuse rating?', source: 'autopilot' }
        ]);
      }
      return makeTurnResult({
        specialistId: 'conops',
        criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
      });
    });

    const result = await applyAnswer(deps, item.id, '12V nominal');

    expect(result.counterQuestions).toHaveLength(2);
    expect(result.counterQuestions[0].title).toBe('Q1. What gauge wire?');
    expect(result.counterQuestions[1].title).toBe('Q2. Fuse rating?');
    // Counter-questions should be on the same thread as the original
    expect(result.counterQuestions[0].threadId).toBe(item.threadId || item.id);
    expect(result.counterQuestions[1].threadId).toBe(item.threadId || item.id);
    expect(result.counterQuestions[0].source).toBe('autopilot');
  });

  it('marks item answered with answer text', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({
      specialistId: 'conops',
      criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
    }));

    const result = await applyAnswer(deps, item.id, '12V nominal');

    expect(result.updatedItem.status).toBe('answered');
    expect(result.updatedItem.answer).toBe('12V nominal');
  });

  it('follow-up: counter-questions inherit the applied answer history (board #52)', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockImplementation(async (opts: {
      userPrompt: string;
      forceSpecialistId: string;
      signal?: AbortSignal;
      onQuestions?: (items: Array<{
        type: 'question';
        severity: 'normal';
        docPath: string;
        title: string;
        detail?: string;
        source: 'autopilot';
      }>) => void;
    }) => {
      if (opts.onQuestions) {
        opts.onQuestions([
          { type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md', title: 'Q1. What gauge wire?', source: 'autopilot' }
        ]);
      }
      return makeTurnResult({
        specialistId: 'conops',
        criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
      });
    });

    const result = await applyAnswer(deps, item.id, '12V nominal');

    // The follow-up item keeps the full saved answer history.
    expect(result.counterQuestions[0].meta?.answerHistory).toEqual([
      { text: '12V nominal', at: expect.any(String) }
    ]);
    // The answered item itself also records the answer in its history.
    const stored = stateMgr.getState().portalItems!.find(i => i.id === item.id)!;
    expect(stored.meta?.answerHistory).toEqual([
      { text: '12V nominal', at: expect.any(String) }
    ]);
  });

  it('follow-up: inherited history is capped to the last 20 entries (board #52)', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    // Seed 21 prior history entries directly into the store.
    const state = stateMgr.getState();
    const stored = state.portalItems!.find(i => i.id === item.id)!;
    stored.meta = {
      answerHistory: Array.from({ length: 21 }, (_, i) => ({
        text: `old ${i + 1}`,
        at: `2025-01-01T00:00:${String(i).padStart(2, '0')}.000Z`
      }))
    };
    stateMgr.saveState(state);

    executeTurnMock.mockImplementation(async (opts: {
      onQuestions?: (items: Array<{
        type: 'question';
        severity: 'normal';
        docPath: string;
        title: string;
        source: 'autopilot';
      }>) => void;
    }) => {
      if (opts.onQuestions) {
        opts.onQuestions([
          { type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md', title: 'Q1. What gauge wire?', source: 'autopilot' }
        ]);
      }
      return makeTurnResult({
        specialistId: 'conops',
        criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
      });
    });

    const result = await applyAnswer(deps, item.id, 'new answer');

    // 21 prior + 1 appended = 22 → the counter question inherits only the
    // last 20 (the capped history, including the just-applied answer).
    const cqHistory = result.counterQuestions[0].meta!.answerHistory!;
    expect(cqHistory).toHaveLength(20);
    expect(cqHistory[0]).toMatchObject({ text: 'old 3' });
    expect(cqHistory[19]).toMatchObject({ text: 'new answer' });
  });

  it('re-apply to an already-answered item throws (stale rejection)', async () => {
    // First, add and answer an item
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({
      specialistId: 'conops',
      criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
    }));

    // Answer once
    await applyAnswer(deps, item.id, '12V nominal');

    // A queued answer that lands after the item was already applied is stale:
    // the apply-time freshness check rejects it instead of writing twice.
    await expect(applyAnswer(deps, item.id, '12V nominal (revised)'))
      .rejects.toThrow('Portal item no longer open (answered)');
  });

  it('throws on a dismissed (non-open) item', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });
    dismissPortalItem(stateMgr, item.id);

    const state = stateMgr.getState();
    expect(state.portalItems.find(i => i.id === item.id)?.status).toBe('dismissed');

    await expect(applyAnswer(deps, item.id, '48V'))
      .rejects.toThrow('Portal item no longer open (dismissed)');
  });

  it('throws on invalid itemId', async () => {
    await expect(applyAnswer(deps, 'nonexistent-id', 'answer'))
      .rejects.toThrow('not found');
  });

  it('throws on unknown phaseId derived from docPath', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/UNKNOWN_PHASE.md',
      title: 'Unknown phase question',
      source: 'autopilot'
    });

    await expect(applyAnswer(deps, item.id, 'answer'))
      .rejects.toThrow('Unknown phase');
  });

  it('answer memory: userPrompt includes other ANSWERED items for the same doc (capped at 6) and forbids re-asking', async () => {
    // 8 previously answered items on the same doc → only the most recent 6 appear.
    for (let i = 1; i <= 8; i++) {
      const q = addPortalItem(stateMgr, {
        type: 'question',
        severity: 'normal',
        docPath: 'docs/CONOPS.md',
        title: `Q${i}. Old question ${i}?`,
        source: 'autopilot'
      });
      answerPortalItem(stateMgr, q.id, `Answer ${i}`);
    }
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What fuse rating?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({
      specialistId: 'conops',
      criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
    }));

    await applyAnswer(deps, item.id, '40A');

    const userPrompt = executeTurnMock.mock.calls[0][0].userPrompt as string;
    expect(userPrompt).toContain('PREVIOUSLY ANSWERED');
    expect(userPrompt).toContain('do NOT re-ask');
    // most recent 6 answers (3..8) present
    expect(userPrompt).toContain('Old question 3?');
    expect(userPrompt).toContain('Answer 8');
 // oldest two dropped
    expect(userPrompt).not.toContain('Old question 1?');
    expect(userPrompt).not.toContain('Old question 2?');
  });

  it('mid-chain (busy): no full turn runs — answer becomes a plain doc edit, item answered, nothing deferred to counter-questions', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What fuse rating?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({
      specialistId: 'conops',
      criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
    }));

    const busyDeps: AnswerApplierDeps = { ...deps, isBusy: () => true };
    const result = await applyAnswer(busyDeps, item.id, '40A');

    // No draft+critic turn, no approval, no counter-questions.
    expect(executeTurnMock).not.toHaveBeenCalled();
    expect(runChangeImpactMock).not.toHaveBeenCalled();
    expect(result.counterQuestions).toEqual([]);
    expect(result.affectedDocs).toEqual([]);

    // Answer is recorded on the item and inserted into the doc for the next
    // normal turn to incorporate.
    expect(result.updatedItem.status).toBe('answered');
    expect(result.updatedItem.answer).toBe('40A');
    const doc = fs.readFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), 'utf-8');
    expect(doc).toContain('## User Answers (Pending Incorporation)');
    expect(doc).toContain('What fuse rating?');
    expect(doc).toContain('Answer: 40A');
  });

  it('mid-chain (busy) with missing doc still marks the item answered without throwing', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/REQUIREMENTS.md',
      title: 'What fuse rating?',
      source: 'autopilot'
    });

    const busyDeps: AnswerApplierDeps = { ...deps, isBusy: () => true };
    const result = await applyAnswer(busyDeps, item.id, '40A');
    expect(result.updatedItem.status).toBe('answered');
  });

  it('whole-thread history is only inherited by counter-questions on the SAME doc', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockImplementation(async (opts: {
      onQuestions?: (items: Array<{
        type: 'question';
        severity: 'normal';
        docPath: string;
        title: string;
        source: 'autopilot';
      }>) => void;
    }) => {
      if (opts.onQuestions) {
        opts.onQuestions([
          { type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md', title: 'Same-doc follow-up?', source: 'autopilot' },
          { type: 'question', severity: 'normal', docPath: 'docs/ICD.md', title: 'Unrelated doc follow-up?', source: 'autopilot' }
        ]);
      }
      return makeTurnResult({
        specialistId: 'conops',
        criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
      });
    });

    const result = await applyAnswer(deps, item.id, '12V nominal');

    const byTitle = new Map(result.counterQuestions.map(q => [q.title, q]));
    expect(byTitle.get('Same-doc follow-up?')?.meta?.answerHistory).toEqual([
      { text: '12V nominal', at: expect.any(String) }
    ]);
    expect(byTitle.get('Unrelated doc follow-up?')?.meta?.answerHistory).toBeUndefined();
  });
});
