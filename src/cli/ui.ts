import chalk from 'chalk';
import boxen from 'boxen';
import { CriticResult } from '../core/critic.js';
import { ModelOption } from '../openrouter/models.js';

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

  if (verdict.strengths && verdict.strengths.length > 0) {
    out += `${chalk.green('✔ Strengths:')}\n`;
    for (const s of verdict.strengths) {
      out += `  ${chalk.green('•')} ${s}\n`;
    }
  }

  if (verdict.weaknesses && verdict.weaknesses.length > 0) {
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

export function formatModelChoice(model: ModelOption): string {
  const star = model.recommended ? chalk.yellow('★ ') : '  ';
  const nameId = chalk.bold(model.id);
  const metaParts: string[] = [];
  if (model.contextLengthFormatted) {
    metaParts.push(chalk.cyan(model.contextLengthFormatted));
  }
  if (model.pricingFormatted) {
    metaParts.push(chalk.green(model.pricingFormatted));
  }
  const meta = metaParts.length > 0 ? ` [${metaParts.join(' | ')}]` : '';
  const desc = model.description ? ` - ${chalk.dim(model.description.slice(0, 60))}` : '';
  return `${star}${nameId}${meta}${desc}`;
}

export function extractCleanMarkdownDocument(rawText: string): string {
  if (!rawText) return '';

  // If wrapped in markdown code fence (```markdown ... ```)
  const codeBlockMatch = rawText.match(/```(?:markdown|md)?\s*\n([\s\S]*?)\n```/i);
  if (codeBlockMatch && codeBlockMatch[1].trim().startsWith('#')) {
    return codeBlockMatch[1].trim();
  }

  // Find the first top-level header '# '
  const firstHeaderIndex = rawText.indexOf('# ');
  if (firstHeaderIndex !== -1) {
    let doc = rawText.slice(firstHeaderIndex).trim();
    // Strip trailing assistant signoffs if present
    const signoffPatterns = [
      /\n\s*Let me know if you (?:want|need|have)[\s\S]*$/i,
      /\n\s*Please review the above[\s\S]*$/i,
      /\n\s*The deliverable is updated and saved[\s\S]*$/i
    ];
    for (const pattern of signoffPatterns) {
      doc = doc.replace(pattern, '').trim();
    }
    return doc;
  }

  return rawText.trim();
}

export function formatDocumentPreview(content: string, title: string): string {
  const lines = content.split('\n');
  const headings = lines.filter(l => l.startsWith('#')).slice(0, 8);
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  let previewText = `${chalk.bold.cyan(title)}\n`;
  previewText += `${chalk.dim(`Length: ${lines.length} lines (~${wordCount} words)`)}\n\n`;
  previewText += `${chalk.bold('Sections Included:')}\n`;
  for (const h of headings) {
    const indent = h.startsWith('###') ? '    ' : h.startsWith('##') ? '  ' : '';
    previewText += `${indent}${chalk.cyan('•')} ${h.replace(/^#+\s*/, '')}\n`;
  }

  return boxen(previewText, {
    padding: 1,
    margin: { top: 1, bottom: 0, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'cyan',
    title: 'Deliverable Summary',
    titleAlignment: 'left'
  });
}

export function printSectionHeader(title: string): void {
  console.log(`\n${chalk.bold.magenta('═══')} ${chalk.bold.white(title)} ${chalk.bold.magenta('═══')}`);
}
