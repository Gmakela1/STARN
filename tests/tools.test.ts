import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { extractTextFromPdf } from '../src/tools/handlers/pdf-extractor.js';

describe('Tool Registry & Safe Handlers', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-tool-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('test-proj', 'Test Project');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('allows reading, writing, and listing files safely inside project path', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    // Write file
    const writeRes = await registry.execute(
      'fs_write',
      { path: 'docs/test.md', content: '# Physical Frame Specs' },
      context,
      ['fs_write', 'fs_read', 'fs_list']
    );
    expect(writeRes.success).toBe(true);

    // Read file
    const readRes = await registry.execute(
      'fs_read',
      { path: 'docs/test.md' },
      context,
      ['fs_write', 'fs_read', 'fs_list']
    );
    expect(readRes.result).toBe('# Physical Frame Specs');

    // List directory
    const listRes = await registry.execute(
      'fs_list',
      { dir: 'docs' },
      context,
      ['fs_list']
    );
    expect(listRes.result).toContain('test.md');
  });

  it('rejects execution when a tool is not in the allowed tool list', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    const result = await registry.execute(
      'fs_write',
      { path: 'danger.txt', content: 'not allowed' },
      context,
      ['fs_read'] // Only fs_read allowed
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool fs_write is not permitted');
  });

  it('prevents directory traversal outside project root', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    const result = await registry.execute(
      'fs_read',
      { path: '../../outside.txt' },
      context,
      ['fs_read']
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal');
  });

  it('handles state reading and state updating via tools', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    const updateRes = await registry.execute(
      'state_update',
      { phase: 'CONOPS Drafting', addRisk: 'Wind load on roof panels', action: 'Initialized CONOPS' },
      context,
      ['state_update']
    );
    expect(updateRes.success).toBe(true);

    const readRes = await registry.execute(
      'state_read',
      {},
      context,
      ['state_read']
    );
    expect(readRes.success).toBe(true);
    const parsedState = JSON.parse(readRes.result!);
    expect(parsedState.currentPhase).toBe('CONOPS Drafting');
    expect(parsedState.openRisks).toContain('Wind load on roof panels');
  });

  it('extracts text from a PDF file via fs_read', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    // Create a minimal valid PDF
    const pdfContent = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj 4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj 5 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (STARN PDF Test - Motor Specs: 72V, 12kW peak) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \n0000000349 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n491\n%%EOF';

    const pdfPath = path.join(tempDir, 'reference', 'motor-specs.pdf');
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    fs.writeFileSync(pdfPath, pdfContent, 'binary');

    const result = await registry.execute(
      'fs_read',
      { path: 'reference/motor-specs.pdf' },
      context,
      ['fs_read']
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('STARN PDF Test');
    expect(result.result).toContain('72V');
    expect(result.result).toContain('12kW');
  });

  it('extracts text from PDF via extractTextFromPdf utility', async () => {
    const pdfContent = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj 4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj 5 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (BLDC Controller: 24V-72V, 250A peak) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \n0000000349 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n491\n%%EOF';

    const pdfPath = path.join(tempDir, 'test-bldc.pdf');
    fs.writeFileSync(pdfPath, pdfContent, 'binary');

    const text = await extractTextFromPdf(pdfPath);
    expect(text).toContain('BLDC Controller');
    expect(text).toContain('250A peak');
  });
});