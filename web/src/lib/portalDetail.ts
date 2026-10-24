/**
 * §2.1 — Concise question-detail rendering.
 *
 * Verbatim-split only: no paraphrasing, no LLM, no new model calls.
 * The answer dialog is the "read it fully" surface; this helper drives
 * both the QuestionBar card and the AnswerDialog bullets.
 */

export interface RenderDetailResult {
  bullets: string[];
  overflow: number;
  wasTruncated: boolean;
  full: string;
}

const BULLET_MARKER = /^[-*•]\s+/;
const NUMBERED_MARKER = /^\d+\.\s/;
const BULLET_CAP = 4;
const SENTENCE_CUT = 160;
const HARD_CUT = 120;
const PLAIN_LINE_MAX = 140;

/** Capitalize only the first letter (rule 1 normalization). */
function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

export function renderDetail(detail: string): RenderDetailResult {
  const full = detail ?? '';

  // Rule 5 — no detail: one plain line, no bullets.
  if (full.length === 0) {
    return { bullets: [], overflow: 0, wasTruncated: false, full };
  }

  // Rule 1 — already a list? Split on newlines. Any newline present, or any
  // segment starting with a bullet marker, drives per-line bulletization.
  const lines = full.split('\n');
  const looksLikeList =
    lines.length > 1 || lines.some((l) => BULLET_MARKER.test(l) || NUMBERED_MARKER.test(l));

  if (looksLikeList) {
    const bullets: string[] = [];
    let overflow = 0;
    for (const raw of lines) {
      const text = raw.replace(BULLET_MARKER, '').replace(NUMBERED_MARKER, '').trim();
      if (!text) continue;
      if (bullets.length < BULLET_CAP) {
        bullets.push(capitalize(text));
      } else {
        overflow++;
      }
    }
    return { bullets, overflow, wasTruncated: false, full };
  }

  // Rule 2 — clause/sentence split (the normal case).
  const segments = full
    .split(/(?:[.;]\s+|\n+)/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Rule 3 — two or more segments: first 3 become bullets.
  if (segments.length >= 2) {
    const visible = segments.slice(0, 3);
    const lastIdx = visible.length - 1;
    const bullets = visible.map((s, i) => {
      // Hard-cut the final visible bullet if a single sentence runs on.
      if (i === lastIdx && s.length > SENTENCE_CUT) {
        return s.slice(0, HARD_CUT) + '…';
      }
      return s;
    });
    const wasTruncated = bullets[lastIdx] !== visible[lastIdx];
    const overflow = segments.length > 3 ? segments.length - 3 : 0;
    return { bullets, overflow, wasTruncated, full };
  }

  // Rule 4 — single segment: no bullets. Long single sentences are left for
  // the caller to line-clamp and pair with "Show full question".
  if (segments.length === 1) {
    const s = segments[0];
    if (s.length <= PLAIN_LINE_MAX) {
      return { bullets: [], overflow: 0, wasTruncated: false, full };
    }
    return { bullets: [], overflow: 0, wasTruncated: true, full };
  }

  // Rule 5 — nothing left after filtering (only separators): one plain line.
  return { bullets: [], overflow: 0, wasTruncated: false, full };
}