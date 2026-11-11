/**
 * Research delegation runner: ONE bounded research run for ONE question a
 * specialist (or the open-question chat) hands over. Thin mapping layer over
 * the portal gate's single-question pipeline — no forked prompt, no second
 * loop, no second critic:
 *
 *   runQuestionResearch → verifyTopSource → assessResearch → result mapping
 *
 * When the critic lands below UNVERIFIED_CONFIDENCE_CAP AND names a specific
 * gap, ONE focused retry runs the SAME pipeline again with that gap as the
 * focus of the question. Exactly one retry per request — never a loop. The
 * better confidence wins (a tie goes to the retry), and the source lists are
 * merged so the answer keeps every citation either pass found.
 *
 * Budget (RESEARCH_GATE_MAX_TURNS / RESEARCH_GATE_ITEM_TIMEOUT_MS) belongs to
 * the caller: `runResearchDelegation` itself arms no wall-clock timer, because
 * the gate's own `runGateWithTimeout` runs `runResearchGate`, which MUTATES
 * portal state (meta.researching, auto-apply, proposals). Delegation must stay
 * read-only, so the caller passes `deps.signal` (240 s budget) and the abort
 * surfaces here as `reason: 'timeout'`. The one caller-side budget
 * implementation is `runResearchDelegationWithTimeout` below: it owns the
 * timer, the AbortController and the timeout value, so runner and session
 * share it instead of each arming their own. The timer is the TOTAL budget
 * (RESEARCH_DELEGATION_TOTAL_BUDGET_MS = two 240 s passes); the retry is spent
 * only when the remaining budget can still cover it.
 *
 * Core-safe: no UI/CLI imports, no imports from ../tools/, ../server/,
 * ../cli/ or ../specialists/.
 */
import type { PortalItem, PortalThreadMessage } from '../workspace/types.js';
import type { ResearchGateDeps } from './research-gate.js';
import { runQuestionResearch, verifyTopSource, assessResearch, extractDecisionBlock, UNVERIFIED_CONFIDENCE_CAP } from './research-gate.js';

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
 * - `timeout` — the research run was aborted (ESC / 240 s budget). When the
 *   aborted pass already collected usable tool output, `partial: true` and
 *   `findings` carry it (unverified leads, not an answer).
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
  | {
      ok: false;
      reason: 'timeout' | 'unverified' | 'error';
      detail: string;
      /** True when the aborted pass salvaged tool output into `findings`. */
      partial?: boolean;
      /** Capped digest of the successful tool rows of an aborted pass. */
      findings?: string;
    };

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
 * Trailing decision block of an answer, or undefined when it has none, it is
 * empty, or it says `none`. The extraction — including the stop at a trailing
 * `Implications:` line / markdown heading — is extractDecisionBlock in
 * research-gate, the ONE extractor this path shares with the memo path.
 *
 * @param answer - the researched answer
 * @returns the block, or undefined when the answer has no block or it says `none`
 */
function extractOptions(answer: string): string | undefined {
  const block = extractDecisionBlock(answer);
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

/** A successful delegation result (the `ok: true` arm of the outcome union). */
type ResearchDelegationSuccess = Extract<ResearchDelegationResult, { ok: true }>;
/** A failed delegation result (the `ok: false` arm of the outcome union). */
type ResearchDelegationFailure = Extract<ResearchDelegationResult, { ok: false }>;

/** Outcome of ONE pipeline pass, before the retry decision. */
type PassOutcome =
  | { ok: true; result: ResearchDelegationSuccess; assessment: { confidence: number; rationale: string } }
  | { ok: false; result: ResearchDelegationFailure };

/**
 * Gap markers a critic rationale must carry to earn a retry. Deliberately
 * conservative: a rationale that only says the sources agree ("stated
 * verbatim", "no conflicts found") names no gap, so the retry stays a targeted
 * second look instead of a blind re-roll.
 */
const NAMED_GAP_PATTERN =
  /\b(gaps?|missing|absent|not stated|unverified|insufficient|unsupported|incomplete|lacks?|lacking|only one source|no second source|could not (?:be )?(?:verify|verified|find|confirm)|cannot (?:be )?(?:verify|verified|confirm)|unclear)\b/i;

/** Cap on the gap text folded into a retry question (a salvaged digest is 6 kB). */
const RETRY_FOCUS_CHAR_CAP = 2000;

/**
 * True when a critic rationale names a specific gap worth one focused retry.
 *
 * @param rationale - the assessment rationale (may be empty)
 * @returns true only when the text carries a gap marker (see NAMED_GAP_PATTERN)
 */
function hasNamedGap(rationale: string): boolean {
  return NAMED_GAP_PATTERN.test(rationale || '');
}

/**
 * Concatenates two source lists and drops later duplicates by url (or title
 * when a source has no url). The kept answer's sources come first.
 *
 * @param kept - sources of the answer being returned
 * @param other - sources of the discarded answer
 * @returns the merged, order-preserving, deduped list
 */
function mergeSources(
  kept: { title: string; url?: string }[],
  other: { title: string; url?: string }[]
): { title: string; url?: string }[] {
  const seen = new Set<string>();
  const merged: { title: string; url?: string }[] = [];
  for (const source of [...kept, ...other]) {
    const key = source.url || source.title;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(source);
  }
  return merged;
}

/**
 * ONE pass of the delegation pipeline: research → verify top source → assess.
 * Never throws; failures are values, aborts keep whatever the pass salvaged.
 *
 * @param gateDeps - gate deps with the read-only applyAnswer placeholder
 * @param question - the question text (focus line already prefixed)
 * @returns the pass outcome: a mapped result plus, on success, the assessment
 */
async function runPass(gateDeps: ResearchGateDeps, question: string): Promise<PassOutcome> {
  const item = syntheticItem(question);
  try {
    const research = await runQuestionResearch(gateDeps, item);
    // Aborted pass: hand back the tool output it already collected instead of
    // dropping the transcript on the floor.
    if (research?.partial) {
      return {
        ok: false,
        result: research.findings
          ? { ok: false, reason: 'timeout', detail: 'aborted', partial: true, findings: research.findings }
          : { ok: false, reason: 'timeout', detail: 'aborted', partial: true }
      };
    }
    if (!research || !research.answer.trim()) {
      return {
        ok: false,
        result: {
          ok: false,
          reason: 'unverified',
          detail: research?.reasoning || 'No answer returned by the research turn.'
        }
      };
    }

    // Same pre-critic step as the gate: fetch the top cited URL so the critic
    // grades actual source content (unverified → confidence capped at 0.85).
    const verification = await verifyTopSource(gateDeps, research);
    const assessment = await assessResearch(gateDeps, item, research, verification);

    return {
      ok: true,
      assessment: { confidence: assessment.confidence, rationale: assessment.rationale },
      result: {
        ok: true,
        answer: research.answer,
        sources: research.sources.map(s => ({ title: s.title, url: s.url })),
        confidence: assessment.confidence,
        band: toBand(assessment.confidence),
        reasoning: assessment.rationale || research.reasoning,
        options: extractOptions(research.answer)
      }
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, result: { ok: false, reason: 'timeout', detail: err?.message || 'Research run aborted.' } };
    }
    return { ok: false, result: { ok: false, reason: 'error', detail: err?.message || String(err) } };
  }
}

/**
 * Runs ONE delegated research request through the portal gate's own research
 * path and maps the outcome — plus AT MOST ONE focused retry when the critic
 * lands below the confidence cap and names a gap. Never throws.
 *
 * @param deps - the session-assembled research gate deps (client, critic,
 *   registry, state, optional search/verifySource/logger/signal). Used
 *   unchanged — no extra plumbing.
 * @param req - the question and optional focus paths
 * @param budgetMs - TOTAL wall-clock budget this delegation may use; the retry
 *   is skipped unless the remaining budget still covers RESEARCH_RETRY_BUDGET_MS
 * @returns `ok: true` with answer, sources, critic confidence, band, reasoning
 *   and (when present) the decision block; `ok: false` with a reason on
 *   timeout, no usable answer, or any other failure
 */
export async function runResearchDelegation(
  deps: ResearchDelegationDeps,
  req: ResearchDelegationRequest,
  budgetMs: number = RESEARCH_DELEGATION_TOTAL_BUDGET_MS
): Promise<ResearchDelegationResult> {
  const gateDeps: ResearchGateDeps = { ...deps, applyAnswer: READ_ONLY_APPLY_ANSWER };
  const question = req.focus && req.focus.length > 0
    ? `Focus files: ${req.focus.join(', ')}\n${req.question}`
    : req.question;
  const startedAt = Date.now();
  const first = await runPass(gateDeps, question);

  // The gap a retry would focus on. A below-cap critic rationale that names a
  // gap, or — with no critic at all — the digest a timed-out pass salvaged.
  let gap = '';
  if (first.ok) {
    if (first.assessment.confidence < UNVERIFIED_CONFIDENCE_CAP && hasNamedGap(first.assessment.rationale)) {
      gap = first.assessment.rationale.trim();
    }
  } else if (first.result.partial && first.result.findings) {
    gap = first.result.findings.trim();
  }
  if (!gap) return first.result;

  const confidence = first.ok ? first.assessment.confidence.toFixed(2) : 'none';
  const gapKind = first.ok ? 'named' : 'salvaged-digest';
  const remainingMs = budgetMs - (Date.now() - startedAt);
  if (remainingMs < RESEARCH_RETRY_BUDGET_MS) {
    deps.logger?.info(
      `Research retry skipped (budget): confidence=${confidence} gap=${gapKind} ` +
        `remainingMs=${Math.max(0, remainingMs)} outcome=kept-first`
    );
    return first.result;
  }

  // ONE focused retry: the same question plus the named gap as its focus,
  // through the same loop (the question carries the focus line — no new
  // parameter on the research loop).
  const retry = await runPass(gateDeps, `${question}\nFocus: ${gap.slice(0, RETRY_FOCUS_CHAR_CAP)}`);
  // Higher confidence wins; a tie goes to the retry (it had the gap pointed
  // out). A retry that produced any answer beats a pass that produced none.
  const keepRetry = retry.ok && (!first.ok || retry.assessment.confidence >= first.assessment.confidence);
  const kept = keepRetry ? retry.result : first.result;
  if (kept.ok) {
    const other = keepRetry ? first.result : retry.result;
    kept.sources = mergeSources(kept.sources, other.ok ? other.sources : []);
  }
  const retryConfidence = retry.ok ? retry.assessment.confidence.toFixed(2) : 'none';
  deps.logger?.info(
    `Research retry: confidence=${confidence} gap=${gapKind} retryConfidence=${retryConfidence} ` +
      `outcome=kept-${keepRetry ? 'retry' : 'first'}`
  );
  return kept;
}

/** Wall-clock budget for ONE research pass (spec §5.2: the gate's own 240 s). */
export const RESEARCH_DELEGATION_TIMEOUT_MS = 240_000;
/**
 * Wall-clock budget for the ONE focused retry: the same 240 s as the first
 * pass. It is spent only when the remaining total budget still covers it.
 */
export const RESEARCH_RETRY_BUDGET_MS = RESEARCH_DELEGATION_TIMEOUT_MS;
/**
 * Worst-case wall clock for ONE delegation: 240 s first pass + 240 s retry =
 * 480 s. The retry is skipped for cost when the first pass already used more
 * than its own 240 s share of this total.
 */
export const RESEARCH_DELEGATION_TOTAL_BUDGET_MS =
  RESEARCH_DELEGATION_TIMEOUT_MS + RESEARCH_RETRY_BUDGET_MS;
/**
 * Grace period after the budget fires for the aborted pass to hand back its
 * salvaged tool output. Abort propagation through a model call or fetch is
 * immediate; the cap stops a hung promise from holding the caller past the
 * budget.
 */
const ABORT_SETTLE_GRACE_MS = 500;

/** @returns a promise that resolves (undefined) after ABORT_SETTLE_GRACE_MS */
function settleGrace(): Promise<undefined> {
  return new Promise(resolve => setTimeout(() => resolve(undefined), ABORT_SETTLE_GRACE_MS));
}

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
 * @param ms - TOTAL budget in milliseconds, first pass plus retry (tests inject
 *   a short value); default RESEARCH_DELEGATION_TOTAL_BUDGET_MS (480 s worst
 *   case: 240 s pass + 240 s retry)
 * @returns the delegation result, or `{ ok: false, reason: 'timeout',
 *   detail: '<ms/1000>s' }` when the budget fires first — with `partial: true`
 *   and `findings` when the aborted pass salvaged tool output
 */
export async function runResearchDelegationWithTimeout(
  deps: ResearchDelegationDeps,
  req: ResearchDelegationRequest,
  ms: number = RESEARCH_DELEGATION_TOTAL_BUDGET_MS
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
  const deadline = new Promise<'aborted'>(resolve => {
    const onAbort = () => resolve('aborted');
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (controller.signal.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => controller.abort(), ms);
  });

  const run = runResearchDelegation({ ...deps, signal: controller.signal }, req, ms);
  try {
    const first = await Promise.race([run, deadline]);
    // The run settled on its own: its result stands untouched.
    if (first !== 'aborted') return first;
    // Budget fired. The aborted pass reports the tool output it salvaged
    // (reason 'timeout', findings set) within the grace window; a hung run
    // yields nothing and the bare timeout value stands.
    const settled = await Promise.race([run, settleGrace()]);
    if (settled && settled.ok) return settled;
    if (settled && settled.ok === false) {
      if (settled.reason === 'timeout') {
        // The budget is what ended the run: report the budget, keeping any
        // salvaged tool output.
        return settled.partial
          ? settled.findings
            ? { ok: false, reason: 'timeout', detail: timedOut.detail, partial: true, findings: settled.findings }
            : { ok: false, reason: 'timeout', detail: timedOut.detail, partial: true }
          : timedOut;
      }
      // The run settled inside the grace window with its OWN reason (e.g.
      // 'unverified'): that is the real outcome and must not be overwritten by
      // a bare timeout value.
      return settled;
    }
    return timedOut;
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
