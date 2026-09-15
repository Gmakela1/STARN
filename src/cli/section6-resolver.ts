import { select, input } from '@inquirer/prompts';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { ProjectStateManager } from '../workspace/state.js';

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

/**
 * Backward-compatible CONOPS-specific wrapper for collectOpenQuestions.
 */
export async function collectSection6Answers(options: { projectPath: string }): Promise<{
  answers: CollectedAnswer[];
  allAnswered: boolean;
}> {
  return collectOpenQuestions({
    docPath: path.join(options.projectPath, 'docs', 'CONOPS.md'),
    docName: 'CONOPS.md'
  });
}

export interface ResolveSection6Options {
  projectPath: string;
  stateManager: ProjectStateManager;
}

/**
 * Runs an interactive resolution interview for Section 6 questions.
 * Presents each question one at a time, asks the user for an answer,
 * then writes the answer directly into the document by editing it.
 * Returns true if all questions were resolved.
 */
export async function resolveSection6(options: ResolveSection6Options): Promise<{
  allResolved: boolean;
  answeredCount: number;
}> {
  const { projectPath } = options;
  const conopsPath = path.join(projectPath, 'docs', 'CONOPS.md');
  
  if (!fs.existsSync(conopsPath)) {
    return { allResolved: false, answeredCount: 0 };
  }

  const content = fs.readFileSync(conopsPath, 'utf-8');
  const questions = parseSection6Questions(content);

  if (questions.length === 0) {
    return { allResolved: true, answeredCount: 0 };
  }

  console.log(chalk.cyan(`\n📋 ${questions.length} open question(s) remain in Section 6 of CONOPS.md`));
  console.log(chalk.dim('Answering these now will produce a complete, finalized document.\n'));

  const proceed = await select({
    message: 'Resolve open questions now?',
    choices: [
      { name: '✅ Yes, walk through each question', value: 'yes' },
      { name: '⏸  Not now — keep them as open items', value: 'no' }
    ]
  });

  if (proceed === 'no') {
    return { allResolved: false, answeredCount: 0 };
  }

  let answeredCount = 0;
  let currentContent = content;

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

    // Now we need to edit the document to:
    // 1. Fold the answer into the relevant section(s)
    // 2. Remove the question from Section 6
    // We do this by updating currentContent in memory
    currentContent = foldAnswerIntoDoc(currentContent, q, answer.trim());
    answeredCount++;
    console.log(chalk.green('✓ Answer incorporated into document.\n'));
  }

  // Write the final document
  const conopsPathFinal = path.join(projectPath, 'docs', 'CONOPS.md');
  
  // Remove Section 6 entirely if all questions were answered
  if (answeredCount === questions.length) {
    currentContent = removeSection6(currentContent);
  }

  fs.writeFileSync(conopsPathFinal, currentContent, 'utf-8');

  const allResolved = answeredCount === questions.length;
  if (allResolved) {
    console.log(chalk.green(`\n✔ All ${questions.length} questions resolved. Section 6 cleared.`));
  } else {
    console.log(chalk.yellow(`\n⚠ ${answeredCount}/${questions.length} questions answered. ${questions.length - answeredCount} remain in Section 6.`));
  }

  return { allResolved, answeredCount };
}

/**
 * Folds an answer into the document by replacing the answered question in Section 6
 * with a "(Resolved)" annotation and the answer text.
 * When all questions are resolved, Section 6 is removed as a whole.
 */
function foldAnswerIntoDoc(doc: string, question: string, answer: string): string {
  // Find the question in Section 6 by matching the first ~50 chars of the question
  const qKey = question.slice(0, 50).replace(/[*]/g, '\\*');
  
  // Try to find the exact Q-number line first
  const regex = new RegExp(`(\\*\\*Q\\d+\\s*[\\.:]\\s*\\**\\s*)${qKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n\\s*\\*\\*Q\\d+|\\n\\s*##|$)`);
  
  let match = doc.match(regex);
  
  if (!match) {
    // Fallback: find the question by any unique fragment
    const fragment = question.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fallbackRegex = new RegExp(`(\\*\\*Q\\d+\\s*[\\.:]\\s*\\**\\s*)?${fragment}[\\s\\S]*?(?=\\n\\s*\\*\\*Q\\d+|\\n\\s*##|$)`);
    match = doc.match(fallbackRegex);
  }
  
  if (match) {
    const replacement = `**✓ RESOLVED:** ${answer}`;
    return doc.replace(match[0], replacement);
  }
  
  // Last resort: append answer after Section 6
  return doc + `\n\n**✓ RESOLVED (${question.slice(0, 40)}...):** ${answer}\n`;
}

/**
 * Removes Section 6 entirely from the document.
 */
function removeSection6(doc: string): string {
  // Remove the section 6 header and everything up to section 7 (or end)
  const section6Pattern = /\n##\s*6\.?\s*(?:Open Questions|Items for Clarification|Open Questions & Items[\s\S]*?)(?=\n##\s*7\.?\s|\n##\s*5\.?\s|$)/;
  return doc.replace(section6Pattern, '');
}