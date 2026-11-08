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

/** Text-extraction page budget: web_fetch feeds arbitrary remote PDFs in here. */
const TEXT_MAX_PAGES = 40;

/**
 * Character budget on accumulated text. This bounds the WORK, not just the output: a dense
 * PDF would otherwise build tens of MB of UTF-16 before any caller-side slice.
 */
export const MAX_TEXT_CHARS = 60000;

/** Page separator, kept identical to the historical join so callers see unchanged text. */
const PAGE_BREAK = '\n\n--- Page Break ---\n\n';

/** Returned when a PDF carries no text layer (scanned or image-only). Callers detect this exact string. */
export const NO_PDF_TEXT_MARKER =
  '(No extractable text found in this PDF. It may be a scanned document or image-based PDF.)';

/** Text-layer extraction result with the coverage facts the caller must report. */
export interface PdfTextMeta {
  /** Accumulated page text; `''` when no page carried text. Capped at {@link MAX_TEXT_CHARS}. */
  text: string;
  /** Pages the document declares. */
  numPages: number;
  /** Pages actually parsed (≤ {@link TEXT_MAX_PAGES}); 0 when the text cap stopped page 1. */
  pagesRead: number;
  /** `true` when {@link MAX_TEXT_CHARS} stopped accumulation early. */
  textTruncated: boolean;
}

/**
 * Extracts the text layer of an in-memory PDF (first {@link TEXT_MAX_PAGES} pages, at most
 * {@link MAX_TEXT_CHARS} characters).
 *
 * @param data Raw PDF bytes (a Uint8Array — pdfjs rejects a Node Buffer).
 * @returns Text plus the page-coverage facts; page text is joined by `--- Page Break ---`.
 * @throws Whatever pdfjs throws for a corrupt/encrypted document.
 */
export async function extractPdfTextWithMeta(data: Uint8Array): Promise<PdfTextMeta> {
  const lib = await getPdfJsLib();
  const doc = await lib.getDocument({ data }).promise;
  try {
    const pages: string[] = [];
    const pageCount = Math.min(doc.numPages, TEXT_MAX_PAGES);
    let length = 0;
    let pagesRead = 0;
    let textTruncated = false;

    for (let i = 1; i <= pageCount; i++) {
      // Stop before parsing page i once the budget is spent: the cap must bound the work.
      if (length >= MAX_TEXT_CHARS) {
        textTruncated = true;
        break;
      }
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item: any) => item.str).join(' ');
      pagesRead = i;
      const trimmed = text.trim();
      if (!trimmed) continue;
      pages.push(trimmed);
      length += trimmed.length + PAGE_BREAK.length;
    }

    return {
      text: pages.join(PAGE_BREAK),
      numPages: doc.numPages,
      pagesRead,
      textTruncated,
    };
  } finally {
    // Release the worker-held document (web_fetch parses remote bytes).
    try {
      await doc.destroy();
    } catch {
      // Best effort: a failed teardown must not mask the extraction result.
    }
  }
}

/**
 * Extracts the text layer of an in-memory PDF and announces any missing pages at the tail.
 * Thin wrapper over {@link extractPdfTextWithMeta}; `fs_read` and project-files rely on this
 * exact string contract.
 *
 * @param data Raw PDF bytes.
 * @returns Page text joined by `--- Page Break ---`, followed by a truncation notice when
 *   pages were not read; `NO_PDF_TEXT_MARKER` when no page has text.
 * @throws Whatever pdfjs throws for a corrupt/encrypted document.
 */
export async function extractTextFromPdfBuffer(data: Uint8Array): Promise<string> {
  const { text, numPages, pagesRead } = await extractPdfTextWithMeta(data);
  if (!text) return NO_PDF_TEXT_MARKER;
  // A silent cut would read as a complete document; announce the missing pages.
  if (numPages > pagesRead) {
    return `${text}\n\n[Truncated: first ${pagesRead} of ${numPages} pages — use read_chart_data or split the PDF]`;
  }
  return text;
}

/**
 * Reads a PDF from disk and delegates to {@link extractTextFromPdfBuffer}.
 *
 * @param filePath Absolute or project-relative path to a PDF file.
 * @returns Same contract as {@link extractTextFromPdfBuffer}.
 * @throws When the file cannot be read or pdfjs rejects the document.
 */
export async function extractTextFromPdf(filePath: string): Promise<string> {
  return extractTextFromPdfBuffer(new Uint8Array(fs.readFileSync(filePath)));
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
