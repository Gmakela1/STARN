import chalk from 'chalk';
import boxen from 'boxen';
import fs from 'node:fs';
import path from 'node:path';
import { CriticResult } from '../core/critic.js';
import { ModelOption } from '../openrouter/models.js';
import { ProjectState } from '../workspace/types.js';
import { ORDERED_WORKFLOW_PHASES, resolveArtifactPaths } from '../workspace/state.js';
import { countOpenQuestions, parseOpenQuestionsFromContent } from './section6-resolver.js';

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return `${tokens}`;
}

/**
 * Context gauge for the active-session header. Shows current context size
 * relative to the compaction threshold, colored by pressure, plus the
 * configured compaction model.
 */
export function formatContextGauge(tokens: number, threshold: number, compactionModel?: string): string {
  const pct = threshold > 0 ? Math.round((tokens / threshold) * 100) : 0;
  const bar = pct > 80 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
  const modelLabel = compactionModel ? ` · Compact: ${compactionModel}` : '';
  return bar(`Context: ${formatTokenCount(tokens)}/${formatTokenCount(threshold)}${modelLabel}`);
}

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

export function formatCompactCriticPass(verdict: CriticResult): string {
  const fixedNote = verdict.weaknesses.length > 0
    ? ` — ${verdict.weaknesses.length} issue(s) auto-fixed`
    : '';
  return chalk.green(`✓ Critic approved (${verdict.score.toFixed(1)}/10)${fixedNote}`);
}

export function formatCriticFindingsTable(verdict: CriticResult): string {
  let out = chalk.bold.bgYellow.black(' CRITIC REVISION EXHAUSTED ') + '\n\n';
  out += `Score: ${chalk.bold(verdict.score.toFixed(1))}/10\n`;
  out += `${chalk.dim(verdict.summary)}\n\n`;

  const allItems = (verdict.weaknesses || []).map(w => ({ severity: 'MAJOR' as const, text: w }));

  if (allItems.length > 0) {
    out += chalk.bold('Findings:') + '\n';
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      const severityTag = item.severity === 'MAJOR'
        ? chalk.bgRed.black(' MAJOR ')
        : chalk.bgYellow.black(' MINOR ');
      out += `  ${i + 1}. ${severityTag} ${item.text}\n`;
    }
  }

  if (verdict.actionableGuidance) {
    out += `\n${chalk.cyan('Guidance:')} ${verdict.actionableGuidance}\n`;
  }

  return boxen(out, {
    padding: 1,
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: 'single',
    borderColor: 'yellow',
    title: 'Critic Review (Failed After Auto-Revision)',
    titleAlignment: 'left'
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

export function formatWorkflowRoadmap(state: ProjectState, projectPath?: string): string {
  const activePhase = state.workflow?.activePhase || 'conops';
  const phases = state.workflow?.phases || {};

  let out = `${chalk.bold.cyan('STARN PROJECT WORKFLOW ROADMAP')}\n`;
  out += `${chalk.dim(`Project: ${state.name} | Active Phase: ${activePhase.toUpperCase()}`)}\n\n`;

  for (let i = 0; i < ORDERED_WORKFLOW_PHASES.length; i++) {
    const phaseDef = ORDERED_WORKFLOW_PHASES[i];
    const info = phases[phaseDef.id] || { status: 'pending', artifactPath: phaseDef.artifactPath };
    const num = `[${i + 1}]`;
    const namePadded = phaseDef.name.padEnd(36);

    const isActive = activePhase === phaseDef.id;

    // Scan the doc on disk (if projectPath given): drafted? open questions?
    let docExists = false;
    let openQuestions = 0;
    if (projectPath) {
      const docPaths = resolveArtifactPaths(projectPath, phaseDef.artifactPath);
      for (const p of docPaths) {
        openQuestions += countOpenQuestions(p);
        try {
          if (fs.existsSync(p) && fs.readFileSync(p, 'utf-8').trim().length > 0) {
            docExists = true;
          }
        } catch {
          // unreadable — treat as missing
        }
      }
    }

    let statusLabel = '';
    if (info.status === 'approved') {
      statusLabel = chalk.green('● APPROVED   ') + chalk.dim(`(${phaseDef.artifactPath})`);
    } else if (docExists) {
      statusLabel = chalk.magenta('◐ DRAFTED    ') + chalk.dim(`(${phaseDef.artifactPath})`);
      if (isActive) statusLabel += chalk.bold.cyan(' — Active Target');
    } else if (isActive) {
      statusLabel = chalk.bold.cyan('► IN PROGRESS') + chalk.white(' (Active Target)');
    } else if (info.status === 'locked') {
      statusLabel = chalk.yellow('🔒 LOCKED    ') + chalk.dim(`(Requires Prerequisite)`);
    } else {
      statusLabel = chalk.dim('○ PENDING');
    }

    if (openQuestions > 0) {
      statusLabel += chalk.yellow(`  ⚠ ${openQuestions} OPEN QUESTION${openQuestions === 1 ? '' : 'S'}`);
    }

    const row = `${chalk.bold(num)} ${namePadded} ${statusLabel}`;
    out += (isActive ? chalk.bgHex('#1f2937')(row) : row) + '\n';
  }

  out += `\n${chalk.dim('Commands: /plan (roadmap) | /questions (list open questions) | /goto <phase> (switch phase) | /help (all commands)')}`;

  return boxen(out, {
    padding: 1,
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'cyan'
  });
}

export function formatHelp(): string {
  const rows: Array<[string, string]> = [
    ['/plan, /roadmap, /status', 'Show the project workflow roadmap'],
    ['/questions', 'List open questions across all drafted documents'],
    ['/goto <phase>', 'Switch the active phase (number, id, or name fragment)'],
    ['/help', 'Show this command list'],
    ['/compact', 'Summarize older session messages now (free up context)'],
    ['/compact-model', 'Select the model used for session compaction'],
    ['/voice', 'Record your next prompt by voice (type in the prompt input)']
  ];

  let out = `${chalk.bold.cyan('STARN SLASH COMMANDS')}\n\n`;
  for (const [cmd, desc] of rows) {
    out += `  ${chalk.bold.green(cmd.padEnd(26))} ${desc}\n`;
  }
  out += `\n${chalk.dim('Tip: when a document has open questions, just answer them in your next prompt —')}`;
  out += `\n${chalk.dim('the specialist will incorporate them and update the document in place.')}`;

  return boxen(out, {
    padding: 1,
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'green'
  });
}

export function formatOpenQuestionsReport(state: ProjectState, projectPath: string): string {
  const activePhase = state.workflow?.activePhase || 'conops';

  let out = `${chalk.bold.cyan('OPEN QUESTIONS ACROSS PROJECT DOCUMENTS')}\n`;
  out += `${chalk.dim(`Project: ${state.name} | Active Phase: ${activePhase.toUpperCase()}`)}\n`;

  let totalQuestions = 0;

  for (const phaseDef of ORDERED_WORKFLOW_PHASES) {
    const docPaths = resolveArtifactPaths(projectPath, phaseDef.artifactPath);
    for (const docPath of docPaths) {
      try {
        if (!fs.existsSync(docPath)) continue;
        const questions = parseOpenQuestionsFromContent(fs.readFileSync(docPath, 'utf-8'));
        if (questions.length === 0) continue;

        totalQuestions += questions.length;
        out += `\n${chalk.bold.magenta(phaseDef.name)} ${chalk.dim(`(${path.basename(docPath)})`)}`;
        for (let i = 0; i < questions.length; i++) {
          out += `\n  ${chalk.yellow(`Q${i + 1}.`)} ${questions[i].slice(0, 160).replace(/\s+/g, ' ')}`;
        }
        out += '\n';
      } catch {
        // unreadable — skip
      }
    }
  }

  if (totalQuestions === 0) {
    out += `\n${chalk.green('✔ No open questions found in any project document.')}`;
  } else {
    out += `\n${chalk.dim(`Total: ${totalQuestions} open question(s). Answer them in your next prompt for the active phase,`)}`;
    out += `\n${chalk.dim(`or use /goto <phase> to switch to the phase you want to work on.`)}`;
  }

  return boxen(out, {
    padding: 1,
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'yellow'
  });
}

export function printSectionHeader(title: string): void {
  console.log(`\n${chalk.bold.magenta('═══')} ${chalk.bold.white(title)} ${chalk.bold.magenta('═══')}`);
}
