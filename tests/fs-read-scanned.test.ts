import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fsReadHandler } from '../src/tools/handlers/fs-read.js';
import { ChatClient } from '../src/openrouter/types.js';

// Chart probe is stubbed only for the fixture used by the banner-wording case;
// every other file falls through to the real pdfjs probe.
vi.mock('../src/tools/handlers/pdf-extractor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/tools/handlers/pdf-extractor.js')>();
  return {
    ...actual,
    probeCharts: async (filePath: string) =>
      path.basename(filePath) === 'chart.pdf'
        ? [{ page: 2, dataPaths: 240, series: ['Torque', 'Efficiency'], reliable: true }]
        : actual.probeCharts(filePath)
  };
});

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

// One-page PDF with a text layer and a vector-plotted chart (probe stubbed above).
const TEXT_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj 4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj 5 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (ME1115 Performance) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \n0000000349 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n491\n%%EOF');

describe('fs_read chart banner wording', () => {
  it('offers read_chart_data conditionally and never calls the document image-only', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-chart-'));
    fs.writeFileSync(path.join(dir, 'chart.pdf'), TEXT_PDF);
    const res = await fsReadHandler.execute(
      { path: 'chart.pdf' },
      { projectPath: dir, stateManager: {} as any }
    );
    expect(res.success).toBe(true);
    expect(res.result).toContain('[Charts detected: page 2');
    expect(res.result).toContain('If read_chart_data is available');
    expect(res.result).not.toMatch(/image[- ]only/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});