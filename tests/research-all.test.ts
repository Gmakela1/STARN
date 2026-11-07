import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  runResearchBackfill,
  RESEARCH_GATE_ITEM_TIMEOUT_MS,
  ResearchGateDeps,
  ResearchBackfillDeps,
  buildQuestionSections,
  listBackfillEligibleItems
} from '../src/core/research-gate.js';
import { applyAnswer, AnswerApplierDeps } from '../src/core/answer-applier.js';
import { addPortalItem } from '../src/core/question-portal.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { PortalItem } from '../src/workspace/types.js';
import { ChatCompletionResult } from '../src/openrouter/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { createHttpServer } from '../src/server/server.js';
import { ServerSessionManager } from '../src/server/session.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { DEFAULT_TRANSCRIBER_MODEL } from '../src/config.js';

const RESEARCH_JSON = JSON.stringify({
  answer: 'The main contactor is rated for 48V DC. The coil spec matches the harness baseline.',
  sources: [{ title: 'Vendor datasheet' }, { title: 'CONOPS baseline' }],
  reasoning: 'Stated verbatim in the datasheet.'
});

// Decision-question variant: the answer ends with the labelled decision block
// the gate prompt requires (Alternatives: A/B + Recommended: <letter>).
const DECISION_RESEARCH_JSON = JSON.stringify({
  answer:
    'The main contactor is rated for 48V DC.\nAlternatives:\nA) Keep the 48V contactor — no harness rework.\nB) Move to 72V — lighter harness, no supplier yet.\nRecommended: B',
  sources: [{ title: 'Vendor datasheet' }],
  reasoning: 'Stated verbatim in the datasheet.'
});

// Auto-tier variant: a fetchable top source keeps the confidence uncapped.
const AUTO_RESEARCH_JSON = JSON.stringify({
  answer: 'The main contactor is rated for 48V DC. The coil spec matches the harness baseline.',
  sources: [{ title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' }],
  reasoning: 'Stated verbatim in the datasheet.'
});

function chat(content: string): ChatCompletionResult {
  return { content, raw: {} } as ChatCompletionResult;
}

// Default research-turn reply — file-level: the endpoint describe resets it.
beforeEach(() => {
  agentLoopMock.mockImplementation(async () => ({ finalResponse: RESEARCH_JSON }));
});

/**
 * A COMPLETE memo: sections WITH structured options. This is the shape the
 * backfill does NOT re-research. An old-format memo (bluf/findings/suggestion
 * only, no options) is a re-research candidate.
 */
function completeMemo(bluf: string) {
  return {
    bluf,
    alternatives: 'A) Keep 48V.; B) Move to 72V.',
    options: [
      { id: 'A', text: 'Keep 48V.', recommended: true },
      { id: 'B', text: 'Move to 72V.' }
    ],
    recommendation: 'A'
  };
}

function makeItem(stateMgr: ProjectStateManager, overrides: Partial<PortalItem> = {}): PortalItem {
  return addPortalItem(stateMgr, {
    type: 'question',
    severity: 'normal',
    docPath: 'docs/CONOPS.md',
    title: 'What is the main contactor voltage rating?',
    source: 'autopilot',
    ...overrides
  } as any);
}

// ── Core orchestrator ────────────────────────────────────────────────────────

describe('runResearchBackfill (core)', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;
  let emitStatus: ReturnType<typeof vi.fn>;
  let researchClient: { chatCompletion: ReturnType<typeof vi.fn> };
  let criticClient: { chatCompletion: ReturnType<typeof vi.fn> };
  let gateDeps: ResearchBackfillDeps;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-research-backfill-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\n\nBaseline.\n', 'utf-8');
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('p1', 'Research Backfill Test');
    emitStatus = vi.fn();
    researchClient = { chatCompletion: vi.fn(async () => chat(RESEARCH_JSON)) };
    criticClient = {
      chatCompletion: vi.fn(async () =>
        chat(JSON.stringify({
          confidence: 0.5,
          corroborated: false,
          verdict: 'propose',
          rationale: 'Vendor spec states the rating verbatim.'
        }))
      )
    };
    const registry = new ToolRegistry();
    const applierDeps: AnswerApplierDeps = {
      stateManager: stateMgr,
      projectPath: tmpDir,
      executeTurn: vi.fn(),
      isBusy: () => true
    };
    const baseDeps: ResearchGateDeps = {
      client: researchClient as any,
      model: 'research-model',
      criticClient: criticClient as any,
      criticModel: 'critic-model',
      projectPath: tmpDir,
      stateManager: stateMgr,
      toolRegistry: registry,
      emitStatus,
      applyAnswer: async (itemId, answer) => {
        const r = await applyAnswer(applierDeps, itemId, answer, { provenance: 'research-gate' });
        return { updatedItem: r.updatedItem, appendedText: r.appendedText };
      },
      verifySource: async () => ({ ok: false })
    };
    gateDeps = baseDeps;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('iterates only eligible legacy items, sequentially, and writes meta.sections', async () => {
    const plain = makeItem(stateMgr);
    const withSections = makeItem(stateMgr, {
      title: 'Already enriched question?',
      meta: { sections: completeMemo('Sentinel.') }
    });
    const withProposal = makeItem(stateMgr, {
      title: 'Proposed question?',
      meta: { proposedAnswer: { answer: 'x', sources: [], confidence: 0.5, rationale: '' } }
    });
    const researching = makeItem(stateMgr, { title: 'Researching question?', meta: { researching: true } });
    const nonQuestion = addPortalItem(stateMgr, {
      type: 'parked' as any,
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'Parked item',
      source: 'autopilot'
    });

    // Sequential: track max concurrent research-loop turns (the file-level
    // agent-loop mock drives runQuestionResearch).
    let active = 0;
    let maxActive = 0;
    agentLoopMock.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 10));
      active--;
      return { finalResponse: RESEARCH_JSON };
    });

    const result = await runResearchBackfill(gateDeps);
    expect(result).toEqual({ processed: 1, enriched: 1, normalized: 0, topicTagged: 1 });
    expect(maxActive).toBe(1); // for..of await — never parallel

    const stored = (id: string) => (stateMgr.getState().portalItems || []).find(i => i.id === id)!;
    const enrichedItem = stored(plain.id);
    expect(enrichedItem.meta?.researching).toBe(false);
    expect(enrichedItem.meta?.proposedAnswer).toBeTruthy();
    expect(enrichedItem.meta?.sections?.bluf).toBe('The main contactor is rated for 48V DC.');
    expect(enrichedItem.meta?.sections?.suggestion).toContain('coil spec matches');
    expect(enrichedItem.meta?.sections?.findings).toContain('Vendor spec states the rating');
    expect(enrichedItem.meta?.sections?.findings).toContain('Sources: Vendor datasheet');

    // Ineligible items untouched.
    expect(stored(withSections.id).meta?.sections).toEqual(completeMemo('Sentinel.'));
    expect(stored(withProposal.id).meta?.sections).toBeUndefined();
    expect(stored(researching.id).meta?.sections).toBeUndefined();
    expect(stored(nonQuestion.id).meta?.sections).toBeUndefined();
    // Kickoff + per-item status events from the gate machinery.
    const statuses = emitStatus.mock.calls.map(c => c[0] as string);
    expect(statuses.some(s => s.startsWith('Researching answer for:'))).toBe(true);
  });

  it('skips items in the in-flight dedupe set', async () => {
    const plain = makeItem(stateMgr);
    const result = await runResearchBackfill({ ...gateDeps, inFlight: new Set([plain.id]) });
    expect(result).toEqual({ processed: 0, enriched: 0, normalized: 0, topicTagged: 1 });
    expect(researchClient.chatCompletion).not.toHaveBeenCalled();
    expect(agentLoopMock).not.toHaveBeenCalled();
  });

  it('auto tier: answer text stays stored and sections are written from research', async () => {
    (criticClient.chatCompletion as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      chat(JSON.stringify({
        confidence: 0.97,
        corroborated: true,
        verdict: 'auto',
        rationale: 'Vendor datasheet, stated verbatim.'
      }))
    );
    (gateDeps as ResearchGateDeps).verifySource = async () => ({ ok: true, excerpt: 'Contactor rated 48V DC.' });
    // A fetchable top cited URL keeps the critic confidence uncapped (auto tier).
    agentLoopMock.mockImplementation(async () => ({ finalResponse: AUTO_RESEARCH_JSON }));
    // The file-level answer-applier mock is for the endpoint tests; the core
    // auto-tier path stubs applyAnswer with the essential state effects
    // (status + answer text) — the autoApplied stamping happens in the gate.
    (gateDeps as ResearchGateDeps).applyAnswer = async (itemId, answer) => {
      const state = stateMgr.getState();
      const stored = (state.portalItems || []).find(i => i.id === itemId)!;
      stored.answer = answer;
      stored.status = 'answered';
      stateMgr.saveState(state);
      return { updatedItem: stored, appendedText: '\n\nAppended answer' };
    };
    const item = makeItem(stateMgr);
    const result = await runResearchBackfill(gateDeps);
    expect(result).toEqual({ processed: 1, enriched: 1, normalized: 0, topicTagged: 1 });
    const stored = (stateMgr.getState().portalItems || []).find(i => i.id === item.id)!;
    expect(stored.status).toBe('answered');
    expect(stored.answer).toContain('48V DC');
    expect(stored.meta?.autoApplied?.answer).toContain('48V DC');
    expect(stored.meta?.sections?.bluf).toBe('The main contactor is rated for 48V DC.');
    expect(stored.meta?.sections?.findings).toContain('Vendor datasheet');
  });

  it('research exhausted: no sections fabricated, researching cleared', async () => {
    agentLoopMock.mockImplementation(async () => ({ finalResponse: 'no json at all' }));
    const item = makeItem(stateMgr);
    const result = await runResearchBackfill(gateDeps);
    expect(result).toEqual({ processed: 1, enriched: 0, normalized: 0, topicTagged: 1 });
    const stored = (stateMgr.getState().portalItems || []).find(i => i.id === item.id)!;
    expect(stored.status).toBe('open');
    expect(stored.meta?.sections).toBeUndefined();
    expect(stored.meta?.researching).toBe(false);
  });

  it('a hung gate run is abandoned at the cap and the loop CONTINUES to the next item', async () => {
    vi.useFakeTimers();
    try {
      const hang = makeItem(stateMgr, { title: 'Hangs forever question?' });
      const ok = makeItem(stateMgr, { title: 'Completes normally question?' });
      // First item's research loop never settles; the second completes.
      agentLoopMock.mockImplementationOnce(() => new Promise<never>(() => {}));
      agentLoopMock.mockImplementationOnce(async () => ({ finalResponse: RESEARCH_JSON }));
      const pending = runResearchBackfill(gateDeps);
      const assertion = expect(pending).resolves.toEqual({ processed: 2, enriched: 1, normalized: 0, topicTagged: 0 });
      await vi.advanceTimersByTimeAsync(RESEARCH_GATE_ITEM_TIMEOUT_MS);
      await assertion;

      const stored = (id: string) => (stateMgr.getState().portalItems || []).find(i => i.id === id)!;
      const hungItem = stored(hang.id);
      expect(hungItem.meta?.researching).toBe(false); // spinner never persists
      expect(hungItem.meta?.sections).toBeUndefined(); // left as open question
      expect(stored(ok.id).meta?.sections?.bluf).toBe('The main contactor is rated for 48V DC.');
      const statuses = emitStatus.mock.calls.map(c => c[0] as string);
      expect(statuses.some(s => s.startsWith('Research timed out for: Hangs forever question?'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enrichment rewrites a wall-of-text title to the short form, preserving the original', async () => {
    const longTitle = 'Q1. ' + 'B'.repeat(100);
    const item = makeItem(stateMgr, { title: longTitle });
    const result = await runResearchBackfill(gateDeps);
    expect(result).toEqual({ processed: 1, enriched: 1, normalized: 0, topicTagged: 0 });
    const stored = (stateMgr.getState().portalItems || []).find(i => i.id === item.id)!;
    expect(stored.title).toBe('B'.repeat(57) + '…');
    expect(stored.meta?.originalTitle).toBe(longTitle);
    expect(stored.detail).toBe(longTitle); // full question text preserved
    expect(stored.meta?.sections?.bluf).toBe('The main contactor is rated for 48V DC.');
  });

  it('normalize pass: legacy enriched items (sections, long title, no originalTitle) get short titles WITHOUT re-researching', async () => {
    // 13-item fixture: the intake-parsed sections path (question-portal) wrote
    // meta.sections but pre-dates the short-title rewrite — the exact live
    // damage reported by the user.
    const wall = (n: number) => `Q${n}. ${'B'.repeat(200)} charging question ${n}?`;
    const legacy = Array.from({ length: 13 }, (_, n) =>
      makeItem(stateMgr, {
        title: `Legacy question ${n + 1}?`,
        meta: { sections: completeMemo(`Bluf ${n + 1}.`) }
      })
    );
    // Already-repaired item: originalTitle present → NOT re-normalized.
    const repaired = makeItem(stateMgr, {
      title: 'Repaired question?',
      meta: { sections: completeMemo('Bluf repaired.'), originalTitle: 'O'.repeat(300) }
    });
    // Long title WITHOUT sections but with a proposal: ineligible, untouched.
    const plainLong = makeItem(stateMgr, {
      title: 'Proposed question?',
      meta: { proposedAnswer: { answer: 'x', sources: [], confidence: 0.5, rationale: '' } }
    });
    // Force the pre-fix legacy state: wall-of-text titles, empty detail.
    const state0 = stateMgr.getState();
    legacy.forEach((item, n) => {
      const s = (state0.portalItems || []).find(i => i.id === item.id)!;
      s.title = wall(n + 1);
      s.detail = undefined;
    });
    (state0.portalItems || []).find(i => i.id === plainLong.id)!.title = 'P'.repeat(300);
    stateMgr.saveState(state0);

    const result = await runResearchBackfill(gateDeps);

    expect(result).toEqual({ processed: 0, enriched: 0, normalized: 13, topicTagged: 0 });
    // No research machinery touched the legacy items.
    expect(researchClient.chatCompletion).not.toHaveBeenCalled();
    expect(criticClient.chatCompletion).not.toHaveBeenCalled();
    expect(agentLoopMock).not.toHaveBeenCalled();

    const stored = (id: string) => (stateMgr.getState().portalItems || []).find(i => i.id === id)!;
    for (const [n, item] of legacy.entries()) {
      const s = stored(item.id);
      expect(s.title).toBe('B'.repeat(57) + '…');
      expect(s.title.length).toBe(58); // 57 chars + '…'
      expect(s.meta?.originalTitle).toBe(wall(n + 1));
      expect(s.detail).toBe(wall(n + 1)); // full question text mirrored
      expect(s.meta?.sections?.bluf).toBe(`Bluf ${n + 1}.`); // sections untouched
    }
    expect(stored(repaired.id).meta?.originalTitle).toBe('O'.repeat(300));
    expect(stored(plainLong.id).meta?.originalTitle).toBeUndefined();
  });

  it('normalize pass repairs a debris title under 200 chars (the old >200 rule skipped it)', async () => {
    // The live damage: markdown debris plus a mid-word ellipsis, 62 chars long —
    // short enough for the old `title.length > 200` condition to skip it, so it
    // survived every Research-all click.
    const debris = 'Lithium-ion sub-chemistry and module architecture.** Lith…';
    expect(debris.length).toBeLessThan(200);
    const item = makeItem(stateMgr, {
      title: 'Placeholder question?',
      meta: { sections: { ...completeMemo('Bluf sentinel.'), findings: 'Findings sentinel.' } }
    });
    const state0 = stateMgr.getState();
    (state0.portalItems || []).find(i => i.id === item.id)!.title = debris;
    stateMgr.saveState(state0);

    const result = await runResearchBackfill(gateDeps);

    expect(result).toEqual({ processed: 0, enriched: 0, normalized: 1, topicTagged: 0 });
    expect(researchClient.chatCompletion).not.toHaveBeenCalled();
    const stored = (stateMgr.getState().portalItems || []).find(i => i.id === item.id)!;
    expect(stored.title).toBe('Lithium-ion sub-chemistry and module architecture.');
    expect(stored.meta?.originalTitle).toBe(debris); // dedupe key kept
    expect(stored.detail).toBe(debris); // nothing lost
    expect(stored.meta?.sections?.bluf).toBe('Bluf sentinel.'); // sections untouched
    // Idempotent: a second pass finds nothing damaged and rewrites nothing.
    expect((await runResearchBackfill(gateDeps)).normalized).toBe(0);
  });

  it('topic pass: legacy enriched items get meta.topic from the title tag WITHOUT re-researching', async () => {
    const tagged = makeItem(stateMgr, {
      title: 'Q3. [MECHANICAL] Chassis rail gauge?',
      meta: { sections: completeMemo('Sentinel.') }
    });
    const alreadyTopiced = makeItem(stateMgr, {
      title: 'Q4. [MECHANICAL] Frame material?',
      meta: { sections: completeMemo('Sentinel.'), topic: 'electrical' }
    });
    const untagged = makeItem(stateMgr, {
      title: 'Plain enriched question?',
      meta: { sections: completeMemo('Sentinel.') }
    });

    const result = await runResearchBackfill(gateDeps);

    expect(result).toEqual({ processed: 0, enriched: 0, normalized: 0, topicTagged: 1 });
    expect(researchClient.chatCompletion).not.toHaveBeenCalled();
    expect(criticClient.chatCompletion).not.toHaveBeenCalled();
    expect(agentLoopMock).not.toHaveBeenCalled();
    const stored = (id: string) => (stateMgr.getState().portalItems || []).find(i => i.id === id)!;
    expect(stored(tagged.id).meta?.topic).toBe('mechanical');
    expect(stored(alreadyTopiced.id).meta?.topic).toBe('electrical');
    expect(stored(untagged.id).meta?.topic).toBeUndefined();
  });

  it('old-format memo (no options) is re-researched; options memo and proposed/auto-applied items are not', async () => {
    agentLoopMock.mockImplementation(async () => ({ finalResponse: DECISION_RESEARCH_JSON }));
    const oldFormat = makeItem(stateMgr, {
      title: 'Old format question?',
      meta: {
        sections: {
          bluf: 'Old bluf.',
          findings: 'Old findings.',
          suggestion: 'Old suggestion.',
          defer: 'Deferring costs two weeks.'
        }
      }
    });
    const complete = makeItem(stateMgr, {
      title: 'Complete question?',
      meta: { sections: completeMemo('Sentinel.') }
    });
    const proposed = makeItem(stateMgr, {
      title: 'Proposed question?',
      meta: { proposedAnswer: { answer: 'x', sources: [], confidence: 0.5, rationale: '' } }
    });
    const autoApplied = makeItem(stateMgr, {
      title: 'Auto-applied question?',
      meta: { autoApplied: { answer: 'x', appendedText: 'x', confidence: 1, sources: [], rationale: '' } }
    });

    expect(listBackfillEligibleItems(stateMgr).map(i => i.id)).toEqual([oldFormat.id]);

    const result = await runResearchBackfill(gateDeps);
    expect(result).toEqual({ processed: 1, enriched: 1, normalized: 0, topicTagged: 0 });

    const stored = (id: string) => (stateMgr.getState().portalItems || []).find(i => i.id === id)!;
    const memo = stored(oldFormat.id).meta?.sections!;
    // Options + recommendation regenerated from the researched answer.
    expect(memo.options?.map(o => o.id)).toEqual(['A', 'B']);
    expect(memo.recommendation).toBe('B');
    expect(memo.options?.find(o => o.recommended)?.id).toBe('B');
    expect(memo.alternatives).toContain('Move to 72V');
    // The regenerated fields land; the rest of the memo is kept.
    expect(memo.bluf).toBe('The main contactor is rated for 48V DC.');
    expect(memo.defer).toBe('Deferring costs two weeks.');
    // Ineligible items untouched.
    expect(stored(complete.id).meta?.sections).toEqual(completeMemo('Sentinel.'));
    expect(stored(proposed.id).meta?.sections).toBeUndefined();
    expect(stored(autoApplied.id).meta?.sections).toBeUndefined();
  });

  it('buildQuestionSections parses labelled options + Recommended out of the answer', () => {
    const sections = buildQuestionSections({
      answer:
        'The main contactor is rated for 48V DC.\nAlternatives:\nA) Keep the 48V contactor.\nB) Move to 72V.\nRecommended: B',
      sources: [{ title: 'Vendor datasheet' }],
      reasoning: ''
    });
    expect(sections.options?.map(o => o.id)).toEqual(['A', 'B']);
    expect(sections.recommendation).toBe('B');
    expect(sections.options?.find(o => o.recommended)?.id).toBe('B');
    expect(sections.alternatives).toContain('A) Keep the 48V contactor.');
    // The decision block is not duplicated into the suggestion.
    expect(sections.suggestion).toBe('The main contactor is rated for 48V DC.');

    // No labelled options → options stay undefined (never fabricated).
    const plain = buildQuestionSections({ answer: 'Alternatives: none.', sources: [], reasoning: '' });
    expect(plain.options).toBeUndefined();
    expect(plain.recommendation).toBeUndefined();
  });

  it('topic pass: untagged items get a conservative keyword-inferred meta.topic (R5)', async () => {
    const inferred = makeItem(stateMgr, {
      title: 'Fuse selectivity decision: branch fuse current rating and pack voltage',
      meta: { sections: completeMemo('Sentinel.') }
    });
    const vague = makeItem(stateMgr, {
      title: 'Plain enriched question?',
      meta: { sections: completeMemo('Sentinel.') }
    });

    const result = await runResearchBackfill(gateDeps);

    expect(result).toEqual({ processed: 0, enriched: 0, normalized: 0, topicTagged: 1 });
    const stored = (id: string) => (stateMgr.getState().portalItems || []).find(i => i.id === id)!;
    expect(stored(inferred.id).meta?.topic).toBe('electrical');
    expect(stored(vague.id).meta?.topic).toBeUndefined();
  });
});

// ── Endpoint POST /api/portal/research-all ──────────────────────────

const { agentLoopMock, applyAnswerMock } = vi.hoisted(() => ({
  agentLoopMock: vi.fn(),
  applyAnswerMock: vi.fn()
}));

vi.mock('../src/core/agent-loop.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/agent-loop.js')>();
  return { ...actual, runAgentToolLoop: agentLoopMock };
});

vi.mock('../src/core/answer-applier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/answer-applier.js')>();
  return { ...actual, applyAnswer: applyAnswerMock };
});

describe('POST /api/portal/research-all', () => {
  let tempDir: string;
  let server: http.Server;
  let stateManager: ProjectStateManager;
  let session: any;
  let openRouterClient: any;

  async function request(method: string, urlPath: string, body?: unknown) {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  function seedItem(overrides: { title?: string; meta?: Record<string, unknown> } = {}): PortalItem {
    // Title/meta overrides go into the create call itself: addPortalItem
    // dedupes on the pre-override title, so post-hoc mutation would corrupt
    // the first item instead of creating a distinct one.
    return addPortalItem(stateManager, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the main contactor voltage rating?',
      source: 'autopilot',
      ...(overrides.title ? { title: overrides.title } : {}),
      ...(overrides.meta ? { meta: overrides.meta as any } : {})
    } as any);
  }

  beforeEach(async () => {
    agentLoopMock.mockReset().mockImplementation(async () => ({ finalResponse: RESEARCH_JSON }));
    applyAnswerMock.mockReset().mockImplementation(async (_deps: any, itemId: string, answer: string) => ({
      updatedItem: { id: itemId, title: 'Unused', status: 'answered', answer },
      affectedDocs: [],
      counterQuestions: []
    }));

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-research-all-routes-'));
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'docs', 'CONOPS.md'), '# CONOPS\n\nBaseline.\n', 'utf-8');
    stateManager = new ProjectStateManager(tempDir);
    stateManager.getOrCreateState('p1', 'Research All Routes Test');

    openRouterClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(openRouterClient, 'chatCompletion').mockImplementation(async () =>
      chat(JSON.stringify({ confidence: 0.5, verdict: 'propose', rationale: 'Vendor spec states the rating.' }))
    );

    session = new ServerSessionManager({
      projectPath: tempDir,
      stateManager,
      apiKey: 'mock',
      providers: [],
      assignments: {
        drafting: { providerId: 'openrouter', model: 'test-model' },
        critic: { providerId: 'openrouter', model: 'test-model' },
        classifier: { providerId: 'openrouter', model: 'test-model' },
        compaction: { providerId: 'openrouter', model: 'test-model' },
        transcriber: { providerId: 'openrouter', model: DEFAULT_TRANSCRIBER_MODEL }
      },
      clientFactory: () => openRouterClient,
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry()
    } as any);

    server = createHttpServer({ projectPath: tempDir, stateManager, session });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('iterates eligible legacy items only; writes sections; clears researching', async () => {
    const plain = seedItem();
    seedItem({ title: 'Already enriched?', meta: { sections: completeMemo('Sentinel.') } });
    seedItem({
      title: 'Has proposal?',
      meta: { proposedAnswer: { answer: 'x', sources: [], confidence: 0.5, rationale: '' } }
    });

    const res = await request('POST', '/api/portal/research-all');
    expect(res.status).toBe(200);
    expect(res.json?.data).toEqual({ started: true, count: 1 });

    await vi.waitFor(() => {
      const stored = (stateManager.getState().portalItems || []).find(i => i.id === plain.id)!;
      expect(stored.meta?.sections?.bluf).toBe('The main contactor is rated for 48V DC.');
    });
    const stored = (stateManager.getState().portalItems || []).find(i => i.id === plain.id)!;
    expect(stored.status).toBe('open');
    expect(stored.meta?.researching).toBe(false);
    expect(stored.meta?.proposedAnswer).toBeTruthy();
    // Only the eligible item was researched (agent-loop mock called once).
    expect(agentLoopMock).toHaveBeenCalledTimes(1);
    expect(agentLoopMock.mock.calls[0][0].userMessage).toContain('What is the main contactor voltage rating?');
  });

  it('busy guard: refuses while the autopilot chain is running', async () => {
    seedItem();
    const state = stateManager.getState();
    state.autopilot = { ...state.autopilot, running: true } as any;
    stateManager.saveState(state);
    const res = await request('POST', '/api/portal/research-all');
    expect(res.status).toBe(409);
    expect(res.json?.error).toContain('Autopilot');
    expect(agentLoopMock).not.toHaveBeenCalled();
  });

  it('single run at a time: second call while in flight returns started:false', async () => {
    seedItem();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    agentLoopMock.mockImplementation(async () => {
      await gate;
      return { finalResponse: RESEARCH_JSON };
    });
    const first = await request('POST', '/api/portal/research-all');
    expect(first.json?.data?.started).toBe(true);
    const second = await request('POST', '/api/portal/research-all');
    expect(second.json?.data?.started).toBe(false);
    release();
    await vi.waitFor(() => {
      expect(agentLoopMock).toHaveBeenCalledTimes(1);
    });
  });
});

// ── Live gate caller (session.maybeRunResearchGate) ──────────────────

describe('maybeRunResearchGate (live gate)', () => {
  let tempDir: string;
  let stateManager: ProjectStateManager;
  let session: any;
  let openRouterClient: any;

  beforeEach(() => {
    agentLoopMock.mockReset().mockImplementation(async () => ({ finalResponse: RESEARCH_JSON }));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-research-live-'));
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'docs', 'CONOPS.md'), '# CONOPS\n\nBaseline.\n', 'utf-8');
    stateManager = new ProjectStateManager(tempDir);
    stateManager.getOrCreateState('p1', 'Live Gate Test');
    openRouterClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(openRouterClient, 'chatCompletion').mockImplementation(async () =>
      chat(JSON.stringify({ confidence: 0.5, corroborated: false, verdict: 'propose', rationale: 'Vendor spec states the rating.' }))
    );
    session = new ServerSessionManager({
      projectPath: tempDir,
      stateManager,
      apiKey: 'mock',
      providers: [],
      assignments: {
        drafting: { providerId: 'openrouter', model: 'test-model' },
        critic: { providerId: 'openrouter', model: 'test-model' },
        classifier: { providerId: 'openrouter', model: 'test-model' },
        compaction: { providerId: 'openrouter', model: 'test-model' },
        transcriber: { providerId: 'openrouter', model: DEFAULT_TRANSCRIBER_MODEL }
      },
      clientFactory: () => openRouterClient,
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry()
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const stored = (id: string) => (stateManager.getState().portalItems || []).find(i => i.id === id)!;

  it('enriches the item with format-v2 sections and rewrites a wall-of-text title', async () => {
    const long = 'Q1. ' + 'C'.repeat(100);
    const item = addPortalItem(stateManager, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: long,
      source: 'autopilot'
    } as any);

    (session as any).maybeRunResearchGate(item);

    await vi.waitFor(() => {
      expect(stored(item.id).meta?.sections?.bluf).toBe('The main contactor is rated for 48V DC.');
    });
    expect(stored(item.id).title).toBe('C'.repeat(57) + '…');
    expect(stored(item.id).meta?.originalTitle).toBe(long);
    expect(stored(item.id).meta?.researching).toBe(false);
  });

  it('a hung run is abandoned at the cap — researching cleared, in-flight slot released', async () => {
    vi.useFakeTimers();
    try {
      agentLoopMock.mockImplementation(() => new Promise<never>(() => {}));
      const item = addPortalItem(stateManager, {
        type: 'question',
        severity: 'normal',
        docPath: 'docs/CONOPS.md',
        title: 'Kelly controller question?',
        source: 'autopilot'
      } as any);

      (session as any).maybeRunResearchGate(item);
      await vi.advanceTimersByTimeAsync(RESEARCH_GATE_ITEM_TIMEOUT_MS);

      expect(stored(item.id).meta?.researching).toBe(false);
      expect(stored(item.id).status).toBe('open');
      expect(stored(item.id).meta?.sections).toBeUndefined();
      expect((session as any).gateInFlight.has(item.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
