import chalk from 'chalk';
import boxen from 'boxen';
import { CriticResult } from '../core/critic.js';

export function formatBanner(): string {
  const content = `${chalk.bold.cyan('★ STARN ★')}
${chalk.gray('AI Project Management for Physical & Hardware Engineering')}
${chalk.dim('Process Discipline • Specialist Packages • Harsh Critic Gating')}`;

  return boxen(content, {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'cyan',
    textAlignment: 'center'
  });
}

export function formatCriticScorecard(verdict: CriticResult): string {
  const statusBadge = verdict.passed
    ? chalk.bold.bgGreen.black(' CRITIC PASSED ')
    : chalk.bold.bgYellow.black(' CRITIC REVISION NEEDED ');

  const scoreText = chalk.bold.white(`Score: ${verdict.score.toFixed(1)}/10`);
  let out = `\n${statusBadge} ${scoreText}\n\n`;
  out += `${chalk.bold('Summary:')} ${verdict.summary}\n\n`;

  if (verdict.strengths.length > 0) {
    out += `${chalk.green('✔ Strengths:')}\n`;
    for (const s of verdict.strengths) {
      out += `  ${chalk.green('•')} ${s}\n`;
    }
  }

  if (verdict.weaknesses.length > 0) {
    out += `\n${chalk.yellow('▲ Weaknesses / Findings:')}\n`;
    for (const w of verdict.weaknesses) {
      out += `  ${chalk.yellow('•')} ${w}\n`;
    }
  }

  if (verdict.actionableGuidance) {
    out += `\n${chalk.cyan('Actionable Guidance:')} ${verdict.actionableGuidance}\n`;
  }

  return boxen(out, {
    padding: 1,
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: 'single',
    borderColor: verdict.passed ? 'green' : 'yellow',
    title: 'Harsh Critic Review',
    titleAlignment: 'left'
  });
}

export function printSectionHeader(title: string): void {
  console.log(`\n${chalk.bold.magenta('═══')} ${chalk.bold.white(title)} ${chalk.bold.magenta('═══')}`);
}
