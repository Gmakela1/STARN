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

const BOM_MD = `# Bill of Materials

| Item # | Part / Description | Subsystem | Qty | Source / URL | Order & Tracking # | Status | Est. Unit | Est. Total | Actual Total | Variance |
| :---: | :--- | :---: | :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **SS01-01** | Motenergy ME1115 BLDC Motor | SS-01 | 1 | [link](https://x.com) | #ORD-9821 | Received | $895.00 | $895.00 | $920.00 | +$25.00 |
| **SS07-03** | Hydraulic Fitting | SS-07 | 4 | [link](https://y.com) | — | Identified | $8.50 | $34.00 | — | — |
`;

const WI_MD = `# Work Instruction: ACTION-03 — Mount Electric Motor
**Milestone Gate:** MVC  
**Target Subsystem:** SS-01  
**Status:** IN-PROGRESS

## 2. Step-by-Step Action Checklist

- [x] **Step 1:** Clean mating face.
- [ ] **Step 2:** Torque bolts to 45 ft-lbs.

## 4. Hardware Non-Conformance / Bug Log

- **Flag Status:** OPEN_NON_CONFORMANCE
- **Defect Description:** Bolt holes offset 3.5mm.
- **Defect Evidence / Media:** artifacts/ACTION-03-WI-1-DEFECT.jpg
- **AI Recommendation / Resolution:** None
`;

async function request(
  server: http.Server,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<{ status: number; json: any; raw: string }> {
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

describe('HTTP Server API', () => {
  let tempDir: string;
  let server: http.Server;
  let stateManager: ProjectStateManager;
  let mockClient: OpenRouterClient;
  let session: ServerSessionManager;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-server-'));
    fs.mkdirSync(path.join(tempDir, 'docs', 'work_instructions'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'docs', 'BOM.md'), BOM_MD);
    fs.writeFileSync(
      path.join(tempDir, 'docs', 'work_instructions', 'ACTION-03-MOUNT-MOTOR-WORK-INSTRUCTION.md'),
      WI_MD
    );

    stateManager = new ProjectStateManager(tempDir);
    stateManager.getOrCreateState('p1', 'Tractor Conversion');
    mockClient = new OpenRouterClient({ apiKey: 'mock' });

    session = new ServerSessionManager({
      projectPath: tempDir,
      stateManager,
      client: mockClient,
      model: 'test-model',
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

  it('GET /api/project returns metadata with financial rollup', async () => {
    const { status, json } = await request(server, 'GET', '/api/project');
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('Tractor Conversion');
    expect(json.data.activePhase).toBeDefined();
    expect(json.data.financials.totalEstimated).toBe(929);
    expect(json.data.financials.totalActual).toBe(920);
  });

  it('GET /api/roadmap returns all 13 canonical phases', async () => {
    const { status, json } = await request(server, 'GET', '/api/roadmap');
    expect(status).toBe(200);
    expect(json.data).toHaveLength(13);
    expect(json.data[0].id).toBe('conops');
    expect(json.data[12].id).toBe('sow');
    expect(json.data[5].id).toBe('bom');
  });

  it('GET /api/bom returns parsed ledger items', async () => {
    const { json } = await request(server, 'GET', '/api/bom');
    expect(json.data.items).toHaveLength(2);
    expect(json.data.items[0].id).toBe('SS01-01');
  });

  it('PATCH /api/bom/items/:id updates docs/BOM.md on disk', async () => {
    const { status, json } = await request(server, 'PATCH', '/api/bom/items/SS07-03', {
      status: 'Ordered',
      tracking: '#H-9000'
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);

    const onDisk = fs.readFileSync(path.join(tempDir, 'docs', 'BOM.md'), 'utf-8');
    expect(onDisk).toContain('#H-9000');
    expect(onDisk).toContain('Ordered');
  });

  it('GET /api/actions lists parsed work instructions', async () => {
    const { json } = await request(server, 'GET', '/api/actions');
    expect(json.data).toHaveLength(1);
    expect(json.data[0].actionId).toBe('ACTION-03');
    expect(json.data[0].steps).toHaveLength(2);
  });

  it('PATCH /api/actions/:id/checklist toggles a step checkbox on disk', async () => {
    const { status, json } = await request(server, 'PATCH', '/api/actions/ACTION-03/checklist', {
      stepIndex: 1,
      checked: true
    });
    expect(status).toBe(200);
    expect(json.data.steps[1].checked).toBe(true);

    const onDisk = fs.readFileSync(
      path.join(tempDir, 'docs', 'work_instructions', 'ACTION-03-MOUNT-MOTOR-WORK-INSTRUCTION.md'),
      'utf-8'
    );
    expect(onDisk).toContain('- [x] **Step 2:**');
  });

  it('GET /api/issues aggregates non-conformances', async () => {
    const { json } = await request(server, 'GET', '/api/issues');
    expect(json.data.nonConformanceCount).toBe(1);
    const defect = json.data.issues.find((i: any) => i.type === 'non_conformance');
    expect(defect.description).toContain('3.5mm');
  });

  it('POST /api/issues/:id/push-to-agent returns a prepared agent prompt', async () => {
    const { json } = await request(server, 'POST', '/api/issues/nc-action-03/push-to-agent');
    expect(json.success).toBe(true);
    expect(json.data.prompt).toContain('ACTION-03');
    expect(json.data.prompt).toContain('3.5mm');
  });

  it('GET /api/docs/:phaseId returns document content; PUT updates it', async () => {
    const getRes = await request(server, 'GET', '/api/docs/bom');
    expect(getRes.json.data.content).toContain('Motenergy');

    const putRes = await request(server, 'PUT', '/api/docs/bom', {
      content: '# Bill of Materials\n\nRewritten.\n'
    });
    expect(putRes.status).toBe(200);
    const onDisk = fs.readFileSync(path.join(tempDir, 'docs', 'BOM.md'), 'utf-8');
    expect(onDisk).toContain('Rewritten.');
  });

  it('POST /api/turns streams SSE events for a conversational turn', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (opts: any) => {
      const sys = String(opts.messages[0]?.content ?? '');
      if (sys.includes('classif') || sys.includes('Classif') || sys.includes('router')) {
        return { content: JSON.stringify({ specialistId: 'general', reason: 'chat' }), raw: {} };
      }
      return { content: 'Hello builder — project looks on track.', raw: {} };
    });

    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'How is the project going?' })
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const raw = await res.text();
    expect(raw).toContain('event: complete');
    expect(raw).toContain('Hello builder');
  });

  it('GET /api/checkpoints/pending returns null when no checkpoint is pending', async () => {
    const { json } = await request(server, 'GET', '/api/checkpoints/pending');
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
  });

  it('POST /api/artifacts/upload saves base64 file into artifacts/', async () => {
    const content = Buffer.from('fake-jpg-bytes').toString('base64');
    const { status, json } = await request(server, 'POST', '/api/artifacts/upload', {
      filename: 'ACTION-03-MOUNT-MOTOR-WI-1-TORQUE.jpg',
      contentBase64: content
    });
    expect(status).toBe(200);
    expect(json.data.path).toContain('artifacts/');

    const saved = path.join(tempDir, 'artifacts', 'ACTION-03-MOUNT-MOTOR-WI-1-TORQUE.jpg');
    expect(fs.existsSync(saved)).toBe(true);
    expect(fs.readFileSync(saved, 'utf-8')).toBe('fake-jpg-bytes');
  });

  it('rejects path traversal in artifact filenames', async () => {
    const { status } = await request(server, 'POST', '/api/artifacts/upload', {
      filename: '../../evil.sh',
      contentBase64: Buffer.from('x').toString('base64')
    });
    expect(status).toBe(400);
  });

  it('GET unknown /api route returns 404 envelope', async () => {
    const { status, json } = await request(server, 'GET', '/api/nope');
    expect(status).toBe(404);
    expect(json.success).toBe(false);
  });
});
