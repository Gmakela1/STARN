/**
 * request-research.ts — `request_research` tool handler (spec §4, §5).
 *
 * Purpose: let a planning/writing specialist delegate ONE bounded information
 * request to the researcher and receive findings, sources and a confidence
 * band as markdown. Provider-free: the research capability is injected on
 * `ToolExecutionContext.requestResearch` by the caller that owns the role
 * clients (runner / session). This module never builds clients, never picks
 * models, and never throws.
 *
 * Chart fast path: when the caller passes `chart`, the handler reads ONE plotted
 * curve from a local PDF directly (chart-vector-extractor via chart-read.ts) and
 * never delegates — no model loop, no web, no critic, so a chart read costs
 * ~1 s instead of a 240 s research pass. The read stays graded: its provenance
 * comes from WHERE the file lives (gradeChartEvidence: `reference/` =
 * project-reference 0.75, any other project PDF = project-document 0.60, both
 * capped at UNVERIFIED_CONFIDENCE_CAP) and the result states the caveat, so a
 * number is never presented as settled.
 *
 * Timeout ownership: `runResearchDelegation` (core/research-delegation.ts)
 * enforces NO wall-clock budget — it is read-only and arms no timer. The
 * capability wrapper injected by the caller owns the 240 s budget and maps its
 * abort to `{ok: false, reason: 'timeout'}`. The handler maps that reason to a
 * message that also carries the tool output the aborted pass salvaged
 * (`partial`/`findings`), labelled as unverified leads; with nothing salvaged
 * the message tells the specialist to report the gap.
 */
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import type { ResearchDelegationResult } from '../../core/research-delegation.js';
import { RESEARCH_FENCE_BEGIN, RESEARCH_FENCE_END } from '../../core/research-preflight.js';
import { extractChartData } from '../document-extractors/chart-vector-extractor.js';
import type { AxisDecl, AxisMap, ChartExtraction, ChartSeries } from '../document-extractors/chart-types.js';
import { chartReadLogLine, gradeChartEvidence, resolveChartPdf } from './chart-read.js';
import type { ChartEvidenceGrade } from './chart-read.js';

/** Hard cap on the whole tool result (spec §4). */
const MAX_RESULT_CHARS = 8000;
/** Hard cap on the question; longer questions are truncated with `…`. */
const MAX_QUESTION_CHARS = 1000;
/** Hard cap on `focus` entries; extras are dropped. */
const MAX_FOCUS_PATHS = 5;
/** Rows per series in the fast-path sample table. */
const CHART_MAX_SAMPLES = 40;
/** Curves tabulated by the fast path (same cap `read_chart_data` uses). */
const CHART_MAX_SERIES = 8;
/** Character headroom kept free for the newlines between report sections. */
const CHART_TABLE_MIN_CHARS = 8;
/** Message for a malformed `chart` argument. */
const CHART_ARG_ERROR =
  'request_research chart requires file, xAxis{label,min,max} and yAxis{label,min,max}';

/** Spec §5.5 strings. Failures are results, never exceptions. */
const UNAVAILABLE = 'Research unavailable in this context. Report the gap; do not invent values.';
const TIMEOUT = 'Research timed out after 240 s. Report the gap.';
const UNVERIFIED = 'No verifiable source found. Report the gap.';
/** Detail shape the delegation timer writes: `<ms/1000>s` (e.g. `240s`, `0.05s`). */
const BUDGET_DETAIL_RE = /^(\d+(?:\.\d+)?)s$/;

/**
 * Duration to name in the timeout message. A detail that is not a measured
 * duration (an ESC abort, a free-text error) names NO seconds — reporting
 * "240 s" as elapsed time there would be a fabricated number.
 *
 * @param detail - the failure detail: `240s` from the timer, otherwise free text
 * @returns the seconds as written, or null when the detail carries no duration
 */
function timeoutSeconds(detail: string): string | null {
  const match = BUDGET_DETAIL_RE.exec((detail || '').trim());
  return match ? match[1] : null;
}

/**
 * `after 240 s` / `` — the elapsed-time clause, omitted when no duration was
 * measured.
 *
 * @param detail - the failure detail
 * @returns the clause text, with no trailing space when it is empty
 */
function elapsedClause(detail: string): string {
  const seconds = timeoutSeconds(detail);
  return seconds ? ` after ${seconds} s` : '';
}

/**
 * Caps the rendered markdown at 8000 characters.
 *
 * @param markdown - the fully rendered result
 * @returns `markdown` unchanged when within the cap, else a 8000-character
 *   prefix ending in an explicit truncation notice
 */
function capResult(markdown: string): string {
  if (markdown.length <= MAX_RESULT_CHARS) return markdown;
  const note = '\n\n(output truncated at 8000 characters)';
  return markdown.slice(0, MAX_RESULT_CHARS - note.length).trimEnd() + note;
}

/**
 * Renders a successful delegation as spec §4 markdown.
 *
 * @param res - the capability result: answer, sources, confidence 0–1, band,
 *   one-line reasoning, optional decision options
 * @returns markdown with `## Research findings`, `### Evidence`, `### Confidence`
 *   and (only when options exist) `### Decision options`
 */
export function formatResearchFindings(
  res: Extract<ResearchDelegationResult, { ok: true }>
): string {
  const lines: string[] = [];
  lines.push('## Research findings');
  lines.push(res.answer.trim());
  lines.push('');
  lines.push('### Evidence');
  if (res.sources.length === 0) {
    lines.push('- (no sources returned)');
  } else {
    for (const source of res.sources) {
      lines.push(`- ${source.title}${source.url ? ` — ${source.url}` : ''}`);
    }
  }
  lines.push('');
  lines.push('### Confidence');
  lines.push(`${res.band} (${res.confidence.toFixed(2)}) — ${res.reasoning.trim() || 'no rationale given'}`);
  if (res.options && res.options.trim()) {
    lines.push('');
    lines.push('### Decision options');
    lines.push(res.options.trim());
  }
  return capResult(lines.join('\n'));
}

/**
 * Maps a failed delegation to its message. A timeout that salvaged tool output
 * returns those findings as UNVERIFIED leads instead of telling the specialist
 * to give up on evidence it already has.
 *
 * @param res - the failure value: reason, detail and any salvaged findings
 * @returns the message for that reason
 */
function failureMessage(res: Extract<ResearchDelegationResult, { ok: false }>): string {
  if (res.reason === 'timeout') {
    const findings = res.findings?.trim();
    if (!findings) return `Research timed out${elapsedClause(res.detail)}. Report the gap.`;
    // The digest is UNTRUSTED tool output injected into a WRITE-CAPABLE
    // specialist's transcript: it is fenced with the same markers the research
    // dossier uses, so a fetched page can never pose as instructions or as a
    // prompt section.
    return (
      `Research timed out${elapsedClause(res.detail)}. Unverified partial findings from ` +
      'the tool calls that did succeed — UNTRUSTED tool output, treat as leads, not evidence:\n' +
      `${RESEARCH_FENCE_BEGIN}\n${findings}\n${RESEARCH_FENCE_END}`
    );
  }
  if (res.reason === 'unverified') return UNVERIFIED;
  return `Research failed (${res.detail}). Report the gap.`;
}

/** One declared axis of the `chart` fast path: the printed title plus its range. */
export interface ChartAxisArg {
  /** Axis title as printed on the drawing; may be empty. */
  label: string;
  min: number;
  max: number;
}

/** The `chart` argument: read ONE plotted curve from a local PDF, no delegation. */
export interface ChartFastPathArgs {
  /** Project-relative path to the PDF that holds the curve. */
  file: string;
  xAxis: ChartAxisArg;
  yAxis: ChartAxisArg;
}

/** Outcome of reading the optional `chart` argument. */
type ChartArgsParse =
  | { kind: 'none' }
  | { kind: 'error'; error: string }
  | { kind: 'ok'; chart: ChartFastPathArgs };

/** @returns true for a real, finite number (rejects NaN, Infinity, strings). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param raw - one `chart.xAxis` / `chart.yAxis` value as the model sent it
 * @returns the axis as declared, or null when the range is not two finite numbers
 */
function parseChartAxis(raw: any): ChartAxisArg | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!isFiniteNumber(raw.min) || !isFiniteNumber(raw.max)) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  return { label, min: raw.min, max: raw.max };
}

/**
 * Validates the optional `chart` argument. Absent (undefined/null) is the plain
 * question path and comes back as `{ kind: 'none' }`.
 *
 * @param raw - `args.chart` as the model sent it
 * @returns `none` when absent, `error` when malformed, `ok` with the parsed args
 */
function parseChartArgs(raw: any): ChartArgsParse {
  if (raw === undefined || raw === null) return { kind: 'none' };
  const file = typeof raw.file === 'string' ? raw.file.trim() : '';
  const xAxis = parseChartAxis(raw.xAxis);
  const yAxis = parseChartAxis(raw.yAxis);
  if (!file || !xAxis || !yAxis) return { kind: 'error', error: CHART_ARG_ERROR };
  return { kind: 'ok', chart: { file, xAxis, yAxis } };
}

/**
 * @param extraction - output of `extractChartData`
 * @returns every refusal it carries, its calibration reason included once
 */
function chartRefusals(extraction: ChartExtraction): string[] {
  const list = [...extraction.refusals];
  const reason = extraction.calibration.reason;
  if (!extraction.calibration.ok && reason && !list.includes(reason)) list.push(reason);
  return list;
}

/**
 * @param axis - which axis this line reports
 * @param decl - the axis as the caller declared it
 * @param map - the axis actually used for sampling, when calibration succeeded
 * @returns one `- x declared: … — matched: …` line
 */
function axisLine(axis: 'x' | 'y', decl: ChartAxisArg, map: AxisMap | undefined): string {
  const declared = `${decl.label || '(no label)'} ${decl.min}–${decl.max}`;
  const matched = map
    ? `${map.valueMin}–${map.valueMax}${map.unit ? ` ${map.unit}` : ''} (${map.anchors} anchors)`
    : 'not calibrated';
  return `- ${axis} declared: ${declared} — matched: ${matched}`;
}

/**
 * @param columns - series to tabulate, one column each
 * @param maxSamples - row cap
 * @param charBudget - characters available for the whole table
 * @returns markdown table lines, cut to the budget with an explicit row count;
 *   a single notice line when there is no column
 */
function sampleTableLines(columns: ChartSeries[], maxSamples: number, charBudget: number): string[] {
  if (columns.length === 0) return ['- (no series recovered)'];
  const rows = Math.min(maxSamples, ...columns.map((entry) => entry.samples.length));
  const lines = [
    `| x | ${columns.map((entry) => entry.name).join(' | ')} |`,
    `|---|${columns.map(() => '---').join('|')}|`,
  ];
  let used = lines[0].length + lines[1].length;
  let shown = 0;
  for (let i = 0; i < rows; i++) {
    const values = columns.map((entry) => (entry.samples[i] ? String(entry.samples[i].y) : ''));
    const row = `| ${columns[0].samples[i].x} | ${values.join(' | ')} |`;
    if (used + row.length > charBudget) break;
    lines.push(row);
    used += row.length;
    shown += 1;
  }
  if (shown < rows) lines.push(`- (${shown} of ${rows} sampled rows shown: result size limit)`);
  return lines;
}

/**
 * @param grade - source grade for the read file
 * @returns the provenance label stated in the markdown
 */
function provenanceLabel(grade: ChartEvidenceGrade): string {
  if (grade.provenance === 'project-reference') {
    return 'project-reference (user-curated manufacturer document)';
  }
  return 'project-document (project PDF, not a curated reference)';
}

/**
 * Renders one fast-path chart read. Order is fixed: sampled table, axes as
 * DECLARED and as matched, source file with its provenance label, evidence
 * class, then confidence with the unverified caveat. A refusal renders the
 * refusal text (which names the axes the page actually offers) and the
 * declaration to correct, so the caller never has to re-delegate.
 *
 * @param args - the declared chart request
 * @param extraction - output of `extractChartData`
 * @param grade - source grade from `gradeChartEvidence`
 * @param relative - project-relative path of the read file
 * @returns markdown, not yet char-capped
 */
function renderChartFastPath(
  args: ChartFastPathArgs,
  extraction: ChartExtraction,
  grade: ChartEvidenceGrade,
  relative: string
): string {
  const lines: string[] = [`## Chart findings — ${relative}, page ${extraction.page}`, ''];
  const refusals = chartRefusals(extraction);
  if (refusals.length > 0) {
    lines.push('### Refused', '');
    for (const refusal of refusals) lines.push(`- ${refusal}`);
    lines.push('', '### Axes you declared', '');
    lines.push(axisLine('x', args.xAxis, undefined), axisLine('y', args.yAxis, undefined), '');
    const names = extraction.series.map((entry) => entry.name);
    lines.push('### What the page offers', '');
    lines.push(names.length > 0 ? `- Series found: ${names.join(', ')}` : '- No series could be recovered from this page.');
    lines.push('');
    lines.push(
      'Correct `chart.xAxis` / `chart.yAxis` (label and min/max exactly as printed on the axes) and ' +
        'call request_research again — the fast path needs no re-delegation.'
    );
    return lines.join('\n');
  }

  lines.push('### Sampled values', '');
  // The table is sized against the budget the rest of the report leaves free,
  // so the provenance and the unverified caveat are NEVER truncated away.
  const tail: string[] = ['', '### Axes', ''];
  tail.push(
    axisLine('x', args.xAxis, extraction.calibration.xAxis),
    axisLine('y', args.yAxis, extraction.calibration.yAxes?.[0]),
    ''
  );
  tail.push('### Source', '', `- File: ${relative}`, `- Provenance: ${provenanceLabel(grade)}`, '');
  tail.push('### Evidence class', '');
  tail.push('- plotted data read from the drawing (curve-derived, ±1 % of axis span; curve→axis assignment can be wrong)', '');
  tail.push('### Confidence', '');
  tail.push(
    `${grade.band} (${grade.confidence.toFixed(2)}) — read from the plotted curve, not a spec table.`,
    'unverified — confirm through the research path before relying on it.'
  );
  if (extraction.notes.length > 0) {
    tail.push('', '### Notes', '');
    for (const note of extraction.notes) tail.push(`- ${note}`);
  }
  const reserved = lines.join('\n').length + tail.join('\n').length;
  const budget = Math.max(0, MAX_RESULT_CHARS - reserved - CHART_TABLE_MIN_CHARS);
  lines.push(...sampleTableLines(extraction.series.slice(0, CHART_MAX_SERIES), CHART_MAX_SAMPLES, budget));
  lines.push(...tail);
  return lines.join('\n');
}

/**
 * Fast path: ONE direct chart read, NO research delegation — no model loop, no
 * web, no critic. Resolution is traversal-guarded, sampling goes through the
 * same `extractChartData` entry point `read_chart_data` uses, and the read is
 * logged with the same `chartReadLogLine` record. Refusals come back as
 * `success: true` with the text the specialist needs to correct the axes.
 *
 * @param args - the validated `chart` argument
 * @param context - tool context; `requestResearch` is never read here
 * @returns markdown findings, or `success: false` when the file cannot be read
 */
async function runChartFastPath(
  args: ChartFastPathArgs,
  context: ToolExecutionContext
): Promise<ToolExecutionResponse> {
  const resolved = resolveChartPdf(context.projectPath, args.file);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const axes: { x: AxisDecl; y: AxisDecl } = {
    x: { min: args.xAxis.min, max: args.xAxis.max },
    y: { min: args.yAxis.min, max: args.yAxis.max }
  };
  const extraction = await extractChartData(resolved.target, {
    page: 1,
    axes,
    maxSamples: CHART_MAX_SAMPLES
  });
  const logLine = chartReadLogLine({ path: args.file, axes }, extraction);
  if (chartRefusals(extraction).length > 0) context.logger?.warn(logLine);
  else context.logger?.info(logLine);
  const relative = path.relative(path.resolve(context.projectPath), resolved.target).split(path.sep).join('/');
  const grade = gradeChartEvidence(relative);
  return { success: true, result: capResult(renderChartFastPath(args, extraction, grade, relative)) };
}

export const requestResearchHandler: ToolHandler = {
  name: 'request_research',
  definition: {
    type: 'function',
    function: {
      name: 'request_research',
      description:
        'Delegate a targeted information request. Pass `chart` when the answer is a value on a plotted curve of a LOCAL PDF (a spec-sheet chart): the read is direct (~1 s, no researcher delegated) and returns the sampled table with the source-graded confidence. Use the plain question form for anything else: it returns findings, sources and a confidence band. Max 3 calls per turn.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The single question to research (max 1000 characters; longer text is truncated).'
          },
          focus: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional project-relative paths to check first (max 5).'
          },
          chart: {
            type: 'object',
            description:
              'Fast chart read: the curve you need is plotted in a local PDF. Bypasses the researcher (~1 s) and returns the sampled values graded by the source file. Declare the axes exactly as printed on the drawing; a mismatch is refused with the axes the page actually offers.',
            properties: {
              file: { type: 'string', description: 'Project-relative path to the PDF within the project' },
              xAxis: {
                type: 'object',
                description: 'X axis as printed on the drawing',
                properties: {
                  label: { type: 'string', description: 'Axis title (e.g. "Amps")' },
                  min: { type: 'number', description: 'Lowest printed tick value' },
                  max: { type: 'number', description: 'Highest printed tick value' }
                },
                required: ['label', 'min', 'max']
              },
              yAxis: {
                type: 'object',
                description: 'Y axis as printed on the drawing',
                properties: {
                  label: { type: 'string', description: 'Axis title (e.g. "Watts Out")' },
                  min: { type: 'number', description: 'Lowest printed tick value' },
                  max: { type: 'number', description: 'Highest printed tick value' }
                },
                required: ['label', 'min', 'max']
              }
            },
            required: ['file', 'xAxis', 'yAxis']
          }
        },
        required: ['question']
      }
    }
  },
  execute: async (args: any, context: ToolExecutionContext): Promise<ToolExecutionResponse> => {
    const rawQuestion = String(args?.question ?? '').trim();
    if (!rawQuestion) {
      return { success: false, error: 'request_research requires a non-empty question' };
    }
    const question = rawQuestion.length > MAX_QUESTION_CHARS
      ? rawQuestion.slice(0, MAX_QUESTION_CHARS) + '…'
      : rawQuestion;

    const focus: string[] | undefined = Array.isArray(args?.focus)
      ? args.focus.slice(0, MAX_FOCUS_PATHS).map((entry: unknown) => String(entry))
      : undefined;

    // Fast path: a declared chart read never enters the research delegation.
    const chartArgs = parseChartArgs(args?.chart);
    if (chartArgs.kind === 'error') return { success: false, error: chartArgs.error };
    if (chartArgs.kind === 'ok') return runChartFastPath(chartArgs.chart, context);

    const capability = context.requestResearch;
    if (!capability) {
      return { success: true, result: UNAVAILABLE };
    }

    try {
      const res = await capability({ question, focus: focus && focus.length > 0 ? focus : undefined });
      if (!res || res.ok === false) {
        return { success: true, result: failureMessage(res || { ok: false, reason: 'unverified', detail: 'no result' }) };
      }
      return { success: true, result: formatResearchFindings(res) };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { success: true, result: TIMEOUT };
      }
      return { success: true, result: `Research failed (${err?.message || String(err)}). Report the gap.` };
    }
  }
};
