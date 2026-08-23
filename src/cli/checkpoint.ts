import { select, input } from '@inquirer/prompts';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { CriticResult } from '../core/critic.js';
import { ProjectStateManager } from '../workspace/state.js';

export interface CheckpointReviewOptions {
  specialistId: string;
  specialistName: string;
  output: string;
  criticResult?: CriticResult;
  projectPath: string;
  stateManager: ProjectStateManager;
}

export type CheckpointAction = 'accept' | 'feedback' | 'override' | 'discard';

export async function runHumanCheckpoint(options: CheckpointReviewOptions): Promise<{ action: CheckpointAction; feedback?: string }> {
  const { specialistId, specialistName, output, criticResult, projectPath, stateManager } = options;

  console.log(`\n${chalk.bold.underline(`Deliverable from ${specialistName}:`)}\n`);
  console.log(output);

  const choices: Array<{ name: string; value: CheckpointAction }> = [];

  if (criticResult?.passed) {
    choices.push({ name: '✔ Accept deliverable & save to project docs', value: 'accept' });
    choices.push({ name: '✎ Provide feedback and request revisions', value: 'feedback' });
    choices.push({ name: '✖ Discard / cancel', value: 'discard' });
  } else if (criticResult && !criticResult.passed) {
    choices.push({ name: '✎ Provide guidance and let agent re-try', value: 'feedback' });
    choices.push({ name: '⚡ Override Critic & force accept deliverable', value: 'override' });
    choices.push({ name: '✖ Discard / cancel', value: 'discard' });
  } else {
    // Non-critic (e.g. general package)
    choices.push({ name: '✔ Done / Acknowledge', value: 'accept' });
    choices.push({ name: '✎ Ask follow-up question', value: 'feedback' });
  }

  const action = await select({
    message: 'Review Checkpoint — what would you like to do?',
    choices
  });

  if (action === 'feedback') {
    const feedback = await input({
      message: 'Enter your specific feedback / instructions for the agent:'
    });
    return { action: 'feedback', feedback };
  }

  if (action === 'accept' || action === 'override') {
    if (specialistId !== 'general') {
      const docName = `${specialistId.toUpperCase()}.md`;
      const docsDir = path.join(projectPath, 'docs');
      if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
      }
      const outPath = path.join(docsDir, docName);
      fs.writeFileSync(outPath, output, 'utf-8');

      stateManager.recordArtifact({
        id: specialistId.toUpperCase(),
        title: `${specialistName} Document`,
        path: path.relative(projectPath, outPath).replace(/\\/g, '/'),
        status: 'approved',
        criticScore: criticResult?.score
      });

      console.log(chalk.green(`\n✔ Saved artifact to ${outPath}`));
    }
  }

  return { action };
}
