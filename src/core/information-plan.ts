/**
 * information-plan.ts — parse a specialist's information plan out of its reply.
 *
 * Purpose: turn the "INFORMATION PLAN" prose a specialist writes before
 * drafting (appended by `SpecialistRegistry.applyInformationPlanRule`) into the
 * structured `plan` autopilot event. It reuses the `ScopingPlan.infoNeeds`
 * vocabulary (core/research-preflight.ts) instead of inventing a second one:
 * one line per claim, either `KNOWN: <source>` or
 * `UNKNOWN: <question> → likely in <where>`.
 *
 * Core-safe: pure string parsing, no I/O, no imports from tools/server/cli.
 */

/** One claim line of the information plan (infoNeed vocabulary). */
export interface PlanClaim {
  /** What the document claims (or needs to know), as written after the list marker. */
  claim: string;
  /** 'known' when the claim is settled by a document, else 'unknown'. */
  status: 'known' | 'unknown';
  /** status === 'known': the document/section that settles the claim. */
  source?: string;
  /** status === 'unknown': the exact question to delegate to the researcher. */
  question?: string;
  /** status === 'unknown': where the answer likely lives (path, vendor page, standard). */
  likelyAt?: string;
}

/** Parsed information plan: the document order plus the per-claim status. */
export interface InformationPlan {
  /** Non-claim plan items: what the document will contain, in order. */
  order: string[];
  /** Every KNOWN/UNKNOWN line, in written order. */
  claims: PlanClaim[];
}

/** Plan-block heading: "INFORMATION PLAN" (drafting specialists) or "INFORMATION NEEDED" (no-workflow packages). */
const BLOCK_HEADER = /INFORMATION\s+(?:PLAN|NEEDED)/i;

/**
 * `<claim> — KNOWN: <source>` / `<claim> — UNKNOWN: <question> → likely in <where>`.
 * Separator may be an em dash, en dash, hyphen or colon; a leading list marker
 * (`-`, `*`, `•`, `1.`, `1)`) and markdown bold markers are optional.
 */
const CLAIM_LINE = /^\s*(?:(?:[-*•])|(?:\d+[.)]))?\s*\**\s*(.+?)\s*\**\s*(?:—|–|-|:)\s*\**\s*(KNOWN|UNKNOWN)\s*\**\s*:\s*\**\s*(.*)$/i;

/** Trailing "→ likely in <where>" (also `-> likely in` / `=> likely in`). */
const LIKELY_AT = /^(.*?)\s*(?:→|->|=>)\s*likely\s+in\s*:?\s*(.+)$/i;

/** A list item line (used for the document order). */
const LIST_LINE = /^\s*(?:(?:[-*•])|(?:\d+[.)]))\s+(.+)$/;

/** Removes markdown bold/italic markers from a parsed fragment. */
function stripBold(value: string): string {
  return value.replace(/\*\*/g, '').replace(/__/g, '');
}

/**
 * Parses one line as a plan claim.
 *
 * @param line - a single line of the model's reply
 * @returns the claim, or null when the line is not a KNOWN/UNKNOWN line
 */
function parseClaimLine(line: string): PlanClaim | null {
  const m = line.match(CLAIM_LINE);
  if (!m) return null;
  const claim = stripBold(m[1]).trim();
  if (!claim) return null;
  const rest = stripBold(m[3]).trim();
  if (m[2].toUpperCase() === 'KNOWN') {
    return rest ? { claim, status: 'known', source: rest } : { claim, status: 'known' };
  }
  const likely = rest.match(LIKELY_AT);
  const question = (likely ? likely[1] : rest).trim();
  const likelyAt = likely ? likely[2].trim() : '';
  const out: PlanClaim = { claim, status: 'unknown' };
  if (question) out.question = question;
  if (likelyAt) out.likelyAt = likelyAt;
  return out;
}

/**
 * Parses the information plan out of a drafting reply or document.
 *
 * The plan region starts at an "INFORMATION PLAN" / "INFORMATION NEEDED"
 * heading and ends at the next markdown heading. When no such heading exists,
 * the whole text is scanned tolerantly (models often drop the heading). Only
 * lines that carry a KNOWN/UNKNOWN marker count as claims; other list items in
 * the region form the document `order`.
 *
 * @param text - the model's reply (final response) or document content
 * @returns the parsed plan, or null when no claim line is present
 */
export function parseInformationPlan(text: string): InformationPlan | null {
  if (!text || !text.trim()) return null;
  const lines = text.split('\n');

  const start = lines.findIndex(line => BLOCK_HEADER.test(line));
  let region = lines;
  if (start >= 0) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
    region = lines.slice(start + 1, end);
  }

  const claims: PlanClaim[] = [];
  const order: string[] = [];
  for (const line of region) {
    const claim = parseClaimLine(line);
    if (claim) {
      claims.push(claim);
      continue;
    }
    const item = line.match(LIST_LINE);
    if (item) {
      const text = stripBold(item[1]).trim();
      if (text) order.push(text);
    }
  }

  if (claims.length === 0) return null;
  return { order, claims };
}