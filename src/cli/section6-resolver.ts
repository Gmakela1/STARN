import { select, input } from '@inquirer/prompts';
import fs from 'node:fs';
import chalk from 'chalk';

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

export interface CollectedAnswer {
  question: string;
  answer: string;
}

/**
 * Collects answers for a document's open questions interactively.
 * Does NOT write to disk — returns the Q&A pairs so the specialist LLM
 * can incorporate them properly into the document body.
 * Works for ANY specialist document with an Open Questions section.
 *
 * This is the ONLY sanctioned answer-resolution path. Never write answers
 * to disk via regex patching or run resolution after the agent loop — both
 * caused historic data-loss bugs (see tests/section6-data-loss.test.ts).
 */
export async function collectOpenQuestions(options: {
  docPath: string;
  docName?: string;
}): Promise<{
  answers: CollectedAnswer[];
  allAnswered: boolean;
}> {
  const { docPath, docName = 'the document' } = options;

  if (!fs.existsSync(docPath)) {
    return { answers: [], allAnswered: false };
  }

  const content = fs.readFileSync(docPath, 'utf-8');
  const questions = parseOpenQuestionsFromContent(content);

  if (questions.length === 0) {
    return { answers: [], allAnswered: true };
  }

  console.log(chalk.cyan(`\n📋 ${questions.length} open question(s) remain in ${docName}`));
  console.log(chalk.dim('Answering these now will let the specialist properly incorporate them into the document.\n'));

  const proceed = await select({
    message: 'Resolve open questions now?',
    choices: [
      { name: '✅ Yes, walk through each question', value: 'yes' },
      { name: '⏸  Not now — keep them as open items', value: 'no' }
    ]
  });

  if (proceed === 'no') {
    return { answers: [], allAnswered: false };
  }

  const collected: CollectedAnswer[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(chalk.bold(`\n─── Question ${i + 1} of ${questions.length} ───\n`));
    console.log(chalk.white(q));
    console.log();

    const answer = await input({
      message: 'Your answer (or type "skip" to defer):'
    });

    if (answer.trim().toLowerCase() === 'skip') {
      console.log(chalk.dim('Question deferred.\n'));
      continue;
    }

    collected.push({ question: q, answer: answer.trim() });
    console.log(chalk.green('✓ Answer noted.\n'));
  }

  const allAnswered = collected.length === questions.length;
  if (allAnswered) {
    console.log(chalk.green(`\n✔ All ${questions.length} answers collected — the specialist will now incorporate them into the document.\n`));
  } else if (collected.length > 0) {
    console.log(chalk.yellow(`\n⚠ ${collected.length}/${questions.length} questions answered — passing to specialist.\n`));
  }

  return { answers: collected, allAnswered };
}
