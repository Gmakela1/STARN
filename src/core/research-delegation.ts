/**
 * Research delegation runner: ONE bounded research run for ONE question a
 * specialist (or the open-question chat) hands over. Thin mapping layer over
 * the portal gate's single-question pipeline — no forked prompt, no second
 * loop, no second critic:
 *
 *   runQuestionResearch → verifyTopSource → assessResearch → result mapping
 *
 * Budget (RESEARCH_GATE_MAX_TURNS / RESEARCH_GATE_ITEM_TIMEOUT_MS) belongs to
 * the caller: this runner never arms its own wall-clock timer, because the
 * gate's own `runGateWithTimeout` runs `runResearchGate`, which MUTATES portal
 * state (meta.researching, auto-apply, proposals). Delegation must stay
 * read-only, so the caller passes `deps.signal` (240 s budget) and the abort
 * surfaces here as `reason: 'timeout'`.
 *
 * Core-safe: no UI/CLI imports, no imports from ../tools/, ../server/,
 * ../cli/ or ../specialists/.
 */
import type { PortalItem } from '../workspace/types.js';
import type { ResearchGateDeps } from './research-gate.js';
import { runQuestionResearch, verifyTopSource, assessResearch } from './research-gate.js';

/** One delegation: the question to research, plus optional project-relative paths to check first. */
export interface ResearchDelegationRequest {
  question: string;
  /** Project-relative paths to inspect first; prefixed onto the question as one `Focus files:` line. */
  focus?: string[];
}

/** Three bands, never a bare number the model can round up (spec §6). */
export type ResearchBand = 'high' | 'medium' | 'low';

/**
 * Delegation outcome. Failures are VALUES, never exceptions:
 * - `timeout` — the research run was aborted (ESC / 240 s budget).
 * - `unverified` — the research turn produced no usable answer.
 * - `error` — any other failure; `detail` carries the message.
 */
export type ResearchDelegationResult =
  | {
      ok: true;
      answer: string;
      sources: { title: string; url?: string }[];
      confidence: number;
      band: ResearchBand;
      reasoning: string;
      options?: string;
    }
  | { ok: false; reason: 'timeout' | 'unverified' | 'error'; detail: string };

/** Line-anchored `Alternatives:` label a research answer may end with. */
const ALTERNATIVES_LABEL_RE = /^[ \t]*(?:\*\*)?[ \t]*Alternatives[ \t]*:[ \t]*/im;

/**
 * Maps a critic confidence to its band (spec §6).
 *
 * @param confidence - critic confidence, expected 0–1 (values are not clamped)
 * @returns 'high' at >= 0.85, 'medium' at >= 0.3, 'low' below that
 */
export function toBand(confidence: number): ResearchBand {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.3) return 'medium';
  return 'low';
}

/**
 * Trailing decision block of an answer: everything after the line-anchored
 * `Alternatives:` label, through the end of the text.
 *
 * @param answer - the researched answer
 * @returns the block, or undefined when the answer has no block or it says `none`
 */
function extractOptions(answer: string): string | undefined {
  const match = answer.match(ALTERNATIVES_LABEL_RE);
  if (!match || match.index === undefined) return undefined;
  const block = answer.slice(match.index + match[0].length).trim();
  if (!block || /^none\b/i.test(block)) return undefined;
  return block;
}

/**
 * Synthetic portal item for the research turn — it only needs to carry the
 * question text; no docPath, no state entry, nothing is persisted.
 *
 * @param question - the question text (focus line already prefixed)
 * @returns a PortalItem shaped just enough for runQuestionResearch/assessResearch
 */
function syntheticItem(question: string): PortalItem {
  const now = new Date().toISOString();
  return {
    id: 'research-delegation',
    type: 'question',
    severity: 'normal',
    title: question,
    status: 'open',
    source: 'autopilot',
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Runs ONE delegated research request through the portal gate's own research
 * path and maps the outcome. Never throws.
 *
 * @param deps - the session-assembled research gate deps (client, critic,
 *   registry, state, optional search/verifySource/logger/signal). Used
 *   unchanged — no extra plumbing.
 * @param req - the question and optional focus paths
 * @returns `ok: true` with answer, sources, critic confidence, band, reasoning
 *   and (when present) the decision block; `ok: false` with a reason on
 *   timeout, no usable answer, or any other failure
 */
export async function runResearchDelegation(
  deps: ResearchGateDeps,
  req: ResearchDelegationRequest
): Promise<ResearchDelegationResult> {
  const question = req.focus && req.focus.length > 0
    ? `Focus files: ${req.focus.join(', ')}\n${req.question}`
    : req.question;
  const item = syntheticItem(question);

  try {
    const research = await runQuestionResearch(deps, item);
    if (!research || !research.answer.trim()) {
      return { ok: false, reason: 'unverified', detail: research?.reasoning || 'No answer returned by the research turn.' };
    }

    // Same pre-critic step as the gate: fetch the top cited URL so the critic
    // grades actual source content (unverified → confidence capped at 0.85).
    const verification = await verifyTopSource(deps, research);
    const assessment = await assessResearch(deps, item, research, verification);

    return {
      ok: true,
      answer: research.answer,
      sources: research.sources.map(s => ({ title: s.title, url: s.url })),
      confidence: assessment.confidence,
      band: toBand(assessment.confidence),
      reasoning: assessment.rationale || research.reasoning,
      options: extractOptions(research.answer)
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, reason: 'timeout', detail: err?.message || 'Research run aborted.' };
    }
    return { ok: false, reason: 'error', detail: err?.message || String(err) };
  }
}
