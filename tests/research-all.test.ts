import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  runResearchBackfill,
  ResearchGateDeps,
  ResearchBackfillDeps
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
      meta: { sections: { bluf: 'Sentinel.' } }
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
    expect(result).toEqual({ processed: 1, enriched: 1 });
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
    expect(stored(withSections.id).meta?.sections).toEqual({ bluf: 'Sentinel.' });
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
    expect(result).toEqual({ processed: 0, enriched: 0 });
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
    expect(result).toEqual({ processed: 1, enriched: 1 });
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
    expect(result).toEqual({ processed: 1, enriched: 0 });
    const stored = (stateMgr.getState().portalItems || []).find(i => i.id === item.id)!;
    expect(stored.status).toBe('open');
    expect(stored.meta?.sections).toBeUndefined();
    expect(stored.meta?.researching).toBe(false);
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
    seedItem({ title: 'Already enriched?', meta: { sections: { bluf: 'Sentinel.' } } });
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
