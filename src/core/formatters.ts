import fs from 'node:fs';
import path from 'node:path';
import { ProjectState } from '../workspace/types.js';
import { ORDERED_WORKFLOW_PHASES, resolveArtifactPaths } from '../workspace/state.js';
import { countOpenQuestions, parseOpenQuestionsFromContent } from './open-questions-parser.js';

/**
 * Presentation-agnostic formatters for quick-command outputs (/plan, /help,
 * /questions). The core runner uses these headless plain-text versions by
 * default; presentation adapters (terminal CLI) may inject styled versions
 * via TurnOptions.formatters.
 */
export interface TurnFormatters {
  formatWorkflowRoadmap(state: ProjectState, projectPath?: string): string;
  formatHelp(): string;
  formatOpenQuestionsReport(state: ProjectState, projectPath: string): string;
}

export function formatWorkflowRoadmapPlain(state: ProjectState, projectPath?: string): string {
  const activePhase = state.workflow?.activePhase || 'conops';
  const phases = state.workflow?.phases || {};

  let out = `STARN PROJECT WORKFLOW ROADMAP\n`;
  out += `Project: ${state.name} | Active Phase: ${activePhase.toUpperCase()}\n\n`;

  for (let i = 0; i < ORDERED_WORKFLOW_PHASES.length; i++) {
    const phaseDef = ORDERED_WORKFLOW_PHASES[i];
    const info = phases[phaseDef.id] || { status: 'pending', artifactPath: phaseDef.artifactPath };
    const num = `[${i + 1}]`;
    const namePadded = phaseDef.name.padEnd(36);
    const isActive = activePhase === phaseDef.id;

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
      statusLabel = `● APPROVED    (${phaseDef.artifactPath})`;
    } else if (docExists) {
      statusLabel = `◐ DRAFTED     (${phaseDef.artifactPath})`;
      if (isActive) statusLabel += ' — Active Target';
    } else if (isActive) {
      statusLabel = `► IN PROGRESS (Active Target)`;
    } else if (info.status === 'locked') {
      statusLabel = `🔒 LOCKED     (Requires Prerequisite)`;
    } else {
      statusLabel = `○ PENDING`;
    }

    if (openQuestions > 0) {
      statusLabel += `  ⚠ ${openQuestions} OPEN QUESTION${openQuestions === 1 ? '' : 'S'}`;
    }

    out += `${num} ${namePadded} ${statusLabel}\n`;
  }

  out += `\nCommands: /plan (roadmap) | /questions (list open questions) | /goto <phase> (switch phase) | /help (all commands)`;
  return out;
}

export function formatHelpPlain(): string {
  const rows: Array<[string, string]> = [
    ['/plan, /roadmap, /status', 'Show the project workflow roadmap'],
    ['/questions', 'List open questions across all drafted documents'],
    ['/view [doc]', 'Inspect a deliverable in read-only mode (TOC, section, paged)'],
    ['/approve [doc]', 'Manually approve a deliverable and unlock next phase'],
    ['/draft [doc]', 'Revert an approved deliverable to draft (re-locks downstream)'],
    ['/goto <phase>', 'Switch the active phase (number, id, or name fragment)'],
    ['/help', 'Show this command list'],
    ['/compact', 'Summarize older session messages now (free up context)'],
    ['/compact-model', 'Select the model used for session compaction'],
    ['/voice', 'Record your next prompt by voice (type in the prompt input)']
  ];

  let out = `STARN SLASH COMMANDS\n\n`;
  for (const [cmd, desc] of rows) {
    out += `  ${cmd.padEnd(26)} ${desc}\n`;
  }
  out += `\nTip: when a document has open questions, just answer them in your next prompt —`;
  out += `\nthe specialist will incorporate them and update the document in place.`;
  return out;
}

export function formatOpenQuestionsReportPlain(state: ProjectState, projectPath: string): string {
  const activePhase = state.workflow?.activePhase || 'conops';

  let out = `OPEN QUESTIONS ACROSS PROJECT DOCUMENTS\n`;
  out += `Project: ${state.name} | Active Phase: ${activePhase.toUpperCase()}\n`;

  let totalQuestions = 0;

  for (const phaseDef of ORDERED_WORKFLOW_PHASES) {
    const docPaths = resolveArtifactPaths(projectPath, phaseDef.artifactPath);
    for (const docPath of docPaths) {
      try {
        if (!fs.existsSync(docPath)) continue;
        const questions = parseOpenQuestionsFromContent(fs.readFileSync(docPath, 'utf-8'));
        if (questions.length === 0) continue;

        totalQuestions += questions.length;
        out += `\n${phaseDef.name} (${path.basename(docPath)})`;
        for (let i = 0; i < questions.length; i++) {
          out += `\n  Q${i + 1}. ${questions[i].slice(0, 160).replace(/\s+/g, ' ')}`;
        }
        out += '\n';
      } catch {
        // unreadable — skip
      }
    }
  }

  if (totalQuestions === 0) {
    out += `\n✔ No open questions found in any project document.`;
  } else {
    out += `\nTotal: ${totalQuestions} open question(s). Answer them in your next prompt for the active phase,`;
    out += `\nor use /goto <phase> to switch to the phase you want to work on.`;
  }

  return out;
}

export const headlessFormatters: TurnFormatters = {
  formatWorkflowRoadmap: formatWorkflowRoadmapPlain,
  formatHelp: formatHelpPlain,
  formatOpenQuestionsReport: formatOpenQuestionsReportPlain
};
