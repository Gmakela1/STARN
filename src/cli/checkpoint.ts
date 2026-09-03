import { select, input, checkbox } from '@inquirer/prompts';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { CriticResult } from '../core/critic.js';
import { ProjectStateManager } from '../workspace/state.js';
import { formatCriticFindingsTable, extractCleanMarkdownDocument, formatDocumentPreview } from './ui.js';

export interface CheckpointReviewOptions {
  specialistId: string;
  specialistName: string;
  output: string;
  criticResult?: CriticResult;
  projectPath: string;
  stateManager: ProjectStateManager;
}

export type CheckpointAction = 'accept' | 'feedback' | 'override' | 'discard' | 'view_full';

export async function runHumanCheckpoint(
  options: CheckpointReviewOptions
): Promise<{ action: CheckpointAction; feedback?: string }> {
  const { specialistId, specialistName, output, criticResult, projectPath, stateManager } = options;

  // Detect if the response contains a full document (has markdown headers) or is just commentary
  let isFullDeliverable = specialistId !== 'general' && output.includes('# ');
  let cleanedDoc = isFullDeliverable ? extractCleanMarkdownDocument(output) : output;

  // FALLBACK: If the response is just commentary but the LLM wrote the file to disk via fs_write,
  // read the file from disk and use it as the deliverable content.
  if (!isFullDeliverable && specialistId !== 'general') {
    const docName = `${specialistId.toUpperCase()}.md`;
    const filePath = path.join(projectPath, 'docs', docName);
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8').trim();
        if (fileContent && fileContent.startsWith('# ')) {
          cleanedDoc = fileContent;
          isFullDeliverable = true;
        }
      } catch (_e) {
        // ignore read errors
      }
    }
  }

  if (isFullDeliverable) {
    console.log(formatDocumentPreview(cleanedDoc, `${specialistName} (${specialistId.toUpperCase()}.md)`));
  } else {
    console.log(`\n${output}\n`);
  }

  let promptActive = true;
  let finalAction: CheckpointAction = 'accept';
  let userFeedback: string | undefined;

  while (promptActive) {
    const choices: Array<{ name: string; value: CheckpointAction }> = [];

    if (isFullDeliverable) {
      choices.push({ name: '👁  View Full Document in Terminal', value: 'view_full' });
    }

    if (criticResult?.passed) {
      choices.push({ name: '✔  Accept deliverable & save to project docs', value: 'accept' });
      choices.push({ name: '✎  Provide feedback and request revisions', value: 'feedback' });
      choices.push({ name: '✖  Discard / cancel', value: 'discard' });
    } else if (criticResult && !criticResult.passed) {
      choices.push({ name: '✎  Provide guidance and let agent re-try', value: 'feedback' });
      choices.push({ name: '⚡ Override Critic & force accept deliverable', value: 'override' });
      choices.push({ name: '✖  Discard / cancel', value: 'discard' });
    } else {
      // Non-critic / conversational / intake questions
      choices.push({ name: '✔  Proceed / Continue', value: 'accept' });
      choices.push({ name: '✎  Reply / Provide Answer', value: 'feedback' });
    }

    const action = await select({
      message: isFullDeliverable ? 'Deliverable Ready — choose action:' : 'Review Checkpoint:',
      choices
    });

    if (action === 'view_full') {
      console.log(`\n${chalk.bold.underline(`Full ${specialistName} Content:`)}\n`);
      console.log(cleanedDoc);
      console.log(`\n${chalk.dim('─'.repeat(60))}\n`);
      continue; // loop back to menu
    }

    if (action === 'feedback') {
      const feedback = await input({
        message: 'Enter your response / feedback for the agent:'
      });
      userFeedback = feedback;
      finalAction = 'feedback';
      promptActive = false;
      break;
    }

    if (action === 'accept' || action === 'override') {
      if (isFullDeliverable) {
        const docName = `${specialistId.toUpperCase()}.md`;
        const docsDir = path.join(projectPath, 'docs');
        if (!fs.existsSync(docsDir)) {
          fs.mkdirSync(docsDir, { recursive: true });
        }
        const outPath = path.join(docsDir, docName);
        fs.writeFileSync(outPath, cleanedDoc, 'utf-8');

        stateManager.recordArtifact({
          id: specialistId.toUpperCase(),
          title: `${specialistName} Document`,
          path: path.relative(projectPath, outPath).replace(/\\/g, '/'),
          status: 'approved',
          criticScore: criticResult?.score
        });

        console.log(chalk.green(`\n✔ Saved clean deliverable to ${outPath}`));
      }
      finalAction = action;
      promptActive = false;
      break;
    }

    finalAction = action;
    promptActive = false;
  }

  return { action: finalAction, feedback: userFeedback };
}

/**
 * Handles the case where the critic has exhausted auto-revisions (all attempts used, still failing).
 * Shows structured findings and lets the user intervene with per-item actions.
 */
export async function handleCriticFailure(
  criticResult: CriticResult,
  specialistName: string
): Promise<{ action: 'feedback' | 'override' | 'discard'; feedback?: string; dismissedIndices?: number[] }> {
  console.log(formatCriticFindingsTable(criticResult));

  const allItems = criticResult.weaknesses || [];

  const choice = await select({
    message: `The ${specialistName} specialist couldn't resolve all critic findings after auto-revision. Choose action:`, 
    choices: [
      { name: '✎  Provide targeted feedback for specific issues', value: 'feedback' },
      ...(allItems.length > 0
        ? [{ name: '☑  Mark certain issues as acceptable, re-try on rest', value: 'dismiss' }]
        : []),
      { name: '⚡ Override — accept as-is despite critic', value: 'override' },
      { name: '✖  Discard / cancel', value: 'discard' }
    ]
  });

  if (choice === 'override') {
    return { action: 'override' };
  }

  if (choice === 'discard') {
    return { action: 'discard' };
  }

  if (choice === 'dismiss' && allItems.length > 0) {
    const selected = await checkbox({
      message: 'Which issues are acceptable as-is? (unselected items will be sent back for revision):',
      choices: allItems.map((item, i) => ({
        name: item,
        value: i,
        checked: false
      }))
    });

    const dismissedIndices = selected || [];
    const remainingIndices = allItems
      .map((_, i) => i)
      .filter(i => !dismissedIndices.includes(i));

    if (remainingIndices.length === 0) {
      // User dismissed all issues — treat as override
      return { action: 'override' };
    }

    const remainingItems = remainingIndices.map(i => allItems[i]);
    const feedback = `Resolve the remaining critic findings:\n${remainingItems.map((w, i) => `  ${i + 1}. [MAJOR] ${w}`).join('\n')}`;

    return { action: 'feedback', feedback, dismissedIndices };
  }

  // Full feedback
  const feedback = await input({
    message: 'Enter your specific guidance for the specialist:'
  });
  return { action: 'feedback', feedback };
}
