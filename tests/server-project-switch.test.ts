import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHttpServer } from '../src/server/server.js';
import { ProjectRegistry } from '../src/workspace/registry.js';
import { ProjectContext } from '../src/workspace/project-context.js';
import { ServerSessionManager } from '../src/server/session.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';

async function request(server: http.Server, method: string, urlPath: string, body?: unknown) {
  const addr = server.address() as any;
  const port = addr.port;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  return { status: res.status, json };
}

describe('Server project switching API', () => {
  let server: http.Server;
  let tmpA: string;
  let tmpB: string;
  let regFile: string;
  let context: ProjectContext;
  let session: ServerSessionManager;

  beforeEach(async () => {
    tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-a-'));
    tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-b-'));
    regFile = path.join(tmpA, 'registry.json');
    const registry = new ProjectRegistry(regFile);
    const recA = registry.registerProject('Project A', tmpA);
    registry.registerProject('Project B', tmpB);
    context = new ProjectContext(registry, recA);

    session = new ServerSessionManager({
      projectPath: tmpA,
      stateManager: context.stateManager,
      apiKey: 'test-key',
      providers: [],
      assignments: {
        drafting: { providerId: 'openrouter', model: 'm' },
        critic: { providerId: 'openrouter', model: 'm' },
        classifier: { providerId: 'openrouter', model: 'm' },
        compaction: { providerId: 'openrouter', model: 'm' }
      },
      clientFactory: () => ({} as any),
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry()
    });

    server = createHttpServer({
      projectPath: tmpA,
      stateManager: context.stateManager,
      context,
      session
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  });

  afterEach(async () => {
    await new Promise(r => server.close(r));
    fs.rmSync(tmpA, { recursive: true, force: true });
    fs.rmSync(tmpB, { recursive: true, force: true });
  });

  it('GET /api/projects returns known projects and activeId', async () => {
    const { status, json } = await request(server, 'GET', '/api/projects');
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.projects.map((p: any) => p.name)).toContain('Project A');
    expect(json.data.projects.map((p: any) => p.name)).toContain('Project B');
    expect(json.data.activeId).toBe(context.record.id);
  });

  it('GET /api/fs/folders lists subdirectories for a path', async () => {
    fs.mkdirSync(path.join(tmpA, 'subfolder'));
    const { status, json } = await request(
      server,
      'GET',
      `/api/fs/folders?path=${encodeURIComponent(tmpA)}`
    );
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.folders.some((f: any) => f.name === 'subfolder')).toBe(true);
  });

  it('POST /api/projects/switch switches active project by projectId', async () => {
    const registry = new ProjectRegistry(regFile);
    const recB = registry.listProjects().find(p => p.name === 'Project B')!;

    const { status, json } = await request(server, 'POST', '/api/projects/switch', {
      projectId: recB.id
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('Project B');
    expect(context.record.id).toBe(recB.id);

    // Verify GET /api/project now returns Project B
    const projRes = await request(server, 'GET', '/api/project');
    expect(projRes.json.data.name).toBe('Project B');
  });

  it('POST /api/projects/switch switches active project by folder path', async () => {
    const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-c-'));
    try {
      const { status, json } = await request(server, 'POST', '/api/projects/switch', {
        path: tmpC
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(context.path).toBe(path.resolve(tmpC));
    } finally {
      fs.rmSync(tmpC, { recursive: true, force: true });
    }
  });

  it('POST /api/projects/switch returns 409 when session is busy', async () => {
    (session as any).activeAbort = new AbortController(); // simulate busy turn
    const { status, json } = await request(server, 'POST', '/api/projects/switch', {
      path: tmpB
    });
    expect(status).toBe(409);
    expect(json.error).toContain('Cannot switch projects');
    (session as any).activeAbort = null;
  });

  it('POST /api/projects/switch returns 400 on non-existent folder', async () => {
    const { status, json } = await request(server, 'POST', '/api/projects/switch', {
      path: path.join(tmpA, 'non-existent-directory-xyz')
    });
    expect(status).toBe(400);
    expect(json.error).toBeDefined();
  });
});
