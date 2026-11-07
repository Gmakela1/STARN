import fs from 'node:fs';
import path from 'node:path';
import { capQuestionsPerDoc } from '../specialists/open-questions.js';
import { PENDING_INCORPORATION_MARKER } from './incorporation-prompt.js';

/**
 * Headless open-questions parsing utilities. Used by both the core runner
 * (roadmap/questions reports) and the CLI's interactive resolver. Must not
 * import terminal libraries.
 */

/**
 * Matches an "Open Questions" section heading, optionally numbered.
 * Examples: "## 6. Open Questions & Items for Clarification", "## Open Questions", "## 4. Open Questions"
 */
export const OPEN_QUESTIONS_HEADING = /^##\s*(?:\d+\.?\s*)?Open Questions.*$/im;

/**
 * Format-v2 labeled sections of a decision-memo question entry (rules text in
 * src/specialists/open-questions.ts). All fields optional — legacy single-line
 * entries parse with no sections; legacy "Why it matters:" entries map that
 * explanation to `background`. Mirrored in web/src/types/api.ts.
 */
export interface QuestionSections {
  /** BLUF — one-sentence recommendation up front. */
  bluf?: string;
  /** Research findings incl. cited source names. */
  findings?: string;
  /** Main suggestion: recommended option + its trade-off. */
  suggestion?: string;
  /** Alternatives, each with its trade-off. */
  alternatives?: string;
  /** Cost/impact of deferring this decision. */
  defer?: string;
  /** Legacy alias: "Why it matters:" maps here. */
  background?: string;
}

/** One parsed question entry: the title (the parse/dedupe key) plus optional v2 sections. */
export interface ParsedQuestionItem {
  title: string;
  /**
   * The header text BEFORE the header contract cut it (section labels already
   * removed). Equals `title` when nothing was cut. Two consumers: callers
   * persist it as meta.originalTitle so portal dedupe keeps keying on the
   * untrimmed header (questionSlug over a trimmed title would merge entries
   * that differ only after the "?"), and the string API
   * (parseOpenQuestionsFromContent / parseSection6Questions) returns it so the
   * CLI Section 6 resolver shows the user the whole question.
   */
  rawTitle: string;
  sections?: QuestionSections;
}

type QuestionSectionKey = keyof QuestionSections;

/** Labeled-section matchers. The five v2 labels are line-anchored (they start
 * their own line in the decision-memo format); the legacy "Why it matters"
 * alias may sit mid-line, matching the original strip rule. */
const SECTION_LABEL_MATCHERS: Array<{ key: QuestionSectionKey; re: RegExp }> = [
  { key: 'bluf', re: /^[ \t]*(?:\*\*)?[ \t]*BLUF[ \t]*:[ \t]*/im },
  { key: 'findings', re: /^[ \t]*(?:\*\*)?[ \t]*(?:Research[ \t]+findings|Findings)[ \t]*:[ \t]*/im },
  { key: 'suggestion', re: /^[ \t]*(?:\*\*)?[ \t]*(?:Main[ \t]+suggestion|Suggestion)[ \t]*:[ \t]*/im },
  { key: 'alternatives', re: /^[ \t]*(?:\*\*)?[ \t]*Alternatives[ \t]*:[ \t]*/im },
  { key: 'defer', re: /^[ \t]*(?:\*\*)?[ \t]*Defer[ \t]*:[ \t]*/im },
  { key: 'background', re: /\*{0,2}[ \t]*Why it matters[ \t]*:[ \t]*/i }
];

/**
 * Extracts the optional labeled sections (BLUF / Research findings / Main
 * suggestion / Alternatives / Defer; legacy "Why it matters" → background)
 * from a captured question entry. Tolerant: missing sections stay undefined;
 * each value runs from its label to the next label (in text order) or the end.
 * Returns undefined when no labeled section is present.
 */
export function extractQuestionSections(entryText: string): QuestionSections | undefined {
  const hits: Array<{ key: QuestionSectionKey; start: number; bodyStart: number }> = [];
  for (const { key, re } of SECTION_LABEL_MATCHERS) {
    const match = entryText.match(re);
    if (match && match.index !== undefined) {
      hits.push({ key, start: match.index, bodyStart: match.index + match[0].length });
    }
  }
  if (hits.length === 0) return undefined;
  hits.sort((a, b) => a.start - b.start);
  const sections: QuestionSections = {};
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : entryText.length;
    const value = entryText.slice(hits[i].bodyStart, end).trim().replace(/^\*+/, '').replace(/\*+$/, '').trim();
    if (value) sections[hits[i].key] = value;
  }
  return Object.keys(sections).length > 0 ? sections : undefined;
}

/**
 * Format-v2 header contract: the bold header line carries ONLY the question
 * (`**Qn. [TOPIC] <short question>**`). Headers longer than this are cut at
 * the first sentence boundary so the title never becomes a wall of text.
 * Mirrors the prompt rule in src/specialists/open-questions.ts.
 *
 * Deliberately LONGER than the 60-char display cap in research-gate's
 * shortResearchTitle: this is the authoring budget the model is told to meet,
 * the 60-char cap is the card-title display budget for legacy/over-long
 * headers. A legitimate 61–90-char question is authored correctly here and
 * still ellipsis-cut on the card — intended, not a bug.
 */
export const QUESTION_HEADER_CHAR_CAP = 90;

/**
 * Words allowed after a "?" before the tail counts as trailing explanation
 * (e.g. "Main bus voltage?** Because the load profile…") and is dropped.
 */
const HEADER_TAIL_WORD_LIMIT = 8;

/**
 * Index of the first genuine sentence boundary in `text`, searched within the
 * first `window` chars — abbreviation-safe, so "No. 6 AWG", "e.g. ", "i.e. ",
 * "vs. " and "approx. " are NOT boundaries.
 *
 * A boundary is (i) `?` or `!` followed by whitespace, or (ii) `.` followed by
 * whitespace and then an UPPERCASE letter, where the token before the `.` is
 * at least 3 chars and holds no interior `.` (that excludes "No." / "vs." and
 * every dotted abbreviation such as "e.g." / "i.e.").
 *
 * @param text - text to scan
 * @param window - how many leading chars of `text` to scan
 * @returns the index OF the punctuation char (inclusive); -1 when none
 */
export function firstSentenceEnd(text: string, window: number): number {
  const limit = Math.min(window, text.length);
  for (let i = 0; i < limit; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '?' && ch !== '!') continue;
    const after = text.slice(i + 1);
    const gap = after.match(/^\s+/);
    if (!gap) continue; // no trailing whitespace → end of text, not a boundary
    if (ch === '.') {
      const next = after.slice(gap[0].length, gap[0].length + 1);
      if (!/[A-Z]/.test(next)) continue;
      const token = text.slice(0, i).match(/(\S*)$/)?.[1] ?? '';
      if (token.length < 3 || token.includes('.')) continue;
    }
    return i;
  }
  return -1;
}

/** Header contract applied to one captured header. */
interface HeaderContract {
  /** The contract title (markdown bold markers trimmed). */
  title: string;
  /** The header text as captured, before any cut. */
  rawTitle: string;
  /** Text the contract cut off (trailing explanation), when any. */
  droppedTail?: string;
}

/**
 * Enforces the format-v2 header contract on a captured header: drops a trailing
 * explanation after the first "?" when it runs longer than
 * HEADER_TAIL_WORD_LIMIT words, and — for a header over
 * QUESTION_HEADER_CHAR_CAP chars — cuts at the first sentence boundary
 * (firstSentenceEnd: abbreviation-safe). A tail that itself contains a "?"
 * (a quoted value such as "?node=main", or a two-question header) is never
 * dropped: the first "?" is then not the end of the question. A header that
 * is one long question with no interior sentence boundary is kept whole, and a
 * header with no sentence boundary is left intact. The cut text is returned as
 * droppedTail so callers can keep it retrievable.
 *
 * @param rawHeader - the captured header text (section labels already cut)
 * @returns title + rawTitle + the dropped tail when a cut happened
 */
function applyHeaderContract(rawHeader: string): HeaderContract {
  let text = rawHeader.trim();
  const rawTitle = text;
  let droppedTail: string | undefined;
  const questionMark = text.indexOf('?');
  if (questionMark >= 0) {
    const tail = text.slice(questionMark + 1).trim();
    // Pure markdown-bold tokens are not words (off-by-one on the threshold).
    const tailWords = tail.split(/\s+/).filter(token => token.replace(/\*+/g, '') !== '').length;
    if (tailWords > HEADER_TAIL_WORD_LIMIT && !tail.includes('?')) {
      text = text.slice(0, questionMark + 1);
      droppedTail = tail;
    }
  }
  if (text.length > QUESTION_HEADER_CHAR_CAP) {
    const end = firstSentenceEnd(text, text.length);
    if (end >= 0) {
      const cutTail = text.slice(end + 1).trim();
      text = text.slice(0, end + 1);
      if (cutTail) droppedTail = droppedTail ? `${droppedTail} ${cutTail}` : cutTail;
    }
  }
  return {
    title: text.trim().replace(/\*+$/, '').trim(),
    rawTitle,
    ...(droppedTail ? { droppedTail } : {})
  };
}

/**
 * Keeps header text the contract cut retrievable: merges it into the entry's
 * background section (never delete user-visible content).
 */
function withDroppedTail(
  sections: QuestionSections | undefined,
  droppedTail: string | undefined
): QuestionSections | undefined {
  if (!droppedTail) return sections;
  const background = sections?.background ? `${sections.background} ${droppedTail}` : droppedTail;
  return { ...(sections || {}), background };
}

/**
 * Cuts a captured question entry at the first labeled-section marker — the
 * legacy "Why it matters" explanation (may sit mid-line, matching the original
 * strip rule) or a line-anchored format-v2 section label (BLUF, Research
 * findings, Main suggestion, Alternatives, Defer) — and trims leftover
 * markdown bold markers from the tail. Titles must stay short and stable so
 * portal dedupe (by slug) works across turns.
 */
function stripWhyItMatters(qText: string): string {
  let cut = qText.search(/\*{0,2}\s*Why it matters\s*:/i);
  for (const { re } of SECTION_LABEL_MATCHERS) {
    const match = qText.match(re);
    if (match && match.index !== undefined && (cut < 0 || match.index < cut)) cut = match.index;
  }
  const sliced = cut >= 0 ? qText.slice(0, cut) : qText;
  return sliced.trim().replace(/\*+$/, '').trim();
}

/**
 * Stable identity for a question title: strips the leading "Qn." numbering and
 * any "Why it matters" explanation, lowercases, replaces punctuation with
 * spaces, collapses whitespace, and keeps only the first 10 words. Wording
 * variants of the same question map to the same slug.
 */
export function questionSlug(title: string): string {
  const stripped = title
    .replace(/^\s*(?:\*\*)?\s*Q\d+\s*[\.:\)]?\s*\**\s*/i, '')
    .replace(/\*{0,2}\s*Why it matters[\s\S]*$/i, '');
  return stripped
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 10)
    .join(' ');
}

/**
 * Extracts the optional ICD-system topic tag from a question title and
 * returns it lowercased/normalized (whitespace/underscores → hyphen), e.g.
 * "**Q3. [ELECTRICAL] Pilot diameter.**" → "electrical". Tolerant: a missing
 * tag (older docs, untagged questions) yields undefined; an unknown tag still
 * yields its normalized value so callers can bucket it as "Other".
 */
export function questionTopic(title: string): string | undefined {
  const match = title.match(/^\s*(?:\*\*)?\s*(?:Q\d+\s*[.:)]?\s*\**\s*)?\[([^\]]{1,40})\]/);
  if (!match) return undefined;
  return match[1].trim().toLowerCase().replace(/[\s_]+/g, '-') || undefined;
}

/**
 * Keyword lists per ICD-system topic for inferQuestionTopic. Keys are the
 * QUESTION_TOPICS values. Entries in SHORT_TOPIC_TOKENS must match as whole
 * words (optional plural "s"); all other entries match at a word start
 * (prefix), so "volt" covers "voltage" and "mount" covers "mounting".
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  electrical: ['fuse', 'vdc', 'volt', 'amp', 'current', 'battery', 'pack', 'charge', 'lifepo4', 'lithium', 'cell', 'bms', 'contactor', 'breaker', 'wiring', 'circuit', 'insulation', 'isolation', 'kw', 'ah'],
  mechanical: ['bolt', 'mount', 'bracket', 'chassis', 'torque', 'gearbox', 'drivetrain', 'frame', 'shaft', 'coupling', 'weight', 'dimension', 'clearance', 'hitch', 'fastener', 'housing', 'bore', 'flange'],
  'controls-data': ['can', 'dbc', 'firmware', 'telemetry', 'sensor', 'protocol', 'throttle', 'ecu', 'signal', 'logging', 'interlock', 'controller model', 'calibration', 'parameter'],
  thermal: ['temperature', 'thermal', 'cooling', 'heat', 'derating', 'coolant', 'ambient', '°c']
};

const SHORT_TOPIC_TOKENS = new Set(['can', 'amp', 'ah', 'kw', 'bms', 'ecu', 'cell', 'pack', 'current', 'frame']);

/** Minimum distinct keyword hits the winning topic needs before it is trusted. */
const MIN_TOPIC_SCORE = 2;

/**
 * Deterministic keyword inference of the ICD-system topic from free text
 * (title + BLUF). Used only when a question carries no bracket tag: the
 * winning topic must have at least MIN_TOPIC_SCORE distinct keyword hits AND
 * strictly more than the runner-up; otherwise undefined (conservative — no
 * guess, the item stays under "Other").
 */
export function inferQuestionTopic(text: string): string | undefined {
  const haystack = text.toLowerCase();
  let best: string | undefined;
  let bestScore = 0;
  let runnerUp = 0;
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      let hit: boolean;
      if (keyword === '°c') {
        hit = haystack.includes(keyword);
      } else if (SHORT_TOPIC_TOKENS.has(keyword)) {
        hit = new RegExp(`\\b${keyword}s?(?![\\w'])`).test(haystack);
      } else {
        hit = new RegExp(`\\b${keyword}`).test(haystack);
      }
      if (hit) score++;
    }
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      best = topic;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  if (!best || bestScore < MIN_TOPIC_SCORE || bestScore <= runnerUp) return undefined;
  return best;
}

/**
 * Extracts question entries (Q1, Q2, ... format) from a section's text as
 * { title, rawTitle, sections? } entries: the title is the stable parse key
 * (section labels and any trailing header explanation cut — see
 * applyHeaderContract); rawTitle keeps that explanation so the string API can
 * hand the user the whole question; sections are the optional format-v2
 * labeled fields extracted tolerantly from the entry body. Missing sections
 * are omitted (legacy entries parse exactly as before).
 */
function extractQuestionEntries(sectionText: string): ParsedQuestionItem[] {
  const entries: ParsedQuestionItem[] = [];
  // Entry boundary: a "Qn."/- "**Question" line, optionally behind a numbered
  // sub-list prefix ("1. **Q2. …") — parked-doc Section 6 bodies sometimes use
  // numbered sub-lists, and without the "\d+. " variant in BOTH the start
  // pattern and the lookahead the second numbered question gets glued into
  // the first entry's title as one blob.
  // The numeric prefix is only allowed when followed by the bold marker
  // ((?=\*\*)) so bare finding lines like "1. Q3 2024 revenue" / "2. Q4
  // results" inside a body are not entry boundaries.
  const qRegex = /(?:^|\n)\s*(?:\d+\.\s*(?=\*\*))?(?:\*\*)?(?:Q\d+|-\s*\*\*Question)\s*[\.:\)]?\s*\**\s*(.*?)(?=\n\s*(?:\d+\.\s*(?=\*\*))?(?:\*\*)?(?:Q\d+|-\s*\*\*Question)|\n\s*##|\n\s*$|$)/gs;

  let match;
  while ((match = qRegex.exec(sectionText)) !== null) {
    const header = applyHeaderContract(stripWhyItMatters(match[1]));
    if (header.title && header.title.length > 5) {
      entries.push({
        title: header.title,
        rawTitle: header.rawTitle,
        sections: withDroppedTail(extractQuestionSections(match[1]), header.droppedTail)
      });
    }
  }

  // Fallback: split by numbered lines (Q1., Q2., etc.)
  if (entries.length === 0) {
    const lines = sectionText.split('\n');
    let currentQ = '';
    for (const line of lines) {
      const numberedMatch = line.match(/^\s*(?:\*\*)?(Q\d+|Question\s*\d+)\s*[\.:\)]?\s*\**\s*(.*)/i);
      if (numberedMatch) {
        if (currentQ.trim()) {
          const header = applyHeaderContract(stripWhyItMatters(currentQ.trim()));
          if (header.title) {
            entries.push({
              title: header.title,
              rawTitle: header.rawTitle,
              sections: withDroppedTail(extractQuestionSections(currentQ.trim()), header.droppedTail)
            });
          }
        }
        currentQ = numberedMatch[2];
      } else if (currentQ && line.trim() && !line.match(/^\s*$/)) {
        currentQ += ' ' + line.trim();
      }
    }
    if (currentQ.trim()) {
      const header = applyHeaderContract(stripWhyItMatters(currentQ.trim()));
      if (header.title) {
        entries.push({
          title: header.title,
          rawTitle: header.rawTitle,
          sections: withDroppedTail(extractQuestionSections(currentQ.trim()), header.droppedTail)
        });
      }
    }
  }

  return entries.filter(e => e.title.length > 3);
}

/**
 * Parses open questions from any document containing a "## Open Questions"
 * section (with optional numeric prefix) as { title, sections? } entries —
 * the format-v2 sections (see QuestionSections) are extracted tolerantly.
 */
export function parseOpenQuestionEntries(docContent: string): ParsedQuestionItem[] {
  const headingMatch = docContent.match(OPEN_QUESTIONS_HEADING);
  if (!headingMatch || headingMatch.index === undefined) return [];

  const afterHeader = docContent.slice(headingMatch.index + headingMatch[0].length);

  // Find the next top-level section (any "## " heading) or end of file
  const nextSectionMatch = afterHeader.match(/\n##\s/);
  const sectionText = nextSectionMatch && nextSectionMatch.index !== undefined
    ? afterHeader.slice(0, nextSectionMatch.index)
    : afterHeader;

  return extractQuestionEntries(sectionText);
}

/**
 * Parses open questions from any document containing a "## Open Questions"
 * section (with optional numeric prefix). Works across all specialist documents.
 *
 * Returns the FULL question text (entry.rawTitle), not the header-contract
 * title: the CLI Section 6 resolver reads this to prompt the user, and the
 * user needs the explanation the contract cut from the portal title.
 */
export function parseOpenQuestionsFromContent(docContent: string): string[] {
  return parseOpenQuestionEntries(docContent).map(entry => entry.rawTitle);
}

/**
 * Backward-compatible alias — parses Section 6 (Open Questions) from a CONOPS document.
 */
export function parseSection6Questions(docContent: string): string[] {
  return parseOpenQuestionsFromContent(docContent);
}

/**
 * Checks whether a document has unresolved open questions.
 */
export function hasUnresolvedQuestions(docPath: string): boolean {
  return countOpenQuestions(docPath) > 0;
}

/**
 * Counts open questions in a document file. Returns 0 if the file
 * doesn't exist or has no Open Questions section.
 */
export function countOpenQuestions(docPath: string): number {
  try {
    const content = fs.readFileSync(docPath, 'utf-8');
    return parseOpenQuestionsFromContent(content).length;
  } catch {
    return 0;
  }
}

/**
 * Heading of the upstream-question context block injected into the specialist
 * system prompt by the runner (T3 pre-turn question injection). Exported for
 * tests that assert on the exact block text.
 */
export const UPSTREAM_OPEN_QUESTIONS_HEADING = '## UPSTREAM OPEN QUESTIONS (ALREADY TRACKED — DO NOT RE-ASK)';

/** Hard character cap for the whole injected upstream block (prompt-size guard). */
const UPSTREAM_BLOCK_CHAR_CAP = 6000;
/** Per-doc char cap for extracted pending-answers text (ALREADY ANSWERED case). */
const ANSWERED_BLOCK_CHAR_CAP = 800;

/**
 * Builds the upstream open-questions context block for a specialist turn:
 * every OTHER document's open questions (they are already tracked upstream,
 * so this deliverable must not re-ask them) plus any pending user answers
 * (unincorporated '## User Answers (Pending Incorporation)' blocks) surfaced
 * as PREVIOUSLY ANSWERED context so the no-re-ask rule fires.
 *
 * Pure-ish (fs reads only, no LLM calls). Reads docs/*.md under projectPath,
 * excluding the current deliverable document; docs without an Open Questions
 * section contribute nothing (that is the "specialist doc" filter).
 *
 * @param projectPath - absolute project root
 * @param currentDocPath - absolute path of the current deliverable doc (excluded)
 * @returns the block string, '' when nothing upstream is open or unreadable.
 *          Bounded to UPSTREAM_BLOCK_CHAR_CAP chars: QUESTION_CAP_PER_DOC
 *          slug-style titles per doc, no question bodies.
 */
export function buildUpstreamQuestionContext(projectPath: string, currentDocPath: string): string {
  const docsDir = path.join(projectPath, 'docs');
  let files: string[];
  try {
    files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return '';
  }
  const currentAbs = path.resolve(currentDocPath);

  const openSections: string[] = [];
  const answeredSections: string[] = [];
  for (const file of files) {
    const docPath = path.join(docsDir, file);
    if (path.resolve(docPath) === currentAbs) continue;
    let content: string;
    try {
      content = fs.readFileSync(docPath, 'utf-8');
    } catch {
      continue;
    }

    // Short (header-contract) titles, not the untrimmed raw headers: this
    // block is a prompt-size-bounded re-ask guard, so it carries slugs only.
    const questions = capQuestionsPerDoc(parseOpenQuestionEntries(content)).map(entry => entry.title);
    if (questions.length > 0) {
      const items = questions.map((q, i) => {
        const topic = questionTopic(q);
        // Drop the bracket tag BEFORE slugging: questionSlug removes
        // punctuation, so the tag text would otherwise leak into the title.
        const untagged = topic ? q.replace(/^\s*(?:\*\*)?\s*(?:Q\d+\s*[.:)]?\s*\**\s*)?\[[^\]]*\]\s*/, '') : q;
        return `- Q${i + 1}${topic ? ` [${topic}]` : ''}: ${questionSlug(untagged)}`;
      }).join('\n');
      openSections.push(`### docs/${file}\n${items}`);
    }

    // Pending answers ARE settled user decisions awaiting incorporation in the
    // upstream doc — surface them as PREVIOUSLY ANSWERED context (literal
    // trigger phrase required by the no-re-ask rule). Full answer-history
    // extraction lives with the T5 preflight package.
    const pendingIdx = content.indexOf(PENDING_INCORPORATION_MARKER);
    if (pendingIdx >= 0) {
      let afterMarker = content.slice(pendingIdx + PENDING_INCORPORATION_MARKER.length);
      const nextHeading = afterMarker.match(/^#{1,6} /m);
      if (nextHeading && nextHeading.index !== undefined) {
        afterMarker = afterMarker.slice(0, nextHeading.index);
      }
      const answersText = afterMarker.trim();
      if (answersText) {
        const truncated = answersText.length > ANSWERED_BLOCK_CHAR_CAP
          ? answersText.slice(0, ANSWERED_BLOCK_CHAR_CAP) + '…'
          : answersText;
        answeredSections.push(`### docs/${file}\n${truncated}`);
      }
    }
  }

  if (openSections.length === 0 && answeredSections.length === 0) return '';

  let block = UPSTREAM_OPEN_QUESTIONS_HEADING + '\n' +
    'These questions are ALREADY TRACKED in upstream documents. Do NOT restate or re-ask them in your Open Questions section. If your deliverable depends on them, reference them as dependencies (e.g. depends on Requirements Q3).\n';
  if (answeredSections.length > 0) {
    block += '\nALREADY ANSWERED (TREAT AS SETTLED — DO NOT RE-OPEN) — PREVIOUSLY ANSWERED context from upstream docs:\n' +
      answeredSections.join('\n') + '\n';
  }
  if (openSections.length > 0) {
    block += '\nSTILL OPEN (TRACKED — DO NOT RE-ASK):\n' + openSections.join('\n') + '\n';
  }

  // Hard cap: drop whole lines from the end until the block fits.
  while (block.length > UPSTREAM_BLOCK_CHAR_CAP && block.includes('\n')) {
    block = block.slice(0, block.lastIndexOf('\n')) + '\n';
  }
  return block.length > UPSTREAM_BLOCK_CHAR_CAP ? '' : block;
}
