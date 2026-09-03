import { select, input } from '@inquirer/prompts';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { ProjectStateManager } from '../workspace/state.js';

/**
 * Parses Section 6 (Open Questions & Items for Clarification) from a CONOPS document.
 * Returns an array of question strings.
 */
export function parseSection6Questions(docContent: string): string[] {
  // Find Section 6 — look for "## 6." or "## 6 " or "## 6." header
  const section6Match = docContent.match(/##\s*6\.?\s*(?:Open Questions|Items for Clarification|Open Questions & Items)/);
  if (!section6Match) return [];

  const afterHeader = docContent.slice(section6Match.index! + section6Match[0].length);
  
  // Find the next section (## 7 or end of file)
  const nextSectionMatch = afterHeader.match(/##\s*\d+\.?\s/);
  const section6Text = nextSectionMatch
    ? afterHeader.slice(0, nextSectionMatch.index!)
    : afterHeader;

  // Extract numbered questions (Q1, Q2, or 1., 2., or **Q1. etc.)
  const questions: string[] = [];
  const qRegex = /(?:^|\n)\s*(?:\*\*)?(?:Q\d+|-\s*\*\*Question)\s*[\.:\)]?\s*\**\s*(.*?)(?=\n\s*(?:\*\*)?(?:Q\d+|-\s*\*\*Question)|\n\s*##|\n\s*$)/gs;
  
  let match;
  while ((match = qRegex.exec(section6Text)) !== null) {
    const qText = match[1].trim();
    if (qText && qText.length > 5) {
      questions.push(qText);
    }
  }

  // Fallback: split by numbered lines (Q1., Q2., etc.)
  if (questions.length === 0) {
    const lines = section6Text.split('\n');
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
 * Checks whether a CONOPS document has unresolved Section 6 questions.
 */
export function hasUnresolvedQuestions(docPath: string): boolean {
  try {
    const content = fs.readFileSync(docPath, 'utf-8');
    const questions = parseSection6Questions(content);
    return questions.length > 0;
  } catch {
    return false;
  }
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