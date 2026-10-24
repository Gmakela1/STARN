import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { createHttpServer } from '../src/server/server.js';
import { ServerSessionManager } from '../src/server/session.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { addPortalItem } from '../src/core/question-portal.js';
import { DEFAULT_TRANSCRIBER_MODEL } from '../src/config.js';
import type { TurnResult } from '../src/core/runner.js';
import type { PortalItem } from '../src/workspace/types.js';

/**
 * Module seams for the answer-queue behavior under test.
 *
 * - applyAnswer (core/answer-applier): the span that runs a model turn +
 *   change-impact agent loop. The session's queue machinery (busy gating,
 *   FIFO draining, frames, router codes) is what this file tests, so the
 *   slow model-calling boundary is stubbed with a complete-result double.
 * - CoreRunner.executeTurn (core/runner): stubbed only for the
 *   drain-before-next-phase test so a "phase" can be held mid-flight
 *   deterministically without running the real agent loop.
 */
const { applyAnswerMock } = vi.hoisted(() => ({ applyAnswerMock: vi.fn() }));
const { executeTurnMock } = vi.hoisted(() => ({ executeTurnMock: vi.fn() }));

vi.mock('../src/core/answer-applier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/answer-applier.js')>();
  return { ...actual, applyAnswer: applyAnswerMock };
});

vi.mock('../src/core/runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/runner.js')>();
  return {
    ...actual,
    CoreRunner: class extends actual.CoreRunner {
      static executeTurn = executeTurnMock;
    }
  };
});

async function request(server: http.Server, method: string, urlPath: string, body?: unknown) {
  const port = (server.address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* non-JSON */ }
  return { status: res.status, json, raw };
}

function answeredItem(id: string, title: string, answer: string): PortalItem {
  return {
    id,
    type: 'question',
    severity: 'normal',
    docPath: 'docs/CONOPS.md',
    title,
    source: 'autopilot',
    status: 'answered',
    answer,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z'
  };
}

function makeTurnResult(specialistId: string): TurnResult {
  return {
    specialistId,
    specialistName: specialistId,
    output: '# Heading\n\nDraft.',
    criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' },
    autoRevisionsRun: 0,
    requiresReview: true,
    sessionMessages: []
  };
}

describe('server answer queue', () => {
  let tempDir: string;
  let server: http.Server;
  let stateManager: ProjectStateManager;
  let session: ServerSessionManager;
  let client: OpenRouterClient;
  let frames: any[];

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-answer-queue-'));
    fs.mkdirSync(path.join(tempDir, 'docs', 'work_instructions'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'artifacts'), { recursive: true });

    stateManager = new ProjectStateManager(tempDir);
    stateManager.getOrCreateState('p1', 'Answer Queue Test');

    client = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(client, 'chatCompletion').mockImplementation(async () => ({
      content: '# Draft (unused — model boundary is stubbed in this suite)',
      raw: {}
    }));

    applyAnswerMock.mockReset();
    applyAnswerMock.mockImplementation(async (_deps: any, itemId: string, answer: string) => {
      return {
        updatedItem: answeredItem(itemId, 'Unused title', answer),
        affectedDocs: ['icd'],
        counterQuestions: []
      };
    });
    executeTurnMock.mockReset();

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
      clientFactory: () => client,
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry()
    });

    frames = [];
    session.addSubscriber((ev: any) => frames.push(ev));

    server = createHttpServer({ projectPath: tempDir, stateManager, session });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function addItem(title: string = 'What bus voltage?'): { id: string; title: string; answer: string } {
    const item = addPortalItem(stateManager, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title,
      source: 'autopilot'
    });
    return { id: item.id, title: item.title, answer: '48V nominal' };
  }

  it('a. busy session queues the answer and publishes answer_queued without applying', () => {
    const item = addItem();

    (session as any).beginTurn();
    try {
      const result = session.queueAnswer(item.id, item.answer);

      expect(result).toEqual({ queued: true });
      expect(applyAnswerMock).not.toHaveBeenCalled();
      expect(frames).toContainEqual(
        expect.objectContaining({ kind: 'answer_queued', itemId: item.id, title: item.title })
      );
    } finally {
      (session as any).endTurn();
    }
  });

  it('b. idle session applies immediately and publishes answer_applied', async () => {
    const item = addItem();

    const result = session.queueAnswer(item.id, item.answer);

    expect(result).toEqual({ queued: false });
    await vi.waitFor(() => expect(applyAnswerMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      expect(frames.some(f => f.kind === 'answer_applied' && f.itemId === item.id)).toBe(true);
    });

    expect(applyAnswerMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: tempDir, stateManager }),
      item.id,
      item.answer
    );

    // Immediate applies skip the queued frame, ordering is applying → applied.
    expect(frames.some(f => f.kind === 'answer_queued')).toBe(false);
    const applyingIdx = frames.findIndex(f => f.kind === 'answer_applying' && f.itemId === item.id);
    const appliedIdx = frames.findIndex(f => f.kind === 'answer_applied' && f.itemId === item.id);
    expect(applyingIdx).toBeGreaterThanOrEqual(0);
    expect(appliedIdx).toBeGreaterThan(applyingIdx);

    const applied = frames.find(f => f.kind === 'answer_applied' && f.itemId === item.id);
    expect(applied.item.status).toBe('answered');
    expect(applied.item.answer).toBe(item.answer);
    expect(applied.affectedDocs).toEqual(['icd']);
  });

  it('c. queued answers drain FIFO once the busy turn ends', async () => {
    const itemA = addItem('First question');
    const itemB = addItem('Second question');
    const callOrder: string[] = [];
    applyAnswerMock.mockImplementation(async (_deps: any, itemId: string, answer: string) => {
      callOrder.push(itemId);
      return { updatedItem: answeredItem(itemId, 'Unused', answer), affectedDocs: [], counterQuestions: [] };
    });

    (session as any).beginTurn();
    session.queueAnswer(itemA.id, itemA.answer);
    session.queueAnswer(itemB.id, itemB.answer);
    expect(applyAnswerMock).not.toHaveBeenCalled();

    (session as any).endTurn();
    await (session as any).runQueuedAnswers();

    expect(callOrder).toEqual([itemA.id, itemB.id]);
    const appliedItemIds = frames.filter(f => f.kind === 'answer_applied').map(f => f.itemId);
    expect(appliedItemIds).toEqual([itemA.id, itemB.id]);
    const queuedTitles = frames.filter(f => f.kind === 'answer_queued').map(f => f.title);
    expect(queuedTitles).toEqual([itemA.title, itemB.title]);
  });

  it('d. drains queued answers before the next phase turn starts drafting', async () => {
    const item = addItem('Phase question');
    const order: string[] = [];
    let releaseDrafting!: () => void;
    const draftingGate = new Promise<void>(r => { releaseDrafting = r; });

    // The current (next) phase's drafting call blocks mid-flight until released.
    executeTurnMock.mockImplementation(async () => {
      order.push('draft');
      await draftingGate;
      return makeTurnResult('conops');
    });
    applyAnswerMock.mockImplementation(async (_deps: any, itemId: string, answer: string) => {
      order.push('apply');
      return { updatedItem: answeredItem(itemId, 'Unused', answer), affectedDocs: [], counterQuestions: [] };
    });

    // Autopilot is mid-run: a turn is in progress and its drafting call blocks.
    (session as any).beginTurn();
    const wrapper = (session as any).makeExecuteTurn(new AbortController());
    const phase1 = wrapper({ userPrompt: 'phase one', forceSpecialistId: 'conops' });

    await vi.waitFor(() => expect(order).toEqual(['draft']));

    // User answers while the phase is mid-flight → queued, not applied.
    const queueResult = session.queueAnswer(item.id, item.answer);
    expect(queueResult).toEqual({ queued: true });
    expect(order).toEqual(['draft']);

    // Phase 1 finishes; the next phase's wrapper must drain the queue BEFORE
    // its own drafting call.
    releaseDrafting();
    await phase1;
    await wrapper({ userPrompt: 'phase two', forceSpecialistId: 'architecture' });

    const applyIdx = order.indexOf('apply');
    const secondDraftIdx = order.lastIndexOf('draft');
    expect(applyIdx).toBeGreaterThanOrEqual(0);
    expect(secondDraftIdx).toBeGreaterThan(applyIdx);
    expect(applyAnswerMock).toHaveBeenCalledWith(expect.objectContaining({ projectPath: tempDir }), item.id, item.answer);
  });

  it('e. apply failure publishes answer_failed and the queue keeps draining', async () => {
    const itemA = addItem('Failing question');
    const itemB = addItem('Good question');
    applyAnswerMock
      .mockRejectedValueOnce(new Error('Critic still fails'))
      .mockImplementationOnce(async (_deps: any, itemId: string, answer: string) => ({
        updatedItem: answeredItem(itemId, 'Unused', answer),
        affectedDocs: [],
        counterQuestions: []
      }));

    (session as any).beginTurn();
    session.queueAnswer(itemA.id, itemA.answer);
    session.queueAnswer(itemB.id, itemB.answer);
    (session as any).endTurn();

    await (session as any).runQueuedAnswers();

    const failed = frames.find(f => f.kind === 'answer_failed' && f.itemId === itemA.id);
    expect(failed?.error).toBe('Critic still fails');
    const failedIdx = frames.findIndex(f => f.kind === 'answer_failed' && f.itemId === itemA.id);
    const appliedBIdx = frames.findIndex(f => f.kind === 'answer_applied' && f.itemId === itemB.id);
    expect(failedIdx).toBeGreaterThanOrEqual(0);
    expect(appliedBIdx).toBeGreaterThan(failedIdx);
  });

  it('f1. POST /answer returns 202 {queued:true} while a turn is in progress', async () => {
    const item = addItem();

    (session as any).beginTurn();
    try {
      const { status, json } = await request(server, 'POST', `/api/portal/${item.id}/answer`, { answer: item.answer });
      expect(status).toBe(202);
      expect(json).toEqual({ success: true, data: { queued: true }, error: null });
    } finally {
      (session as any).endTurn();
    }
  });

  it('f2. POST /answer returns 200 {applied:true} when idle', async () => {
    const item = addItem();

    const { status, json } = await request(server, 'POST', `/api/portal/${item.id}/answer`, { answer: item.answer });
    expect(status).toBe(200);
    expect(json).toEqual({ success: true, data: { applied: true }, error: null });
  });

  it('f3. POST /answer without body.answer returns 400', async () => {
    const item = addItem();

    const { status, json } = await request(server, 'POST', `/api/portal/${item.id}/answer`, {});
    expect(status).toBe(400);
    expect(json.error).toContain('Missing "answer"');
  });

  it('f4. POST /answer for an unknown item returns 404', async () => {
    const { status, json } = await request(server, 'POST', '/api/portal/nonexistent/answer', { answer: '48V' });
    expect(status).toBe(404);
    expect(json.error).toContain('not found');
  });
});