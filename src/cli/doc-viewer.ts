import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import boxen from 'boxen';
import { select } from '@inquirer/prompts';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES, WorkflowPhaseDef } from '../workspace/state.js';
import { formatDocumentToc, extractSections } from './ui.js';

export function resolveDocTarget(
  targetArg: string,
  phases: WorkflowPhaseDef[] = ORDERED_WORKFLOW_PHASES
): WorkflowPhaseDef | undefined {
  const trimmed = targetArg.trim().toLowerCase();
  if (!trimmed) return undefined;

  // 1. By phase number (e.g. "1", "2")
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= phases.length) {
    return phases[num - 1];
  }

  // 2. By exact id (e.g. "conops", "risk-register")
  const byId = phases.find(p => p.id.toLowerCase() === trimmed);
  if (byId) return byId;

  // 3. By normalized id (ignoring dashes/underscores)
  const normTarget = trimmed.replace(/[-_]/g, '');
  const byNormId = phases.find(p => p.id.replace(/[-_]/g, '').toLowerCase() === normTarget);
  if (byNormId) return byNormId;

  // 4. By substring in phase name (e.g. "risk", "tractor", "architecture")
  const byName = phases.find(p => p.name.toLowerCase().includes(trimmed));
  if (byName) return byName;

  return undefined;
}

export interface ViewerHeaderOptions {
  title: string;
  relativePath: string;
  status: string;
  criticScore?: number;
  lineCount?: number;
}

export function formatViewerHeader(options: ViewerHeaderOptions): string {
  const statusColor = options.status === 'approved' ? chalk.green.bold : chalk.yellow.bold;
  const statusBadge = statusColor(`[${options.status.toUpperCase()}]`);
  const scoreText = options.criticScore ? chalk.cyan(`Critic Score: ${options.criticScore.toFixed(1)}/10`) : chalk.dim('No score recorded');
  const linesText = options.lineCount !== undefined ? chalk.dim(`${options.lineCount} lines`) : '';

  const content = `${chalk.bold.white(options.title)} ${statusBadge}\n` +
    `${chalk.dim('Path:')} ${chalk.white(options.relativePath)}   ${scoreText}   ${linesText}`;

  return boxen(content, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: options.status === 'approved' ? 'green' : 'yellow',
    title: 'STARN Document Viewer (Read-Only)',
    titleAlignment: 'left'
  });
}

export async function runDocumentViewer(options: {
  projectPath: string;
  stateManager: ProjectStateManager;
  targetArg?: string;
}): Promise<void> {
  const { projectPath, stateManager, targetArg } = options;
  const state = stateManager.getState();

  let targetPhase: WorkflowPhaseDef | undefined;

  if (targetArg && targetArg.trim().length > 0) {
    targetPhase = resolveDocTarget(targetArg);
    if (!targetPhase) {
      console.log(chalk.yellow(`\n⚠ Unknown document/phase: "${targetArg}".`));
      console.log(chalk.dim('Use a phase number (1-12), phase ID (e.g. "conops", "bom"), or name fragment (e.g. "risk").\n'));
      return;
    }
  } else {
    // Interactive selection from workflow phases
    const choices = ORDERED_WORKFLOW_PHASES.map((phase, idx) => {
      const art = state.artifacts.find(a => a.id.toUpperCase() === phase.id.toUpperCase());
      const diskPath = path.join(projectPath, phase.artifactPath);
      const exists = fs.existsSync(diskPath);

      let statusTag: string;
      if (art?.status === 'approved') {
        statusTag = chalk.green('● APPROVED');
      } else if (exists) {
        statusTag = chalk.yellow('◐ DRAFT');
      } else {
        statusTag = chalk.dim('○ MISSING');
      }

      return {
        name: `${String(idx + 1).padStart(2, ' ')}. ${phase.name.padEnd(28)} ${statusTag}`,
        value: phase.id
      };
    });

    choices.push({
      name: chalk.dim('↩ Back / Cancel'),
      value: '__cancel__'
    });

    const selectedId = await select({
      message: 'Select a document to inspect (read-only):',
      choices
    });

    if (selectedId === '__cancel__') {
      return;
    }

    targetPhase = ORDERED_WORKFLOW_PHASES.find(p => p.id === selectedId);
  }

  if (!targetPhase) return;

  const diskPath = path.join(projectPath, targetPhase.artifactPath);
  if (!fs.existsSync(diskPath)) {
    console.log(chalk.yellow(`\n⚠ Document [${targetPhase.name}] does not exist on disk yet at ${targetPhase.artifactPath}.`));
    console.log(chalk.dim(`Switch to phase [${targetPhase.id}] to draft it with an AI specialist.\n`));
    return;
  }

  const rawContent = fs.readFileSync(diskPath, 'utf-8');
  const lines = rawContent.split('\n');
  const artifactRecord = state.artifacts.find(a => a.id.toUpperCase() === targetPhase!.id.toUpperCase());
  const status = artifactRecord?.status || 'draft';
  const criticScore = artifactRecord?.criticScore;

  let viewing = true;

  while (viewing) {
    console.log(formatViewerHeader({
      title: targetPhase.name,
      relativePath: targetPhase.artifactPath,
      status,
      criticScore,
      lineCount: lines.length
    }));

    const choice = await select({
      message: 'Document View Mode:',
      choices: [
        { name: '▶ Browse by Section', value: 'section' },
        { name: '📖 View Full Document (Paged)', value: 'paged' },
        { name: '📑 View Table of Contents (TOC)', value: 'toc' },
        { name: '↩ Exit Viewer', value: 'exit' }
      ]
    });

    if (choice === 'exit') {
      viewing = false;
      break;
    }

    if (choice === 'toc') {
      console.log(`\n${chalk.bold('Table of Contents:')}`);
      console.log(formatDocumentToc(rawContent));
      console.log(`\n${chalk.dim('─'.repeat(60))}\n`);
      continue;
    }

    if (choice === 'paged') {
      const pageSize = Math.max(20, process.stdout.rows ? process.stdout.rows - 5 : 40);
      let offset = 0;
      while (offset < lines.length) {
        const slice = lines.slice(offset, offset + pageSize);
        console.log(slice.join('\n'));
        offset += pageSize;
        if (offset < lines.length) {
          const next = await select({
            message: `Lines ${offset}/${lines.length}:`,
            choices: [
              { name: '▶ Next page', value: 'next' },
              { name: '⏭ Skip to end', value: 'skip' },
              { name: '↩ Back to document menu', value: 'back' }
            ]
          });
          if (next === 'skip') offset = lines.length;
          if (next === 'back') break;
        }
      }
      console.log(`\n${chalk.dim('─'.repeat(60))}\n`);
      continue;
    }

    if (choice === 'section') {
      const sections = extractSections(rawContent);
      const sectionNames = Object.keys(sections);

      if (sectionNames.length === 0) {
        console.log(chalk.dim('\n(No ## headings found in this document.)\n'));
        continue;
      }

      const sectionChoice = await select({
        message: 'Select a section to read:',
        choices: [
          ...sectionNames.map(s => ({ name: s, value: s })),
          { name: chalk.dim('↩ Back'), value: '__back__' }
        ]
      });

      if (sectionChoice !== '__back__') {
        console.log(`\n${chalk.bold.cyan(`## ${sectionChoice}`)}`);
        console.log(sections[sectionChoice]);
        console.log(`\n${chalk.dim('─'.repeat(60))}\n`);
      }
      continue;
    }
  }
}
