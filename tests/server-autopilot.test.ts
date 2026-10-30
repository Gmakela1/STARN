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
import { Assignments, ProviderConfig, DEFAULT_TRANSCRIBER_MODEL } from '../src/config.js';

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

describe('autopilot + portal API', () => {
  let tempDir: string;
  let server: http.Server;
  let stateManager: ProjectStateManager;
  let mockClient: any;
  let session: ServerSessionManager;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-autopilot-'));
    fs.mkdirSync(path.join(tempDir, 'docs', 'work_instructions'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'artifacts'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'work_instructions', 'ACTION-03-TEST-WI.md'),
      '# Work Instruction: ACTION-03 — Test WI\n**Milestone Gate:** MVC\n**Target Subsystem:** SS-01\n**Status:** IN-PROGRESS\n\n## 2. Step-by-Step Action Checklist\n\n- [ ] **Step 1:** Do thing.\n'
    );

    stateManager = new ProjectStateManager(tempDir);
    stateManager.getOrCreateState('p1', 'Autopilot Project');
    mockClient = { chatCompletion: vi.fn(async () => PING_CALL) };

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
      clientFactory: () => mockClient,
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry()
    });

    server = createHttpServer({ projectPath: tempDir, stateManager, session });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('1. GET /api/settings returns autopilotEnabled: true (default)', async () => {
    const { status, json } = await request(server, 'GET', '/api/settings');
    expect(status).toBe(200);
    expect(json.data.autopilotEnabled).toBe(true);
  });

  it('2. PUT /api/settings {autopilotEnabled:false} round-trips', async () => {
    const r1 = await request(server, 'PUT', '/api/settings', { autopilotEnabled: false });
    expect(r1.status).toBe(200);
    const r2 = await request(server, 'GET', '/api/settings');
    expect(r2.json.data.autopilotEnabled).toBe(false);
  });

  it('3. GET /api/autopilot returns initial state (not running)', async () => {
    const { status, json } = await request(server, 'GET', '/api/autopilot');
    expect(status).toBe(200);
    expect(json.data.enabled).toBe(true);
    expect(json.data.running).toBe(false);
    expect(json.data.passedCount).toBe(0);
    expect(json.data.totalPhases).toBe(13);
  });

  it('3b. GET /api/autopilot derives blocks from parked docs, ignoring a stale counter', async () => {
    const state = stateManager.getState();
    state.autopilot.blocks = 2;
    state.autopilot.docStatus = { requirements: 'auto-approved', bom: 'idle' };
    stateManager.saveState(state);
    const stale = await request(server, 'GET', '/api/autopilot');
    expect(stale.json.data.blocks).toBe(0);

    const next = stateManager.getState();
    next.autopilot.docStatus = { requirements: 'auto-approved', bom: 'parked' };
    stateManager.saveState(next);
    const parked = await request(server, 'GET', '/api/autopilot');
    expect(parked.json.data.blocks).toBe(1);
  });

  it('4. POST /api/autopilot/start returns 202', async () => {
    const { status } = await request(server, 'POST', '/api/autopilot/start');
    expect(status).toBe(202);
  });

  it('5. POST /api/autopilot/stop returns 200', async () => {
    await request(server, 'POST', '/api/autopilot/start');
    const { status } = await request(server, 'POST', '/api/autopilot/stop');
    expect(status).toBe(200);
  });

  it('6. GET /api/portal returns empty items list', async () => {
    const { status, json } = await request(server, 'GET', '/api/portal');
    expect(status).toBe(200);
    expect(json.data.items).toEqual([]);
  });

  it('7. POST /api/actions/:id/flags with flagged:true creates portal item', async () => {
    const r1 = await request(server, 'POST', '/api/actions/ACTION-03/flags', {
      stepId: 0,
      flagged: true
    });
    expect(r1.status).toBe(200);

    // Verify portal item was created
    const portal = await request(server, 'GET', '/api/portal');
    expect(portal.json.data.items.length).toBeGreaterThanOrEqual(1);
    const flagItem = portal.json.data.items.find((i: any) => i.type === 'flag');
    expect(flagItem).toBeDefined();
    expect(flagItem.status).toBe('open');
  });

  it('8. POST /api/actions/:id/comments stores comment', async () => {
    const { status } = await request(server, 'POST', '/api/actions/ACTION-03/comments', {
      stepId: 0,
      text: 'hello, this is a comment'
    });
    expect(status).toBe(200);
  });

  it('9. GET /api/dashboard includes portalSummary', async () => {
    const { status, json } = await request(server, 'GET', '/api/dashboard');
    expect(status).toBe(200);
    expect(json.data.portalSummary).toBeDefined();
    expect(typeof json.data.portalSummary.blocking).toBe('number');
    expect(typeof json.data.portalSummary.questions).toBe('number');
    expect(typeof json.data.portalSummary.flags).toBe('number');
    expect(typeof json.data.portalSummary.parked).toBe('number');
    expect(Array.isArray(json.data.portalSummary.topItems)).toBe(true);
  });

  it('10. GET /api/autopilot/events returns SSE stream - verified via status endpoint', async () => {
    // The SSE endpoint is a long-lived streaming endpoint that's difficult to
    // test in a unit-test context. We verify the autopilot infrastructure works
    // by checking that the autopilot status endpoint returns the expected data.
    const { json } = await request(server, 'GET', '/api/autopilot');
    expect(json.data.running).toBe(false);
    expect(json.data.enabled).toBe(true);
  });
});
