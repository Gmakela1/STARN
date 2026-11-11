import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chartReadHandler, renderChartMarkdown } from '../src/tools/handlers/chart-read.js';
import type { AxisCalibration, AxisMap, ChartExtraction, ChartSeries } from '../src/tools/document-extractors/chart-types.js';

const BLANK_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n');

/**
 * @param stream Content stream body (PDF operators, one per line).
 * @returns A complete one-page PDF wrapping `stream`.
 */
function makePdf(stream: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Two coloured polylines: enough vector data for the extractor to cluster two series. */
const CHART_PDF = makePdf(
  [
    '1 0 0 RG', '2 w', '100 100 m', '150 200 l', '250 300 l', '350 350 l', '450 400 l', 'S',
    '0 0 1 RG', '2 w', '100 120 m', '150 190 l', '250 280 l', '350 340 l', '450 380 l', 'S',
  ].join('\n'),
);

const X_MAP: AxisMap = {
  axis: 'x', a: 1 / 500, b: 0, log: false, coordMin: 0, coordMax: 500, valueMin: 0, valueMax: 5000, anchors: 2,
};
const Y_MAP: AxisMap = {
  axis: 'y', side: 'left', a: 1 / 400, b: 0, log: false, coordMin: 0, coordMax: 400, valueMin: 0, valueMax: 9000, anchors: 2,
};
const CALIBRATION: AxisCalibration = { ok: true, declared: true, xAxis: X_MAP, yAxes: [Y_MAP] };

function samples(count: number): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => ({ x: i * 10, y: 100 + i }));
}

function seriesEntry(name: string, stroke: string, count = 40, pathIds = [12, 18]): ChartSeries {
  return { name, axis: 'left', samples: samples(count), style: { stroke, dash: [], lineWidth: 1 }, pathIds };
}

function fakeExtraction(overrides: Partial<ChartExtraction> = {}): ChartExtraction {
  return {
    file: 'chart.pdf',
    page: 1,
    calibration: CALIBRATION,
    series: [seriesEntry('Watts Out', '#ff0000'), seriesEntry('Eff.', '#006500')],
    refusals: [],
    notes: [],
    ...overrides,
  };
}

/** @returns Data rows of the sample table (rows between the `| x |` header and the next blank line). */
function sampleRows(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith('| x |'));
  if (start < 0) return [];
  const rows: string[] = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i]);
  return rows;
}

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'starn-chart-read-'));
}

/** Capturing log sink: keeps every line plus the level it was written at. */
function fakeLogger(): { lines: string[]; info(message: string): void; warn(message: string): void } {
  const lines: string[] = [];
  return {
    lines,
    info: (message: string) => lines.push(`INFO ${message}`),
    warn: (message: string) => lines.push(`WARN ${message}`),
  };
}

describe('read_chart_data handler', () => {
  it('refuses path traversal outside the project root', async () => {
    const dir = tempProject();
    const res = await chartReadHandler.execute({ path: '../escape.pdf' }, { projectPath: dir, stateManager: {} as any });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/traversal/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a missing, empty or non-string path as an error and never throws', async () => {
    const dir = tempProject();
    const bad: unknown[] = [undefined, null, '', '   ', 42, { path: 'x.pdf' }];
    for (const path of bad) {
      const res = await chartReadHandler.execute({ path } as any, { projectPath: dir, stateManager: {} as any });
      expect(res.success).toBe(false);
      expect(res.error).toBe('read_chart_data requires a path to a PDF within the project');
    }
    // No argument object at all is the same answer, not a TypeError.
    const res = await chartReadHandler.execute(undefined as any, { projectPath: dir, stateManager: {} as any });
    expect(res.success).toBe(false);
    expect(res.error).toBe('read_chart_data requires a path to a PDF within the project');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a missing file', async () => {
    const dir = tempProject();
    const res = await chartReadHandler.execute({ path: 'missing.pdf' }, { projectPath: dir, stateManager: {} as any });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the raster notice, not an empty table, for a page with no vector paths', async () => {
    const dir = tempProject();
    fs.writeFileSync(path.join(dir, 'scan.pdf'), BLANK_PDF);
    const res = await chartReadHandler.execute({ path: 'scan.pdf' }, { projectPath: dir, stateManager: {} as any });
    expect(res.success).toBe(true);
    expect(res.result).toMatch(/raster/i);
    expect(res.result).toMatch(/vision transcription applies/i);
    expect(res.result).not.toContain('| # | Series |');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('read_chart_data logging', () => {
  it('logs one line per read: result=refused when it refuses, result=accepted when it calibrates', async () => {
    const dir = tempProject();
    fs.writeFileSync(path.join(dir, 'scan.pdf'), BLANK_PDF);
    fs.writeFileSync(path.join(dir, 'chart.pdf'), CHART_PDF);
    const logger = fakeLogger();

    await chartReadHandler.execute(
      { path: 'scan.pdf' },
      { projectPath: dir, stateManager: {} as any, logger },
    );
    const accepted = await chartReadHandler.execute(
      { path: 'chart.pdf', axes: { x: { min: 0, max: 100 }, y: { min: 0, max: 10000 } } },
      { projectPath: dir, stateManager: {} as any, logger },
    );

    expect(accepted.success).toBe(true);
    expect(logger.lines).toHaveLength(2);
    expect(logger.lines[0]).toContain('result=refused');
    expect(logger.lines[0]).toContain('path=scan.pdf');
    expect(logger.lines[1]).toContain('result=accepted');
    expect(logger.lines[1]).toContain('path=chart.pdf');
    expect(logger.lines[1]).toContain('x=0–100 none');
    expect(logger.lines[1]).toContain('y=0–10000 none');
    expect(logger.lines[1]).toContain('series=series 1,series 2');
    expect(logger.lines[1]).toContain('reason=-');
    // One line per read, base name only, never the absolute path.
    for (const line of logger.lines) {
      expect(line).not.toContain('\n');
      expect(line).not.toContain(dir);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('renderChartMarkdown', () => {
  it('names every scale in an ambiguous multi-axis refusal', () => {
    const markdown = renderChartMarkdown(
      fakeExtraction({
        calibration: {
          ok: false,
          reason:
            'ambiguous y-axes: left labels (0–9000) and right labels (0–1.00) both have ≥2 anchors; a series→axis mapping is required',
        },
        series: [],
      }),
    );
    expect(markdown).toContain('0–9000');
    expect(markdown).toContain('0–1.00');
    expect(markdown).toMatch(/series→axis mapping is required/);
  });

  it('tabulates only the requested series column', () => {
    const markdown = renderChartMarkdown(fakeExtraction(), { series: ['Eff.'] });
    expect(markdown).toContain('| x | Eff. |');
    expect(markdown).not.toContain('| x | Watts Out');
    // The series listing still names both curves.
    expect(markdown).toContain('| 1 | Watts Out |');
    expect(markdown).toContain('| 2 | Eff. |');
    expect(sampleRows(markdown)).toHaveLength(40);
  });

  it('caps the sample table at maxSamples ≤ 200', () => {
    const markdown = renderChartMarkdown(fakeExtraction({ series: [seriesEntry('Watts Out', '#ff0000', 300)] }), {
      series: ['Watts Out'],
      maxSamples: 500,
    });
    expect(sampleRows(markdown)).toHaveLength(200);
  });

  it('caps the whole output at 12000 characters', () => {
    const many = Array.from({ length: 8 }, (_, i) => seriesEntry(`S${i + 1}`, '#123456', 200, [i + 1]));
    const markdown = renderChartMarkdown(fakeExtraction({ series: many }), {
      series: many.map((entry) => entry.name),
      maxSamples: 200,
    });
    expect(markdown.length).toBeLessThanOrEqual(12000);
    expect(markdown).toContain('output truncated at 12000 characters');
  });

  it('states provenance: file, page, path ids and anchors', () => {
    const markdown = renderChartMarkdown(fakeExtraction(), { series: ['Watts Out'] });
    expect(markdown).toMatch(/Curve-derived values, not a manufacturer's spec table/);
    expect(markdown).toContain('chart.pdf p.1');
    expect(markdown).toContain('path ids 12,18');
    expect(markdown).toContain('anchors x=(0,5000)');
    expect(markdown).toContain('anchors');
    expect(markdown).toContain('y=(0,9000)');
  });
});
