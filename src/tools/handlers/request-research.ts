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
 * Timeout ownership: `runResearchDelegation` (core/research-delegation.ts)
 * enforces NO wall-clock budget — it is read-only and arms no timer. The
 * capability wrapper injected by the caller owns the 240 s budget and maps its
 * abort to `{ok: false, reason: 'timeout'}`. The handler maps that reason to a
 * message that also carries the tool output the aborted pass salvaged
 * (`partial`/`findings`), labelled as unverified leads; with nothing salvaged
 * the message tells the specialist to report the gap.
 */
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import type { ResearchDelegationResult } from '../../core/research-delegation.js';
import { RESEARCH_FENCE_BEGIN, RESEARCH_FENCE_END } from '../../core/research-preflight.js';

/** Hard cap on the whole tool result (spec §4). */
const MAX_RESULT_CHARS = 8000;
/** Hard cap on the question; longer questions are truncated with `…`. */
const MAX_QUESTION_CHARS = 1000;
/** Hard cap on `focus` entries; extras are dropped. */
const MAX_FOCUS_PATHS = 5;

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

export const requestResearchHandler: ToolHandler = {
  name: 'request_research',
  definition: {
    type: 'function',
    function: {
      name: 'request_research',
      description:
        'Delegate a targeted information request to the researcher. Use it when a fact you need is not in the approved baseline; it returns findings, sources and a confidence band. Max 3 calls per turn.',
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
