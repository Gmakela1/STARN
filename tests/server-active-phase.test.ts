import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHttpServer } from '../src/server/server.js';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('POST /api/workflow/active-phase', () => {
  let server: http.Server;
  let tmpDir: string;
  let stateManager: ProjectStateManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-phase-'));
    stateManager = new ProjectStateManager(tmpDir);
    stateManager.getOrCreateState('p1', 'Active Phase Test');
    server = createHttpServer({ projectPath: tmpDir, stateManager });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  });

  afterEach(async () => {
    await new Promise(r => server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates the active workflow phase in project state', async () => {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/workflow/active-phase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseId: 'bom' })
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.activePhase).toBe('bom');
    expect(stateManager.getState().workflow?.activePhase).toBe('bom');
  });

  it('rejects unknown phase with 400', async () => {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/workflow/active-phase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseId: 'unknown_phase' })
    });
    expect(res.status).toBe(400);
  });
});
