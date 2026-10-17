import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHttpServer } from '../src/server/server.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { ServerSessionManager } from '../src/server/session.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { OpenRouterClient } from '../src/openrouter/client.js';

function request(server: http.Server, method: string, urlPath: string, body?: any): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as any;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        path: urlPath,
        method,
        headers: { 'Content-Type': 'application/json' }
      },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, json: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 500, json: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Server Search Settings & Probe API', () => {
  let tempDir: string;
  let server: http.Server;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-search-test-'));
    fs.mkdirSync(path.join(tempDir, '.starn'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });

    const stateManager = new ProjectStateManager(tempDir);
    stateManager.getOrCreateState('p1', 'Test Project');

    const session = new ServerSessionManager({
      projectPath: tempDir,
      stateManager,
      apiKey: 'mock',
      providers: [],
      assignments: {
        drafting: { providerId: 'openrouter', model: 'test-model' },
        critic: { providerId: 'openrouter', model: 'test-model' },
        classifier: { providerId: 'openrouter', model: 'test-model' },
        compaction: { providerId: 'openrouter', model: 'test-model' }
      },
      clientFactory: () => new OpenRouterClient({ apiKey: 'mock' }),
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry()
    });

    server = createHttpServer({ projectPath: tempDir, stateManager, session });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('GET /api/settings/search returns current search configuration', async () => {
    const { status, json } = await request(server, 'GET', '/api/settings/search');
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.provider).toBeDefined();
    expect(typeof json.data.hasTavilyKey).toBe('boolean');
    expect(typeof json.data.hasBraveKey).toBe('boolean');
  });

  it('POST /api/settings/search updates search provider and masked keys', async () => {
    const { status, json } = await request(server, 'POST', '/api/settings/search', {
      provider: 'tavily',
      tavilyApiKey: 'tvly-secret-123'
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.provider).toBe('tavily');
    expect(json.data.hasTavilyKey).toBe(true);
  });

  it('POST /api/settings/search/probe tests search connectivity', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] })
    });
    vi.stubGlobal('fetch', mockFetch);

    const { status, json } = await request(server, 'POST', '/api/settings/search/probe', {
      provider: 'tavily',
      apiKey: 'tvly-test'
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.provider).toBe('tavily');
    expect(json.data.success).toBe(true);
  });
});
