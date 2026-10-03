import { select, input } from '@inquirer/prompts';
import fs from 'node:fs';
import chalk from 'chalk';
import { parseOpenQuestionsFromContent } from '../core/open-questions-parser.js';

// Headless parsing helpers now live in src/core/open-questions-parser.ts.
// Re-exported here for backward compatibility with existing CLI imports.
export {
  OPEN_QUESTIONS_HEADING,
  parseOpenQuestionsFromContent,
  parseSection6Questions,
  hasUnresolvedQuestions,
  countOpenQuestions
} from '../core/open-questions-parser.js';

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
