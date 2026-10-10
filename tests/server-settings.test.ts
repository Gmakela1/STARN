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
import { Assignments, ProviderConfig } from '../src/config.js';
import { ChatClient } from '../src/openrouter/types.js';

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

const PING_CALL = { content: null, toolCalls: [{ id: '1', type: 'function' as const, function: { name: 'ping', arguments: '{}' } }], raw: {} };

describe('settings + providers API', () => {
  let tempDir: string;
  let server: http.Server;
  let session: ServerSessionManager;
  let saved: Array<{ providers: ProviderConfig[]; assignments: Assignments }>;
  let clients: Record<string, { chatCompletion: ReturnType<typeof vi.fn> }>;

  const lm: ProviderConfig = { id: 'lm', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'secret-lm' };
  const assignments: Assignments = {
    drafting: { providerId: 'openrouter', model: 'a/m' },
    critic: { providerId: 'lm', model: 'crit' },
    classifier: { providerId: 'openrouter', model: 'a/m' },
    compaction: { providerId: 'openrouter', model: 'a/m' }
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-settings-'));
    const stateManager = new ProjectStateManager(tempDir);
    stateManager.getOrCreateState('p1', 'Tractor');
    saved = [];
    clients = {};
    session = new ServerSessionManager({
      projectPath: tempDir,
      stateManager,
      apiKey: 'sk-or-secret',
      providers: [lm],
      assignments,
      clientFactory: (p): ChatClient => {
        clients[p.id] = clients[p.id] ?? { chatCompletion: vi.fn(async () => PING_CALL) };
        return clients[p.id] as unknown as ChatClient;
      },
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry()
    });
    server = createHttpServer({ projectPath: tempDir, stateManager, session, onSettingsSaved: s => saved.push(s) });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET /api/settings lists openrouter first and masks keys', async () => {
    const { status, json, raw } = await request(server, 'GET', '/api/settings');
    expect(status).toBe(200);
    expect(raw).not.toContain('secret');
    expect(json.data.providers[0]).toMatchObject({ id: 'openrouter', builtIn: true, hasKey: true });
    expect(json.data.providers[1]).toEqual({ id: 'lm', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1/v1', hasKey: true, builtIn: false });
    expect(json.data.assignments.critic).toEqual({ providerId: 'lm', model: 'crit' });
  });

  it('PUT with unknown provider → 400 naming the role', async () => {
    const { status, json } = await request(server, 'PUT', '/api/settings', {
      assignments: { classifier: { providerId: 'ghost', model: 'x' } }
    });
    expect(status).toBe(400);
    expect(json.error).toContain('role "classifier" references unknown provider "ghost"');
  });

  it('PUT with provider id openrouter → 400', async () => {
    const { status } = await request(server, 'PUT', '/api/settings', {
      providers: [{ id: 'openrouter', name: 'x', baseUrl: 'http://x/v1' }, lm]
    });
    expect(status).toBe(400);
  });

  it('PUT with duplicate provider id → 400', async () => {
    const { status } = await request(server, 'PUT', '/api/settings', { providers: [lm, { ...lm }] });
    expect(status).toBe(400);
  });

  it('PUT removing an assigned provider → 400 naming the role', async () => {
    const { status, json } = await request(server, 'PUT', '/api/settings', { providers: [] });
    expect(status).toBe(400);
    expect(json.error).toContain('role "critic"');
  });

  it('PUT provider without apiKey keeps the existing key', async () => {
    const { status } = await request(server, 'PUT', '/api/settings', {
      providers: [{ id: 'lm', name: 'LM Studio 2', baseUrl: 'http://127.0.0.1:1/v1' }]
    });
    expect(status).toBe(200);
    expect(saved[0].providers[0]).toMatchObject({ name: 'LM Studio 2', apiKey: 'secret-lm' });
  });

  it('PUT provider with empty apiKey clears it', async () => {
    await request(server, 'PUT', '/api/settings', { providers: [{ ...lm, apiKey: '' }] });
    expect(saved[0].providers[0].apiKey).toBeUndefined();
  });

  it('PUT drafting change returns probe result', async () => {
    const { json } = await request(server, 'PUT', '/api/settings', {
      assignments: { drafting: { providerId: 'lm', model: 'qwen' } }
    });
    expect(json.data.probe).toEqual({ ok: true, detail: 'Tool calling supported' });
    expect(json.data.assignments.drafting).toEqual({ providerId: 'lm', model: 'qwen' });
    expect(session.assignments.drafting.model).toBe('qwen');
  });

  it('PUT without a drafting change has no probe', async () => {
    const { json } = await request(server, 'PUT', '/api/settings', {
      assignments: { critic: { providerId: 'openrouter', model: 'b/m' } }
    });
    expect(json.data.probe).toBeUndefined();
  });

  it('PUT with empty model → 400 naming the role', async () => {
    const { status, json } = await request(server, 'PUT', '/api/settings', {
      assignments: { compaction: { providerId: 'openrouter', model: '  ' } }
    });
    expect(status).toBe(400);
    expect(json.error).toContain('role "compaction" has no model');
  });

  it('PUT provider with base URL lacking http(s) scheme → 400', async () => {
    const { status, json } = await request(server, 'PUT', '/api/settings', {
      providers: [{ id: 'lm', name: 'LM Studio', baseUrl: 'localhost:1234/v1' }]
    });
    expect(status).toBe(400);
    expect(json.error).toContain('must start with http:// or https://');
  });

  it('PUT provider with empty name → 400', async () => {
    const { status } = await request(server, 'PUT', '/api/settings', {
      providers: [{ id: 'lm', name: ' ', baseUrl: 'http://127.0.0.1:1/v1' }]
    });
    expect(status).toBe(400);
  });

  it('POST /api/settings behaves like PUT', async () => {
    const { status } = await request(server, 'POST', '/api/settings', { assignments: { critic: { providerId: 'ghost', model: 'x' } } });
    expect(status).toBe(400);
  });

  it('GET /api/providers/:id/models lists models', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) =>
      String(url).startsWith('http://127.0.0.1:1/')
        ? new Response(JSON.stringify({ data: [{ id: 'qwen' }] }), { status: 200 })
        : realFetch(url, init)
    ));
    const { status, json } = await request(server, 'GET', '/api/providers/lm/models');
    expect(status).toBe(200);
    expect(json.data.models).toEqual(['qwen']);
  });

  it('GET /api/providers/:id/models → 502 with URL when unreachable', async () => {
    const { status, json } = await request(server, 'GET', '/api/providers/lm/models');
    expect(status).toBe(502);
    expect(json.error).toContain('http://127.0.0.1:1/v1/models');
  });

  it('POST /api/providers/:id/probe returns ok/detail; unknown id → 404', async () => {
    const r1 = await request(server, 'POST', '/api/providers/lm/probe', { model: 'qwen' });
    expect(r1.json.data).toEqual({ ok: true, detail: 'Tool calling supported' });
    const r2 = await request(server, 'POST', '/api/providers/nope/probe', { model: 'qwen' });
    expect(r2.status).toBe(404);
  });

  it('runTurn routes the classifier to its assigned client', async () => {
    await session.applySettings({ assignments: { classifier: { providerId: 'lm', model: 'cls' } } });
    clients.lm.chatCompletion.mockImplementation(async () => ({ content: '{"specialistId":"general"}', raw: {} }));
    clients.openrouter.chatCompletion.mockImplementation(async () => ({ content: 'hello', raw: {} }));
    await session.runTurn('How is it going?', () => {});
    expect(clients.lm.chatCompletion.mock.calls.some((c: any[]) => c[0].model === 'cls')).toBe(true);
  });
});
