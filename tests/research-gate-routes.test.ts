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

/**
 * Research-gate portal routes under test:
 * - POST /api/portal/:id/confirm-proposal → session answer-applier path with
 *   'user-confirmed-research' provenance (applyAnswer mocked at the module
 *   seam — the slow model boundary is not what this suite tests).
 * - POST /api/portal/:id/reject-proposal → proposal cleared, item stays open.
 * - POST /api/portal/:id/undo-auto → core undo (NOT mocked): exact appended
 *   text removal + re-open, and 409 once incorporated.
 * - GET /api/portal → in-memory `autoApplied.incorporated` decoration.
 */
const { applyAnswerMock } = vi.hoisted(() => ({ applyAnswerMock: vi.fn() }));

vi.mock('../src/core/answer-applier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/answer-applier.js')>();
  return { ...actual, applyAnswer: applyAnswerMock };
});

async function request(server: http.Server, method: string, urlPath: string, body?: unknown) {
  const port = (server.address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

describe('research gate portal routes', () => {
  let tempDir: string;
  let server: http.Server;
  let stateManager: ProjectStateManager;
  let session: ServerSessionManager;
  let openRouterClient: OpenRouterClient;
  const BASELINE = '# CONOPS\n\nBaseline.\n';
  const APPENDED = '\n\n## User Answers (Pending Incorporation)\n\n**Contactor rating**\nAnswer: 48V\n';

  function seedItem(overrides: Record<string, unknown> = {}): any {
    const item = addPortalItem(stateManager, {
      type: 'question',
      severity: 'normal',
      docPath: 'docs/CONOPS.md',
      title: 'What is the main contactor voltage rating?',
      source: 'autopilot'
    });
    if (Object.keys(overrides).length > 0) {
      const state = stateManager.getState();
      const stored = (state.portalItems || []).find(i => i.id === item.id)!;
      for (const [k, v] of Object.entries(overrides)) {
        (stored as any)[k] = v;
      }
      stateManager.saveState(state);
    }
    return item;
  }

  /** Fresh session deps bound to the current tempDir/stateManager (recovery test builds a second session). */
  function makeSessionDeps(): ConstructorParameters<typeof ServerSessionManager>[0] {
    return {
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
    };
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-research-gate-routes-'));
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'docs', 'work_instructions'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'docs', 'CONOPS.md'), BASELINE, 'utf-8');

    stateManager = new ProjectStateManager(tempDir);
    stateManager.getOrCreateState('p1', 'Research Gate Routes Test');

    applyAnswerMock.mockReset();
    applyAnswerMock.mockImplementation(async (_deps: any, itemId: string, answer: string) => ({
      updatedItem: { id: itemId, title: 'Unused', status: 'answered', answer },
      affectedDocs: [],
      counterQuestions: []
    }));

    openRouterClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(openRouterClient, 'chatCompletion').mockImplementation(async () => ({
      content: '# Unused',
      raw: {}
    }));

    session = new ServerSessionManager(makeSessionDeps());

    server = createHttpServer({ projectPath: tempDir, stateManager, session });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('session start: stale researching tombstone is cleared and the gate re-fires', async () => {
    const item = seedItem({ meta: { researching: true } });
    const callsBefore = openRouterClient.chatCompletion.mock.calls.length;
    // "Session start": a fresh session manager over the same project state.
    new ServerSessionManager(makeSessionDeps());
    await vi.waitFor(() => {
      const stored = (stateManager.getState().portalItems || []).find((i: any) => i.id === item.id)!;
      expect(stored.meta?.researching).toBe(false);
    });
    expect(openRouterClient.chatCompletion.mock.calls.length).toBe(callsBefore + 1);
  });

  it('confirm-proposal: edited text routes through the applier with user-confirmed-research provenance; proposal cleared', async () => {
    const item = seedItem({
      meta: {
        proposedAnswer: { answer: '48V per datasheet', sources: [{ title: 'Vendor ds' }], confidence: 0.7, rationale: 'Vendor spec.' }
      }
    });
    const res = await request(server, 'POST', `/api/portal/${item.id}/confirm-proposal`, { answer: 'Edited: 48V nominal' });
    expect(res.status).toBe(200);
    expect(res.json?.data?.applied).toBe(true);
    expect(applyAnswerMock).toHaveBeenCalledTimes(1);
    const [depsArg, idArg, answerArg, optsArg] = applyAnswerMock.mock.calls[0];
    expect(idArg).toBe(item.id);
    expect(answerArg).toBe('Edited: 48V nominal');
    expect(optsArg).toEqual({ provenance: 'user-confirmed-research' });
    expect(depsArg).toHaveProperty('stateManager');
    const stored = (stateManager.getState().portalItems || []).find(i => i.id === item.id)!;
    expect(stored.meta?.proposedAnswer).toBeUndefined();
  });

  it('confirm-proposal: empty body applies the proposal text as-is', async () => {
    const item = seedItem({
      meta: {
        proposedAnswer: { answer: '48V per datasheet', sources: [], confidence: 0.7, rationale: '' }
      }
    });
    const res = await request(server, 'POST', `/api/portal/${item.id}/confirm-proposal`, {});
    expect(res.status).toBe(200);
    expect(applyAnswerMock.mock.calls[0][2]).toBe('48V per datasheet');
  });

  it('confirm-proposal: no pending proposal → 409; unknown item → 404', async () => {
    const item = seedItem();
    const noProposal = await request(server, 'POST', `/api/portal/${item.id}/confirm-proposal`, {});
    expect(noProposal.status).toBe(409);
    const missing = await request(server, 'POST', '/api/portal/p_does_not_exist/confirm-proposal', {});
    expect(missing.status).toBe(404);
  });

  it('reject-proposal: clears the proposal, item stays open plain; second call → 409', async () => {
    const item = seedItem({
      meta: {
        proposedAnswer: { answer: '48V', sources: [], confidence: 0.5, rationale: 'Forum.' }
      }
    });
    const res = await request(server, 'POST', `/api/portal/${item.id}/reject-proposal`);
    expect(res.status).toBe(200);
    const stored = (stateManager.getState().portalItems || []).find(i => i.id === item.id)!;
    expect(stored.status).toBe('open');
    expect(stored.meta?.proposedAnswer).toBeUndefined();
    const again = await request(server, 'POST', `/api/portal/${item.id}/reject-proposal`);
    expect(again.status).toBe(409);
  });

  it('undo-auto: removes the exact appended text and re-opens the item', async () => {
    const item = seedItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: {
          answer: '48V',
          appendedText: APPENDED,
          confidence: 0.97,
          sources: [],
          rationale: 'Vendor datasheet.'
        }
      }
    });
    fs.writeFileSync(path.join(tempDir, 'docs', 'CONOPS.md'), BASELINE.trimEnd() + APPENDED, 'utf-8');
    const res = await request(server, 'POST', `/api/portal/${item.id}/undo-auto`);
    expect(res.status).toBe(200);
    const doc = fs.readFileSync(path.join(tempDir, 'docs', 'CONOPS.md'), 'utf-8');
    expect(doc).toBe(BASELINE.trimEnd());
    const stored = (stateManager.getState().portalItems || []).find(i => i.id === item.id)!;
    expect(stored.status).toBe('open');
    expect(stored.meta?.autoApplied).toBeUndefined();
  });

  it('undo-auto: two identical blocks — undoing the second removes the second, the first survives', async () => {
    // Byte-identical appends (same displayTitle, same answer) on one doc, with
    // a third, different block between them so the removal position is
    // observable (identical bytes alone cannot tell first from second).
    const OTHER = '\n\n## User Answers (Pending Incorporation)\n\n**Fuse rating**\nAnswer: 40A\n';
    const first = seedItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: {
          answer: '48V',
          appendedText: APPENDED,
          docPath: 'docs/CONOPS.md',
          offset: BASELINE.trimEnd().length,
          confidence: 0.97,
          sources: [],
          rationale: ''
        }
      }
    });
    const second = seedItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: {
          answer: '48V',
          appendedText: APPENDED,
          docPath: 'docs/CONOPS.md',
          offset: BASELINE.trimEnd().length + APPENDED.length + OTHER.length,
          confidence: 0.97,
          sources: [],
          rationale: ''
        }
      }
    });
    const docFile = path.join(tempDir, 'docs', 'CONOPS.md');
    fs.writeFileSync(docFile, BASELINE.trimEnd() + APPENDED + OTHER + APPENDED, 'utf-8');

    // Every block still present → neither item is incorporated.
    const before = await request(server, 'GET', '/api/portal');
    expect(before.json?.data?.items.find((i: any) => i.id === second.id)?.meta?.autoApplied?.incorporated).toBeUndefined();

    const res = await request(server, 'POST', `/api/portal/${second.id}/undo-auto`);
    expect(res.status).toBe(200);
    expect(fs.readFileSync(docFile, 'utf-8')).toBe(BASELINE.trimEnd() + APPENDED + OTHER);

    // The first item's block is untouched and still undoable at its own offset.
    const firstAfter = (stateManager.getState().portalItems || []).find((i: any) => i.id === first.id)!;
    expect(firstAfter.status).toBe('answered');
    const firstUndo = await request(server, 'POST', `/api/portal/${first.id}/undo-auto`);
    expect(firstUndo.status).toBe(200);
    expect(fs.readFileSync(docFile, 'utf-8')).toBe(BASELINE.trimEnd() + OTHER);
  });

  it('undo-auto: legacy meta.autoApplied without offset still undoes (first-occurrence fallback)', async () => {
    const legacy = seedItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: { answer: '48V', appendedText: APPENDED, confidence: 0.97, sources: [], rationale: '' }
      }
    });
    const docFile = path.join(tempDir, 'docs', 'CONOPS.md');
    fs.writeFileSync(docFile, BASELINE.trimEnd() + APPENDED + APPENDED, 'utf-8');

    const res = await request(server, 'POST', `/api/portal/${legacy.id}/undo-auto`);
    expect(res.status).toBe(200);
    expect(fs.readFileSync(docFile, 'utf-8')).toBe(BASELINE.trimEnd() + APPENDED);
    const stored = (stateManager.getState().portalItems || []).find((i: any) => i.id === legacy.id)!;
    expect(stored.status).toBe('open');
  });

  it('GET /api/portal: an identical surviving block does not mask incorporation of the removed one', async () => {
    const first = seedItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: {
          answer: '48V',
          appendedText: APPENDED,
          docPath: 'docs/CONOPS.md',
          offset: BASELINE.trimEnd().length,
          confidence: 0.97,
          sources: [],
          rationale: ''
        }
      }
    });
    const second = seedItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: {
          answer: '48V',
          appendedText: APPENDED,
          docPath: 'docs/CONOPS.md',
          offset: BASELINE.trimEnd().length + APPENDED.length,
          confidence: 0.97,
          sources: [],
          rationale: ''
        }
      }
    });
    // Only the SECOND block was incorporated away; the first copy survives.
    fs.writeFileSync(path.join(tempDir, 'docs', 'CONOPS.md'), BASELINE.trimEnd() + APPENDED, 'utf-8');

    const res = await request(server, 'GET', '/api/portal');
    const items = res.json?.data?.items ?? [];
    expect(items.find((i: any) => i.id === second.id)?.meta?.autoApplied?.incorporated).toBe(true);
    expect(items.find((i: any) => i.id === first.id)?.meta?.autoApplied?.incorporated).toBeUndefined();
  });

  it('undo-auto: already incorporated → 409, item untouched', async () => {
    const item = seedItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: { answer: '48V', appendedText: APPENDED, confidence: 0.97, sources: [], rationale: '' }
      }
    });
    fs.writeFileSync(path.join(tempDir, 'docs', 'CONOPS.md'), '# CONOPS\n\nIncorporated.\n', 'utf-8');
    const res = await request(server, 'POST', `/api/portal/${item.id}/undo-auto`);
    expect(res.status).toBe(409);
    const stored = (stateManager.getState().portalItems || []).find(i => i.id === item.id)!;
    expect(stored.status).toBe('answered');
  });

  it('undo-auto: item without autoApplied → 409', async () => {
    const item = seedItem();
    const res = await request(server, 'POST', `/api/portal/${item.id}/undo-auto`);
    expect(res.status).toBe(409);
  });

  it('GET /api/portal decorates incorporated auto-applied items (in-memory only)', async () => {
    const item = seedItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: { answer: '48V', appendedText: APPENDED, confidence: 0.97, sources: [], rationale: '' }
      }
    });
    // Doc does NOT contain the appended text → incorporated.
    fs.writeFileSync(path.join(tempDir, 'docs', 'CONOPS.md'), '# CONOPS\n\nIncorporated.\n', 'utf-8');
    const res = await request(server, 'GET', '/api/portal');
    const decorated = res.json?.data?.items.find((i: any) => i.id === item.id);
    expect(decorated?.meta?.autoApplied?.incorporated).toBe(true);
    // The persisted store is untouched (decoration is in-memory only).
    const stored = (stateManager.getState().portalItems || []).find(i => i.id === item.id)!;
    expect(stored.meta?.autoApplied?.incorporated).toBeUndefined();
  });

  it('GET /api/portal leaves pre-incorporation auto-applied items undecorated (UNDO still offered)', async () => {
    const item = seedItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: { answer: '48V', appendedText: APPENDED, confidence: 0.97, sources: [], rationale: '' }
      }
    });
    fs.writeFileSync(path.join(tempDir, 'docs', 'CONOPS.md'), BASELINE.trimEnd() + APPENDED, 'utf-8');
    const res = await request(server, 'GET', '/api/portal');
    const decorated = res.json?.data?.items.find((i: any) => i.id === item.id);
    expect(decorated?.meta?.autoApplied?.incorporated).toBeUndefined();
  });
});
