/**
 * pdf-extractor.ts — PDF text extraction plus the cheap chart probe.
 *
 * Purpose: `extractTextFromPdf` returns the text layer; `probeCharts` reports
 * which pages carry vector-plotted charts (spec §5) so `fs_read` can append a
 * self-announcing banner. Both import pdfjs lazily.
 */
import fs from 'node:fs';
import {
  calibrateAxes,
  classifyPaths,
  clusterSeries,
  collectDrawing,
  mapLegend,
  pathsBounds,
} from '../document-extractors/chart-vector-extractor.js';
import type { ChartProbe } from '../document-extractors/chart-types.js';

let pdfjsLib: any = null;

async function getPdfJsLib(): Promise<any> {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLib;
}

/** Probe budget: pages scanned and `constructPath` ops replayed per page (spec §5). */
const PROBE_MAX_PAGES = 5;
const PROBE_MAX_PATH_OPS = 2000;

export async function extractTextFromPdf(filePath: string): Promise<string> {
  const lib = await getPdfJsLib();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await lib.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(' ');
    if (text.trim()) {
      pages.push(text.trim());
    }
  }

  const result = pages.join('\n\n--- Page Break ---\n\n');
  return result || '(No extractable text found in this PDF. It may be a scanned document or image-based PDF.)';
}

/**
 * Spec §5 probe. Scans at most 5 pages and replays at most 2000 `constructPath`
 * ops per page, then reports data-path counts and legend candidates.
 *
 * @param filePath Absolute path to a PDF file.
 * @returns One entry per page that has ≥ 2 data paths, in page order.
 * @throws Never: any parse failure yields `[]` and the caller proceeds with text only.
 */
export async function probeCharts(filePath: string): Promise<ChartProbe[]> {
  try {
    const lib = await getPdfJsLib();
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await lib.getDocument({ data }).promise;
    const probes: ChartProbe[] = [];
    const pageCount = Math.min(doc.numPages, PROBE_MAX_PAGES);

    for (let i = 1; i <= pageCount; i++) {
      try {
        const page = await doc.getPage(i);
        const drawing = await collectDrawing(page, PROBE_MAX_PATH_OPS);
        const bounds = pathsBounds(drawing.paths);
        if (!bounds) continue;
        const classes = classifyPaths(drawing.paths, bounds);
        if (classes.data.length < 2) continue;
        const calibration = calibrateAxes(drawing.textItems, classes.frame, classes.data);
        const clusters = clusterSeries(classes.data, bounds);
        const mapped = mapLegend(drawing.paths, drawing.textItems, clusters, drawing.pageBox);
        const series = mapped
          .filter((cluster) => cluster.unnamed !== true && typeof cluster.name === 'string' && cluster.name.length > 0)
          .map((cluster) => cluster.name as string);
        probes.push({ page: i, dataPaths: classes.data.length, series, reliable: calibration.ok });
      } catch {
        continue;
      }
    }
    return probes;
  } catch {
    return [];
  }
}
