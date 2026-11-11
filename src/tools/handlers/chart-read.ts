/**
 * chart-read.ts — `read_chart_data` tool handler (spec §7 output, §8 surface).
 *
 * Purpose: read numeric samples from vector-plotted PDF curves with provenance.
 * Rendering is a pure function so tests never need a crafted PDF.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import { extractChartData } from '../document-extractors/chart-vector-extractor.js';
import type { AxisDecl, AxisMap, ChartExtraction, ChartSeries } from '../document-extractors/chart-types.js';
import { UNVERIFIED_CONFIDENCE_CAP } from '../../core/research-gate.js';
import { toBand } from '../../core/research-delegation.js';
import type { ResearchBand } from '../../core/research-delegation.js';

/** Hard caps from spec §7. */
const MAX_OUTPUT_CHARS = 12000;
const MAX_SERIES_PER_CALL = 8;
const MAX_SAMPLES_CAP = 200;

/**
 * Confidence floor for a curve read from a PDF under `reference/` — the user
 * curated that file into the project as a manufacturer document, so the
 * drawing is a primary source for its own values.
 */
export const PROJECT_REFERENCE_CONFIDENCE_FLOOR = 0.75;
/** Confidence floor for a curve read from any other project PDF. */
export const PROJECT_DOCUMENT_CONFIDENCE_FLOOR = 0.6;

/** Arguments accepted by the `read_chart_data` tool. */
export interface ChartReadArgs {
  path: string;
  page?: number;
  series?: string[];
  axes?: { x: AxisDecl; y: AxisDecl };
  seriesAxes?: Record<string, 'left' | 'right'>;
  maxSamples?: number;
}

/** Arguments as they actually arrive: `path` may be missing or of the wrong type. */
type ChartReadInput = { [K in keyof ChartReadArgs]?: unknown };

/** Rendering options for {@link renderChartMarkdown}. */
export interface RenderChartOptions {
  /** Series names to tabulate; omitted means list only, no sample table. */
  series?: string[];
  /** Row cap for the sample table, clamped to 1..200. */
  maxSamples?: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)));
}

/**
 * Source grade for one chart read, from where the file lives in the project.
 * `confidence` is a floor, and never above UNVERIFIED_CONFIDENCE_CAP: a curve
 * read on its own can never auto-apply.
 */
export interface ChartEvidenceGrade {
  /** Provenance label shown to the specialist. */
  provenance: 'project-reference' | 'project-document';
  /** Confidence floor for this source class, capped at UNVERIFIED_CONFIDENCE_CAP. */
  confidence: number;
  /** Band of `confidence` via the shared toBand mapping. */
  band: ResearchBand;
}

/**
 * Grades a chart read by the SOURCE the file comes from, not by how sure the
 * extractor is: a `reference/` PDF was placed in the project by the user as a
 * manufacturer document (floor PROJECT_REFERENCE_CONFIDENCE_FLOOR), any other
 * project PDF is a project document (floor PROJECT_DOCUMENT_CONFIDENCE_FLOOR).
 * Both are clamped to UNVERIFIED_CONFIDENCE_CAP, so a chart read stays in the
 * propose tier and can never auto-apply.
 *
 * Pure: no I/O.
 *
 * @param filePath - the PDF path, project-relative or absolute; separators and
 *   a leading `./` are ignored, and the `reference/` test is case-insensitive
 *   (win32 project trees)
 * @returns the provenance label, the capped confidence floor and its band
 */
export function gradeChartEvidence(filePath: string): ChartEvidenceGrade {
  const normalized = String(filePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .toLowerCase();
  const inReference = normalized === 'reference' || normalized.startsWith('reference/');
  const floor = inReference ? PROJECT_REFERENCE_CONFIDENCE_FLOOR : PROJECT_DOCUMENT_CONFIDENCE_FLOOR;
  const confidence = Math.min(floor, UNVERIFIED_CONFIDENCE_CAP);
  return {
    provenance: inReference ? 'project-reference' : 'project-document',
    confidence,
    band: toBand(confidence),
  };
}

/** Refusal for a `path` argument that is absent, empty or not a string. */
export const CHART_PATH_REQUIRED = 'read_chart_data requires a path to a PDF within the project';

/** Result of {@link resolveChartPdf}: the absolute PDF path, or the refusal message. */
export type ChartPdfResolution = { ok: true; target: string } | { ok: false; error: string };

/**
 * Resolves a project-relative PDF path for a chart read: rejects a missing or
 * non-string path (a tool handler never throws), traps path traversal outside
 * the project root (same guard as fs_read: sibling-prefix check, made
 * case-insensitive on win32) and rejects a non-PDF target. Shared by
 * `read_chart_data` and the `request_research` chart fast path so both refuse
 * identically.
 *
 * @param projectPath - absolute project root
 * @param relPath - project-relative path from the tool arguments
 * @returns the absolute target, or the refusal message
 */
export function resolveChartPdf(projectPath: string, relPath: string): ChartPdfResolution {
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    return { ok: false, error: CHART_PATH_REQUIRED };
  }
  const safeBase = path.resolve(projectPath);
  const target = path.resolve(safeBase, relPath);
  const ci = process.platform === 'win32';
  const base = ci ? safeBase.toLowerCase() : safeBase;
  const resolved = ci ? target.toLowerCase() : target;
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return { ok: false, error: 'Path traversal is not permitted.' };
  }
  if (!fs.existsSync(target)) {
    return { ok: false, error: `File not found: ${relPath}` };
  }
  if (path.extname(target).toLowerCase() !== '.pdf') {
    return { ok: false, error: `Expected a PDF: ${relPath}` };
  }
  return { ok: true, target };
}

/** @returns The reliability cell for one series row. */
function reliability(series: ChartSeries, calibration: ChartExtraction['calibration']): string {
  if (series.unnamed) return 'style only (no legend match)';
  if (calibration.declared) return 'declared axes';
  if (series.samples.length === 0) return 'no samples';
  return 'exact colour match';
}

/** @returns The curve-derived disclosure blockquote (spec §7). */
function disclosure(extraction: ChartExtraction, series: ChartSeries[]): string {
  const x = extraction.calibration.xAxis;
  const y = extraction.calibration.yAxes?.[0];
  const ids = [...new Set(series.flatMap((entry) => entry.pathIds))].sort((a, b) => a - b);
  const anchors = `anchors x=(${x ? `${x.valueMin},${x.valueMax}` : 'uncalibrated'}), y=(${
    y ? `${y.valueMin},${y.valueMax}` : 'uncalibrated'
  })`;
  const idsPart = ids.length > 0 ? `path ids ${ids.join(',')}; ` : '';
  return (
    '> Curve-derived values, not a manufacturer\'s spec table: ±1 % of axis span,\n' +
    '> curve→axis assignment can be wrong. ' +
    `Source: ${extraction.file} p.${extraction.page}, ${idsPart}${anchors}. ` +
    'Verify against the figure before use in a BOM or ICD.'
  );
}

/** Collapses whitespace so one log value can never break the single-line format. */
function flat(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * @param decl The caller's declared axis, when supplied.
 * @param map The axis actually used for sampling, when calibration succeeded.
 * @returns `min–max unit|none`, or `-` when neither exists.
 */
function axisSpan(decl: AxisDecl | undefined, map: AxisMap | undefined): string {
  if (decl) return `${decl.min}–${decl.max} ${flat(decl.unit ?? '') || 'none'}`;
  if (map) return `${map.valueMin}–${map.valueMax} ${flat(map.unit ?? '') || 'none'}`;
  return '-';
}

/**
 * Builds the one-line `chart_read` log record. Refusals are logged so a refused
 * axis declaration stays visible after the fact: whether the researcher retried
 * with corrected axes or gave up is traceable from the log alone.
 *
 * Never carries the absolute path (base name only) and never file contents.
 *
 * @param args Tool arguments; only `axes` is read (declared ranges win over fitted ones).
 * @param extraction Output of `extractChartData`.
 * @returns A single line with no embedded newlines.
 */
export function chartReadLogLine(args: ChartReadArgs, extraction: ChartExtraction): string {
  const refusals = [...extraction.refusals];
  const reason = extraction.calibration.reason;
  if (!extraction.calibration.ok && reason && !refusals.includes(reason)) refusals.push(reason);
  const series = extraction.series.map((entry) => entry.name).join(',') || '-';
  return [
    `chart_read path=${path.basename(extraction.file)}`,
    `page=${extraction.page}`,
    `x=${axisSpan(args.axes?.x, extraction.calibration.xAxis)}`,
    `y=${axisSpan(args.axes?.y, extraction.calibration.yAxes?.[0])}`,
    `result=${refusals.length > 0 ? 'refused' : 'accepted'}`,
    `series=${flat(series)}`,
    `reason=${refusals.length > 0 ? flat(refusals.join('; ')) : '-'}`
  ].join(' ');
}

/** @returns `markdown`, truncated at the 12000-character cap with an explicit note. */
function capOutput(markdown: string): string {
  if (markdown.length <= MAX_OUTPUT_CHARS) return markdown;
  const note = '\n\n(output truncated at 12000 characters)';
  return markdown.slice(0, MAX_OUTPUT_CHARS - note.length).trimEnd() + note;
}

/**
 * Renders one extraction as the spec §7 markdown block.
 *
 * Without `options.series` only the series table is returned. With it, a sample
 * table holds just the requested (case-insensitive) columns. Refusals are
 * printed as text with `success: true` upstream so the model can react.
 *
 * @param extraction Output of `extractChartData`.
 * @param options Requested series names and row cap.
 * @returns Markdown bounded to 12000 characters.
 */
export function renderChartMarkdown(extraction: ChartExtraction, options: RenderChartOptions = {}): string {
  const lines: string[] = [`**Charts — ${extraction.file}, page ${extraction.page}**`, ''];

  for (const refusal of extraction.refusals) lines.push(`Refusal: ${refusal}`, '');
  const calibrationReason = extraction.calibration.reason;
  if (!extraction.calibration.ok && calibrationReason && !extraction.refusals.includes(calibrationReason)) {
    lines.push(`Refusal: ${calibrationReason}`, '');
  }

  const series = extraction.series.slice(0, MAX_SERIES_PER_CALL);
  if (series.length === 0) return capOutput(lines.join('\n').trimEnd());

  const yMap = extraction.calibration.yAxes?.[0];
  const range = yMap ? `${yMap.valueMin}–${yMap.valueMax}${yMap.unit ? ` ${yMap.unit}` : ''}` : '';
  lines.push('| # | Series | Axis | Points | Reliability |');
  lines.push('|---|---|---|---|---|');
  series.forEach((entry, index) => {
    const axis = range ? `${entry.axis} (${range})` : entry.axis;
    lines.push(`| ${index + 1} | ${entry.name} | ${axis} | ${entry.samples.length} | ${reliability(entry, extraction.calibration)} |`);
  });
  lines.push('');

  if (extraction.notes.length > 0) {
    lines.push('Notes:');
    for (const note of extraction.notes) lines.push(`- ${note}`);
    lines.push('');
  }

  const requested = (options.series ?? [])
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .slice(0, MAX_SERIES_PER_CALL);
  if (requested.length > 0) {
    const wanted = requested.map((name) => name.toLowerCase());
    const columns = series.filter((entry) => wanted.includes(entry.name.toLowerCase()));
    const missing = requested.filter((name) => !series.some((entry) => entry.name.toLowerCase() === name.toLowerCase()));
    if (missing.length > 0) {
      const available = series.map((entry) => entry.name).join(', ') || '(none)';
      lines.push(`Requested series not found: ${missing.join(', ')}. Available: ${available}.`, '');
    }
    if (columns.length > 0) {
      const rowCap = clamp(options.maxSamples ?? MAX_SAMPLES_CAP, 1, MAX_SAMPLES_CAP);
      lines.push(`| x | ${columns.map((entry) => entry.name).join(' | ')} |`);
      lines.push(`|---|${columns.map(() => '---').join('|')}|`);
      const rows = Math.min(columns[0].samples.length, rowCap);
      for (let i = 0; i < rows; i++) {
        const values = columns.map((entry) => {
          const sample = entry.samples[i];
          return sample ? String(sample.y) : '';
        });
        lines.push(`| ${columns[0].samples[i].x} | ${values.join(' | ')} |`);
      }
      lines.push('');
    }
  }

  lines.push(disclosure(extraction, series));
  return capOutput(lines.join('\n'));
}

export const chartReadHandler: ToolHandler = {
  name: 'read_chart_data',
  definition: {
    type: 'function',
    function: {
      name: 'read_chart_data',
      description:
        'Read numeric values from curves plotted as vector geometry in a PDF chart. Call without `series` to list the series first. Automatic axis calibration refuses multi-scale pages; then supply `axes` (x and y min/max) read from the axis titles. Returns curve-derived values with provenance, never manufacturer spec values.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the PDF within the project' },
          page: { type: 'number', description: '1-based page number (default 1)' },
          series: { type: 'array', items: { type: 'string' }, description: 'Legend names to tabulate; omit to list only' },
          axes: {
            type: 'object',
            description: 'Declared axes, needed when automatic calibration refuses',
            properties: {
              x: {
                type: 'object',
                properties: { min: { type: 'number' }, max: { type: 'number' }, unit: { type: 'string' }, log: { type: 'boolean' } }
              },
              y: {
                type: 'object',
                properties: { min: { type: 'number' }, max: { type: 'number' }, unit: { type: 'string' }, log: { type: 'boolean' } }
              }
            }
          },
          seriesAxes: { type: 'object', description: "Series name → 'left' | 'right' axis label", additionalProperties: { type: 'string' } },
          maxSamples: { type: 'number', description: 'Rows per series (default 40, max 200)' }
        },
        required: ['path']
      }
    }
  },
  async execute(args: ChartReadArgs, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    // Unvalidated tool input: every field may be absent or of the wrong type.
    const input = (args ?? {}) as ChartReadInput;
    const resolved = resolveChartPdf(context.projectPath, input.path as string);
    if (!resolved.ok) return { success: false, error: resolved.error };
    const target = resolved.target;

    const maxSamples = clamp(Number(input.maxSamples ?? 40), 1, MAX_SAMPLES_CAP);
    const extraction = await extractChartData(target, {
      page: clamp(Number(input.page ?? 1), 1, Number.MAX_SAFE_INTEGER),
      axes: args.axes,
      seriesAxes: args.seriesAxes,
      maxSamples
    });
    const logLine = chartReadLogLine(args, extraction);
    if (extraction.refusals.length > 0 || !extraction.calibration.ok) context.logger?.warn(logLine);
    else context.logger?.info(logLine);
    return { success: true, result: renderChartMarkdown(extraction, { series: args.series, maxSamples }) };
  }
};
