/**
 * Research delegation runner: ONE bounded research run for ONE question a
 * specialist (or the open-question chat) hands over. Thin mapping layer over
 * the portal gate's single-question pipeline — no forked prompt, no second
 * loop, no second critic:
 *
 *   runQuestionResearch → verifyTopSource → assessResearch → result mapping
 *
 * Budget (RESEARCH_GATE_MAX_TURNS / RESEARCH_GATE_ITEM_TIMEOUT_MS) belongs to
 * the caller: `runResearchDelegation` itself arms no wall-clock timer, because
 * the gate's own `runGateWithTimeout` runs `runResearchGate`, which MUTATES
 * portal state (meta.researching, auto-apply, proposals). Delegation must stay
 * read-only, so the caller passes `deps.signal` (240 s budget) and the abort
 * surfaces here as `reason: 'timeout'`. The one caller-side budget
 * implementation is `runResearchDelegationWithTimeout` below: it owns the
 * timer, the AbortController and the timeout value, so runner and session
 * share it instead of each arming their own.
 *
 * Core-safe: no UI/CLI imports, no imports from ../tools/, ../server/,
 * ../cli/ or ../specialists/.
 */
import type { PortalItem, PortalThreadMessage } from '../workspace/types.js';
import type { ResearchGateDeps } from './research-gate.js';
import { runQuestionResearch, verifyTopSource, assessResearch } from './research-gate.js';

/** One delegation: the question to research, plus optional project-relative paths to check first. */
export interface ResearchDelegationRequest {
  question: string;
  /** Project-relative paths to inspect first; prefixed onto the question as one `Focus files:` line. */
  focus?: string[];
}

/**
 * What a delegation needs from the portal gate: everything EXCEPT
 * `applyAnswer`, because delegation is read-only. Narrower than
 * `ResearchGateDeps` on purpose — a caller cannot hand delegation the power to
 * apply an answer, and a drafting turn (which has no answer-applier at all)
 * can assemble these deps.
 */
export type ResearchDelegationDeps = Omit<ResearchGateDeps, 'applyAnswer'>;

/**
 * Placeholder for the gate's required `applyAnswer` slot. Nothing on the
 * delegation path (runQuestionResearch / verifyTopSource / assessResearch)
 * calls it; it throws so that a future call cannot silently mutate portal
 * state from a read-only run.
 */
const READ_ONLY_APPLY_ANSWER = async (): Promise<never> => {
  throw new Error('Research delegation is read-only: applyAnswer must never be called.');
};

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
  deps: ResearchDelegationDeps,
  req: ResearchDelegationRequest
): Promise<ResearchDelegationResult> {
  const gateDeps: ResearchGateDeps = { ...deps, applyAnswer: READ_ONLY_APPLY_ANSWER };
  const question = req.focus && req.focus.length > 0
    ? `Focus files: ${req.focus.join(', ')}\n${req.question}`
    : req.question;
  const item = syntheticItem(question);

  try {
    const research = await runQuestionResearch(gateDeps, item);
    if (!research || !research.answer.trim()) {
      return { ok: false, reason: 'unverified', detail: research?.reasoning || 'No answer returned by the research turn.' };
    }

    // Same pre-critic step as the gate: fetch the top cited URL so the critic
    // grades actual source content (unverified → confidence capped at 0.85).
    const verification = await verifyTopSource(gateDeps, research);
    const assessment = await assessResearch(gateDeps, item, research, verification);

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

/** Wall-clock budget for ONE delegation (spec §5.2: the gate's own 240 s). */
export const RESEARCH_DELEGATION_TIMEOUT_MS = 240_000;

/**
 * Runs ONE delegation under a wall-clock budget — the ONE caller-side timer
 * implementation, shared by the drafting runner and the advisory/conclude
 * thread turns.
 *
 * The timer aborts an AbortController that is passed to the delegation as
 * `deps.signal`, so an in-flight research loop stops instead of running on.
 * A caller-supplied `deps.signal` (ESC / turn abort) forwards into the same
 * controller, so either abort ends the run. Resolves, never rejects: the
 * timeout is a VALUE (`{ ok: false, reason: 'timeout' }`).
 *
 * @param deps - read-only gate deps; an existing `signal` is honoured and
 *   shadowed by the timeout controller
 * @param req - the question and optional focus paths
 * @param ms - budget in milliseconds (tests inject a short value)
 * @returns the delegation result, or `{ ok: false, reason: 'timeout',
 *   detail: '<ms/1000>s' }` when the budget fires first
 */
export async function runResearchDelegationWithTimeout(
  deps: ResearchDelegationDeps,
  req: ResearchDelegationRequest,
  ms: number = RESEARCH_DELEGATION_TIMEOUT_MS
): Promise<ResearchDelegationResult> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (deps.signal?.aborted) {
    controller.abort();
  } else {
    deps.signal?.addEventListener('abort', forwardAbort, { once: true });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: ResearchDelegationResult = { ok: false, reason: 'timeout', detail: `${ms / 1000}s` };
  // Both the timer and a forwarded caller abort end the run: the controller's
  // abort resolves the race, so an ESC during research does not wait out the
  // budget.
  const deadline = new Promise<ResearchDelegationResult>(resolve => {
    controller.signal.addEventListener('abort', () => resolve(timedOut), { once: true });
    if (controller.signal.aborted) {
      resolve(timedOut);
      return;
    }
    timer = setTimeout(() => controller.abort(), ms);
  });

  try {
    return await Promise.race([
      runResearchDelegation({ ...deps, signal: controller.signal }, req),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Thread row for a delegation that produced findings (spec §9): the question
 * asked, plus the confidence band and sources so the thread can show what the
 * researcher actually found. Failures produce NO row — the specialist reports
 * the gap in its own reply, so an empty research bubble would be noise.
 *
 * @param req - the delegation request (its `question` becomes the row text)
 * @param result - the delegation outcome
 * @param ts - row timestamp (epoch ms)
 * @returns the `role: 'specialist'`, `kind: 'research'` row, or null when the
 *   delegation did not succeed
 */
export function buildResearchThreadRow(
  req: ResearchDelegationRequest,
  result: ResearchDelegationResult,
  ts: number
): PortalThreadMessage | null {
  if (!result.ok) return null;
  return {
    role: 'specialist',
    kind: 'research',
    text: req.question,
    ts,
    research: {
      confidence: result.confidence,
      band: result.band,
      sources: result.sources.map(s => ({ title: s.title, url: s.url }))
    }
  };
}
