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
 * Extracts question items (Q1, Q2, ... format) from a section's text.
 */
function extractQuestionItems(sectionText: string): string[] {
  const questions: string[] = [];
  const qRegex = /(?:^|\n)\s*(?:\*\*)?(?:Q\d+|-\s*\*\*Question)\s*[\.:\)]?\s*\**\s*(.*?)(?=\n\s*(?:\*\*)?(?:Q\d+|-\s*\*\*Question)|\n\s*##|\n\s*$|$)/gs;

  let match;
  while ((match = qRegex.exec(sectionText)) !== null) {
    const qText = match[1].trim();
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
        if (currentQ.trim()) questions.push(currentQ.trim());
        currentQ = numberedMatch[2];
      } else if (currentQ && line.trim() && !line.match(/^\s*$/)) {
        currentQ += ' ' + line.trim();
      }
    }
    if (currentQ.trim()) questions.push(currentQ.trim());
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
