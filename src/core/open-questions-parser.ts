import fs from 'node:fs';

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
 * Cuts a captured question entry at the "Why it matters" explanation marker,
 * if present, and trims leftover markdown bold markers from the tail. Titles
 * must stay short and stable so portal dedupe (by slug) works across turns.
 */
function stripWhyItMatters(qText: string): string {
  const marker = qText.search(/\*{0,2}\s*Why it matters\s*:/i);
  const cut = marker >= 0 ? qText.slice(0, marker) : qText;
  return cut.trim().replace(/\*+$/, '').trim();
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
 * Extracts question items (Q1, Q2, ... format) from a section's text.
 */
function extractQuestionItems(sectionText: string): string[] {
  const questions: string[] = [];
  const qRegex = /(?:^|\n)\s*(?:\*\*)?(?:Q\d+|-\s*\*\*Question)\s*[\.:\)]?\s*\**\s*(.*?)(?=\n\s*(?:\*\*)?(?:Q\d+|-\s*\*\*Question)|\n\s*##|\n\s*$|$)/gs;

  let match;
  while ((match = qRegex.exec(sectionText)) !== null) {
    const qText = stripWhyItMatters(match[1]);
    if (qText && qText.length > 5) {
      questions.push(qText);
    }
  }

  // Fallback: split by numbered lines (Q1., Q2., etc.)
  if (questions.length === 0) {
    const lines = sectionText.split('\n');
    let currentQ = '';
    for (const line of lines) {
      const numberedMatch = line.match(/^\s*(?:\*\*)?(Q\d+|Question\s*\d+)\s*[\.:\)]?\s*\**\s*(.*)/i);
      if (numberedMatch) {
        if (currentQ.trim()) questions.push(stripWhyItMatters(currentQ.trim()));
        currentQ = numberedMatch[2];
      } else if (currentQ && line.trim() && !line.match(/^\s*$/)) {
        currentQ += ' ' + line.trim();
      }
    }
    if (currentQ.trim()) questions.push(stripWhyItMatters(currentQ.trim()));
  }

  return questions.filter(q => q.length > 3);
}

/**
 * Parses open questions from any document containing a "## Open Questions"
 * section (with optional numeric prefix). Works across all specialist documents.
 */
export function parseOpenQuestionsFromContent(docContent: string): string[] {
  const headingMatch = docContent.match(OPEN_QUESTIONS_HEADING);
  if (!headingMatch || headingMatch.index === undefined) return [];

  const afterHeader = docContent.slice(headingMatch.index + headingMatch[0].length);

  // Find the next top-level section (any "## " heading) or end of file
  const nextSectionMatch = afterHeader.match(/\n##\s/);
  const sectionText = nextSectionMatch && nextSectionMatch.index !== undefined
    ? afterHeader.slice(0, nextSectionMatch.index)
    : afterHeader;

  return extractQuestionItems(sectionText);
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
