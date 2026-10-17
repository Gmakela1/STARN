import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHttpServer } from '../src/server/server.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { ToolRegistry } from '../src/tools/registry.js';

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

describe('Server Library & Upload Endpoints', () => {
  let server: http.Server;
  let tmpDir: string;
  let stateManager: ProjectStateManager;
  let specialistRegistry: SpecialistRegistry;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-lib-'));
    stateManager = new ProjectStateManager(tmpDir);
    stateManager.getOrCreateState('p1', 'Library Test Project');
    specialistRegistry = new SpecialistRegistry();

    server = createHttpServer({
      projectPath: tmpDir,
      stateManager,
      specialistRegistry,
      toolRegistry: new ToolRegistry()
    } as any);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  });

  afterEach(async () => {
    await new Promise(r => server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('POST /api/examples/:specialistId uploads and saves example', async () => {
    const content = Buffer.from('# Good CONOPS Example').toString('base64');
    const { status, json } = await request(server, 'POST', '/api/examples/conops', {
      filename: 'sample.md',
      contentBase64: content
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.filename).toBe('sample.md');
    expect(json.data.path).toBe('examples/conops/sample.md');

    const saved = fs.readFileSync(path.join(tmpDir, 'examples/conops/sample.md'), 'utf-8');
    expect(saved).toBe('# Good CONOPS Example');
  });

  it('POST /api/examples/:specialistId returns 404 for unknown specialist', async () => {
    const content = Buffer.from('data').toString('base64');
    const { status, json } = await request(server, 'POST', '/api/examples/unknown_spec', {
      filename: 'sample.md',
      contentBase64: content
    });
    expect(status).toBe(404);
    expect(json.error).toContain('Specialist');
  });

  it('POST /api/examples/:specialistId returns 400 for forbidden extension', async () => {
    const content = Buffer.from('data').toString('base64');
    const { status, json } = await request(server, 'POST', '/api/examples/conops', {
      filename: 'sample.exe',
      contentBase64: content
    });
    expect(status).toBe(400);
    expect(json.error).toBeDefined();
  });

  it('POST /api/references saves reference document', async () => {
    const content = Buffer.from('pinout data').toString('base64');
    const { status, json } = await request(server, 'POST', '/api/references', {
      filename: 'pinout.txt',
      contentBase64: content
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.path).toBe('reference/pinout.txt');
  });

  it('GET /api/library and DELETE endpoints', async () => {
    const exContent = Buffer.from('# Ex').toString('base64');
    await request(server, 'POST', '/api/examples/bom', {
      filename: 'parts.md',
      contentBase64: exContent
    });

    const refContent = Buffer.from('ref').toString('base64');
    await request(server, 'POST', '/api/references', {
      filename: 'manual.txt',
      contentBase64: refContent
    });

    const { status, json } = await request(server, 'GET', '/api/library');
    expect(status).toBe(200);
    expect(json.data.references.some((r: any) => r.name === 'manual.txt')).toBe(true);
    expect(json.data.examples.bom.some((e: any) => e.name === 'parts.md')).toBe(true);

    // Delete reference
    const delRef = await request(server, 'DELETE', '/api/library/references/manual.txt');
    expect(delRef.status).toBe(200);

    // Delete example
    const delEx = await request(server, 'DELETE', '/api/library/examples/bom/parts.md');
    expect(delEx.status).toBe(200);

    const checkList = await request(server, 'GET', '/api/library');
    expect(checkList.json.data.references).toHaveLength(0);
    expect(checkList.json.data.examples.bom).toBeUndefined();
  });
});
