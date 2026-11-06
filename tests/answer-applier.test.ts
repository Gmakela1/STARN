import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../src/workspace/state.js';
import { addPortalItem, answerPortalItem, dismissPortalItem } from '../src/core/question-portal.js';
import { applyAnswer, AnswerApplierDeps } from '../src/core/answer-applier.js';
import { INCORPORATION_CRITIC_FOCUS } from '../src/core/incorporation-prompt.js';
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

describe('applyAnswer', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;
  let executeTurnMock: ReturnType<typeof vi.fn>;
  let emitStatusMock: ReturnType<typeof vi.fn>;
  let emitPhaseMock: ReturnType<typeof vi.fn>;
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
    emitStatusMock = vi.fn();
    emitPhaseMock = vi.fn();

    deps = {
      stateManager: stateMgr,
      projectPath: tmpDir,
      executeTurn: executeTurnMock,
      emitStatus: emitStatusMock,
      emitPhase: emitPhaseMock
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) idle: answer is a plain doc edit — with open questions remaining no turn runs', async () => {
    // Two open questions on the same doc; answering one leaves the other open,
    // so the incorporation trigger must not fire.
    const other = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What gauge wire?',
      source: 'autopilot'
    });
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    const result = await applyAnswer(deps, item.id, '12V nominal');

    // Plain edit only — no specialist/critic turn per answer.
    expect(executeTurnMock).not.toHaveBeenCalled();
    expect(result.affectedDocs).toEqual([]);
    expect(result.updatedItem.status).toBe('answered');
    expect(result.updatedItem.answer).toBe('12V nominal');
    const doc = fs.readFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), 'utf-8');
    expect(doc).toContain('## User Answers (Pending Incorporation)');
    expect(doc).toContain('**What is the max voltage?**');
    expect(doc).toContain('Answer: 12V nominal');
    expect(stateMgr.getState().portalItems!.find(i => i.id === other.id)?.status).toBe('open');
  });

  it('(b) idle + LAST open question answered: exactly one incorporation turn, block stripped, status revised', async () => {
    const s = stateMgr.getState();
    s.autopilot!.docStatus['conops'] = 'passed';
    stateMgr.saveState(s);

    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({ specialistId: 'conops' }));

    const result = await applyAnswer(deps, item.id, '12V nominal');

    expect(executeTurnMock).toHaveBeenCalledTimes(2); // incorporation + immediate ripple scan (no flags)
    const callOpts = executeTurnMock.mock.calls[0][0];
    expect(callOpts.forceSpecialistId).toBe('conops');
    expect(callOpts.criticFocus).toBe(INCORPORATION_CRITIC_FOCUS);
    expect(callOpts.userPrompt).toContain('PENDING INCORPORATION');
    expect(callOpts.userPrompt).toContain('docs/CONOPS.md');
    expect(callOpts.userPrompt).toContain("REMOVE the '## User Answers (Pending Incorporation)' block");

    // Guard strip: the mocked turn does not edit the doc, but the applier
    // strips the pending block on success.
    const doc = fs.readFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), 'utf-8');
    expect(doc).not.toContain('## User Answers (Pending Incorporation)');
    expect(doc).toContain('Baseline content.');

    // docStatus was 'passed' → set to 'revised' + phase event.
    expect(stateMgr.getState().autopilot!.docStatus['conops']).toBe('revised');
    expect(emitPhaseMock).toHaveBeenCalledWith('conops', 'revised', expect.any(String));
    expect(emitStatusMock).toHaveBeenCalledWith(expect.stringContaining('Incorporated answers into'));
    expect(result.affectedDocs).toEqual([]);
  });

  it('(b2) revised is NOT set for an idle/parked doc — but the block is still stripped', async () => {
    const s = stateMgr.getState();
    s.autopilot!.docStatus['conops'] = 'idle';
    stateMgr.saveState(s);

    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({ specialistId: 'conops' }));
    await applyAnswer(deps, item.id, '12V nominal');

    expect(executeTurnMock).toHaveBeenCalledTimes(2); // incorporation + immediate ripple scan (no flags)
    expect(stateMgr.getState().autopilot!.docStatus['conops']).toBe('idle');
    expect(emitPhaseMock).not.toHaveBeenCalled();
    const doc = fs.readFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), 'utf-8');
    expect(doc).not.toContain('## User Answers (Pending Incorporation)');
  });

  it('(c) incorporation turn fails: block stays (retryable), failure status event, no revised', async () => {
    const s = stateMgr.getState();
    s.autopilot!.docStatus['conops'] = 'passed';
    stateMgr.saveState(s);

    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({
      specialistId: 'conops',
      criticFailed: true
    }));

    const result = await applyAnswer(deps, item.id, '12V nominal');

    expect(executeTurnMock).toHaveBeenCalledTimes(1);
    const doc = fs.readFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), 'utf-8');
    expect(doc).toContain('## User Answers (Pending Incorporation)');
    expect(doc).toContain('Answer: 12V nominal');
    expect(stateMgr.getState().autopilot!.docStatus['conops']).toBe('passed');
    expect(emitPhaseMock).not.toHaveBeenCalled();
    expect(emitStatusMock).toHaveBeenCalledWith(expect.stringContaining('failed'));
    expect(result.updatedItem.status).toBe('answered');
  });

  it('(d) more open questions remain for the doc: no incorporation turn', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });
    addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What fuse rating?',
      source: 'autopilot'
    });

    await applyAnswer(deps, item.id, '12V nominal');

    expect(executeTurnMock).not.toHaveBeenCalled();
    expect(emitStatusMock).not.toHaveBeenCalled();
  });

  it('(g) only hidden items remain (superseded twins + upstreamOf children): incorporation still fires', async () => {
    const s = stateMgr.getState();
    s.autopilot!.docStatus['conops'] = 'passed';
    stateMgr.saveState(s);

    const canonical = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });
    // Cross-doc twin → tagged meta.upstreamOf (hidden from the default listing).
    const hiddenChild = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/RTM.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });
    expect(hiddenChild.meta?.upstreamOf).toBe(canonical.id);
    // Legacy same-doc twin with the same slug (pushed directly, pre-slug data).
    const state = stateMgr.getState();
    state.portalItems!.push({
      id: 'legacy_twin',
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Q2. What is the max voltage?',
      status: 'open',
      source: 'autopilot',
      createdAt: '2024-12-01T00:00:00.000Z',
      updatedAt: '2024-12-01T00:00:00.000Z'
    });
    stateMgr.saveState(state);

    executeTurnMock.mockResolvedValue(makeTurnResult({ specialistId: 'conops' }));
    await applyAnswer(deps, canonical.id, '48V nominal');

    // Hidden items must NOT keep the incorporation trigger from firing.
    expect(executeTurnMock).toHaveBeenCalledTimes(2); // incorporation + immediate ripple scan
    const after = stateMgr.getState().portalItems!;
    expect(after.find(i => i.id === hiddenChild.id)?.meta?.superseded).toBe(true);
    expect(after.find(i => i.id === 'legacy_twin')?.meta?.superseded).toBe(true);
  });

  it('(e) busy: no incorporation turn — the chain incorporates pending answers itself', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockResolvedValue(makeTurnResult({ specialistId: 'conops' }));

    const busyDeps: AnswerApplierDeps = { ...deps, isBusy: () => true };
    await applyAnswer(busyDeps, item.id, '12V nominal');

    expect(executeTurnMock).not.toHaveBeenCalled();
    // Block stays: the running chain's own incorporation path handles it.
    const doc = fs.readFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), 'utf-8');
    expect(doc).toContain('## User Answers (Pending Incorporation)');
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

  it('an empty-title counter-question does not abort applyAnswer (F3 guard)', async () => {
    const item = addPortalItem(stateMgr, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the max voltage?',
      source: 'autopilot'
    });

    executeTurnMock.mockImplementation(async (opts: { onQuestions?: (items: unknown[]) => void }) => {
      opts.onQuestions?.([
        { type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md', title: '   ', source: 'autopilot' },
        { type: 'question', severity: 'normal', docPath: 'docs/CONOPS.md', title: 'Q1. What gauge wire?', source: 'autopilot' }
      ]);
      return makeTurnResult({
        specialistId: 'conops',
        criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' }
      });
    });

    const result = await applyAnswer(deps, item.id, '12V nominal');

    expect(result.counterQuestions).toHaveLength(1);
    expect(result.counterQuestions[0].title).toBe('Q1. What gauge wire?');
    const stored = stateMgr.getState().portalItems!.find(i => i.id === item.id)!;
    expect(stored.status).toBe('answered');
    expect(emitStatusMock).toHaveBeenCalledWith(expect.stringContaining('Skipped 1 malformed'));
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

  it('(f) after incorporation success, the ripple scan runs IMMEDIATELY: change-impact scan + scoped fix for the flagged doc', async () => {
    // Ripple fixes only move completed docs ('auto-approved'/'passed') to
    // 'revised' — same guard as the applier's own docStatus write.
    const s0 = stateMgr.getState();
    s0.autopilot!.docStatus['requirements'] = 'auto-approved';
    stateMgr.saveState(s0);

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
      criticDisabled?: boolean;
    }) => {
      if (opts.forceSpecialistId === 'change-impact') {
        expect(opts.userPrompt).toContain('UPSTREAM CHANGE DIFF in docs/CONOPS.md');
        expect(opts.userPrompt).toContain('pending user answers incorporated');
        expect(opts.criticDisabled).toBeUndefined();
        return makeTurnResult({
          specialistId: 'change-impact',
          output: 'docs/REQUIREMENTS.md: Bus Voltage section — 48V is now discrepant; scoped update: change to 12V.'
        });
      }
      if (opts.forceSpecialistId === 'requirements') {
        expect(opts.criticDisabled).toBe(true);
        expect(opts.userPrompt).toContain('CHANGE-IMPACT RIPPLE: docs/CONOPS.md was updated');
        expect(opts.userPrompt).toContain('Bus Voltage section');
        return makeTurnResult({ specialistId: 'requirements', requiresReview: false });
      }
      // Incorporation turn itself.
      expect(opts.forceSpecialistId).toBe('conops');
      return makeTurnResult({ specialistId: 'conops' });
    });

    await applyAnswer(deps, item.id, '12V nominal');

    // Incorporation + change-impact scan + scoped fix = exactly 3 turns.
    expect(executeTurnMock).toHaveBeenCalledTimes(3);
    // The fix turn marked the flagged doc 'revised' via the phase event.
    expect(emitPhaseMock).toHaveBeenCalledWith('requirements', 'revised', expect.any(String));
    expect(stateMgr.getState().autopilot!.docStatus['requirements']).toBe('revised');
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
