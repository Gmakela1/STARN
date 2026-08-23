import { select, input } from '@inquirer/prompts';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { CriticResult } from '../core/critic.js';
import { ProjectStateManager } from '../workspace/state.js';
import { extractCleanMarkdownDocument, formatDocumentPreview } from './ui.js';

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

  const isFullDeliverable = specialistId !== 'general' && output.includes('# ');
  const cleanedDoc = isFullDeliverable ? extractCleanMarkdownDocument(output) : output;

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
