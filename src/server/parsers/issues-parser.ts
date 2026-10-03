import { ParsedWorkInstruction } from './actions-parser.js';

/**
 * Aggregates hardware non-conformances (flagged in work instructions) and
 * open builder questions (parsed from project documents) into the unified
 * issue list surfaced by the Questions & Issues tab.
 */

export interface ProjectIssue {
  id: string;
  type: 'non_conformance' | 'open_question';
  title: string;
  description: string;
  /** Source document path or work instruction file. */
  source: string;
  evidence?: string;
  subsystem?: string;
  actionId?: string;
}

export interface OpenQuestionGroup {
  phase: string;
  file: string;
  questions: string[];
}

export interface ProjectIssuesSummary {
  issues: ProjectIssue[];
  nonConformanceCount: number;
  openQuestionCount: number;
}

export function aggregateProjectIssues(
  workInstructions: ParsedWorkInstruction[],
  openQuestions: OpenQuestionGroup[]
): ProjectIssuesSummary {
  const issues: ProjectIssue[] = [];

  for (const wi of workInstructions) {
    const flag = wi.nonConformance.flagStatus.trim().toUpperCase();
    if (flag !== 'OPEN_NON_CONFORMANCE') continue;
    issues.push({
      id: `nc-${wi.actionId.toLowerCase()}`,
      type: 'non_conformance',
      title: `Hardware Non-Conformance: ${wi.actionId} — ${wi.title}`,
      description: wi.nonConformance.defectDescription,
      source: wi.fileName ?? wi.actionId,
      evidence: wi.nonConformance.defectEvidence || undefined,
      subsystem: wi.subsystem || undefined,
      actionId: wi.actionId
    });
  }

  let questionCount = 0;
  for (const group of openQuestions) {
    for (let i = 0; i < group.questions.length; i++) {
      questionCount++;
      issues.push({
        id: `q-${group.phase.toLowerCase()}-${i + 1}`,
        type: 'open_question',
        title: `Open Question (${group.phase})`,
        description: group.questions[i],
        source: group.file
      });
    }
  }

  return {
    issues,
    nonConformanceCount: issues.filter(i => i.type === 'non_conformance').length,
    openQuestionCount: questionCount
  };
}
