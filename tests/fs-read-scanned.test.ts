import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fsReadHandler } from '../src/tools/handlers/fs-read.js';
import { ChatClient } from '../src/openrouter/types.js';

const BLANK_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n');

describe('fs_read scanned-PDF auto-route', () => {
  it('returns vision transcription when transcriber present and PDF has no text layer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-scan-'));
    fs.writeFileSync(path.join(dir, 'dummy.pdf'), BLANK_PDF);
    const client: ChatClient = { async chatCompletion() { return { content: 'OCR-ish page text', raw: {} }; } };
    const res = await fsReadHandler.execute(
      { path: 'dummy.pdf' },
      { projectPath: dir, stateManager: {} as any, transcriber: { client, model: 'stub' } }
    );
    expect(res.success).toBe(true);
    expect(res.result).toMatch(/vision model/i);
    expect(res.result).toContain('OCR-ish page text');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the empty sentinel when transcriber absent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-scan-'));
    fs.writeFileSync(path.join(dir, 'dummy.pdf'), BLANK_PDF);
    const res = await fsReadHandler.execute(
      { path: 'dummy.pdf' },
      { projectPath: dir, stateManager: {} as any }
    );
    expect(res.success).toBe(true);
    expect(res.result).toContain('No extractable text');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});