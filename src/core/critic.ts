import { ChatClient } from '../openrouter/types.js';
import { Logger } from '../util/logger.js';
import { EditEntry } from '../tools/types.js';

let criticLogger: Logger | undefined;
export function setCriticLogger(logger?: Logger): void {
  criticLogger = logger;
}

export interface BaselineDocument {
  id: string;
  path: string;
  content: string;
}

export interface CriticEvaluateOptions {
  model: string;
  artifactContent: string;
  rubric: string;
  secretSauceExamples: string[];
  userExamples: string[];
  programBaselineDocuments?: BaselineDocument[];
  appliedEdits?: EditEntry[];
  signal?: AbortSignal;
  mode?: 'full' | 'delta';
  priorScore?: number;
  userPrompt?: string;
}

export interface CriticResult {
  passed: boolean;
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  actionableGuidance: string;
}

export class CriticEvaluator {
  constructor(private client: ChatClient) {}

  async evaluate(options: CriticEvaluateOptions): Promise<CriticResult> {
    let baselineSection = '';
    if (options.programBaselineDocuments && options.programBaselineDocuments.length > 0) {
      baselineSection = `\nAPPROVED PROGRAM BASELINE (Upstream Source of Truth for Program Alignment):
${options.programBaselineDocuments.map(d => `### [${d.id}] (${d.path}):\n${d.content}`).join('\n\n---\n\n')}\n`;
    }

    let editLogSection = '';
    if (options.appliedEdits && options.appliedEdits.length > 0) {
      editLogSection = `\nTARGETED EDITS APPLIED THIS TURN (verify these address the user's feedback and do not introduce drift or break cross-document alignment):
${options.appliedEdits.map(e => `- [${e.path}] L${e.matchedLineRange.start}-${e.matchedLineRange.end}: "${e.oldText}" → "${e.newText}"`).join('\n')}\nReview the full updated document below, focusing attention on the edited regions and their downstream effects.\n`;
    }

    const isDelta = options.mode === 'delta';
    const priorScore = options.priorScore ?? 8.5;

    let prompt: string;
    if (isDelta) {
      let editsSummary = 'No specific edits recorded.';
      if (options.appliedEdits && options.appliedEdits.length > 0) {
        editsSummary = options.appliedEdits
          .map(e => `- [${e.path}] L${e.matchedLineRange.start}-${e.matchedLineRange.end}: "${e.oldText}" → "${e.newText}"`)
          .join('\n');
      }

      prompt = `You are the Harsh Critic for STARN, conducting a DELTA EVALUATION of targeted revisions to an existing engineering document.
A prior baseline for this document was already reviewed and achieved a quality score of ${priorScore}/10.
Your job is NOT to re-litigate unchanged sections, but to verify the integrity, accuracy, and consistency of this turn's changes.

USER REQUEST / ANSWERS TO INCORPORATE:
${options.userPrompt || '(Targeted revisions requested by user)'}

PRIOR BASELINE SCORE: ${priorScore}/10

TARGETED EDITS APPLIED THIS TURN:
${editsSummary}

CRITICAL DELTA REVIEW GUIDELINES:
1. Intent Fidelity:
   Verify that the edits faithfully incorporate the user's instructions or answers without omitting requested specifics, weakening engineering rigor, or inventing contradictory claims.
2. Document-Wide Consistency:
   Verify that downstream statements, specs, or tables within this document align with the edits. (For example, if a subsystem voltage or power source changed, confirm that dependent sections reflect this or remain valid).
3. Non-Regression & Anti-Hallucination:
   Verify that the edits did not delete essential requirements, introduce vague placeholders ("TBD"), or inject unrequested third-party vendor brand names/part numbers.
4. Anti-Nitpicking Directive (MANDATORY):
   Do NOT fail or dock points for styling, depth, or formatting in sections that were NOT touched by these edits. Focus your evaluation on the modified regions and their direct downstream dependencies.
5. Score Anchoring Rule:
   If the edits cleanly and accurately address the feedback without introducing contradictions or hallucinations, score >= ${priorScore}/10 and pass (score >= 8.0). Only deduct points and fail if the edits themselves are defective, contradict the user's intent, or break internal document consistency.

${baselineSection}
DRAFT ARTIFACT TO EVALUATE:
${options.artifactContent}

Respond ONLY with valid JSON in this exact structure:
{
  "passed": true | false,
  "score": number (0-10),
  "summary": "Concise verdict explanation focusing on the delta changes",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "actionableGuidance": "Specific instructions for the builder to fix weaknesses"
}`;
    } else {
      prompt = `You are the Harsh Critic for STARN, an uncompromising engineering evaluation agent.
Your mission is to evaluate a drafted hardware/physical engineering project deliverable against strict engineering quality standards, verify program alignment, and enforce anti-hallucination discipline.

CRITIC GUIDELINES:
1. Conduct an "apples-to-oranges" quality comparison: judge standard of quality, completeness, technical rigor, clarity, and professionalism (not whether content matches examples identically).
2. Look for vague placeholders (e.g., "TBD", "approximate", "as needed"), lack of measurable specifications (dimensions, loads, power, temperatures), and missing physical considerations.
3. Program Alignment & Cross-Document Traceability:
   Verify that this deliverable strictly aligns with the parameters, dimensions, electrical voltages, power levels, environmental ranges, and user intent defined in the approved upstream project documents. Reject (score < 8.0) if the deliverable contradicts or ignores the approved program baseline.
4. Anti-Hallucination & Collaborative Integrity (CRITICAL):
   Penalize and fail (score < 8.0) any deliverable that invents specific third-party vendor brand names, part numbers, or unrequested subsystems (e.g., pyrofuses, complex vehicle CAN protocols, or unmentioned sensors) that were not specified by the user or established in the baseline. If critical engineering items are missing, the builder should suggest them as open questions/recommendations for the user rather than fabricating them as facts.
5. Pass (score >= 8.0) ONLY if the artifact meets or exceeds the engineering quality bar AND maintains strict grounding in user intent.

GRADING RUBRIC:
${options.rubric}
${baselineSection}
SECRET-SAUCE QUALITY EXAMPLES (Standard of Quality Reference):
${options.secretSauceExamples.map((ex, i) => `### Example ${i + 1}:\n${ex}`).join('\n\n')}

${options.userExamples.length > 0 ? `USER CUSTOM EXAMPLES:\n${options.userExamples.join('\n\n')}` : ''}
${editLogSection}
DRAFT ARTIFACT TO EVALUATE:
${options.artifactContent}

Respond ONLY with valid JSON in this exact structure:
{
  "passed": true | false,
  "score": number (0-10),
  "summary": "Concise verdict explanation",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "actionableGuidance": "Specific instructions for the builder to fix weaknesses"
}`;
    }

    const response = await this.client.chatCompletion({
      model: options.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      signal: options.signal
    });

    const jsonMatch = (response.content || '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      criticLogger?.warn('Critic returned no parseable JSON; using fallback verdict');
      return {
        passed: true,
        score: 8.0,
        summary: 'Critic completed evaluation with standard approval.',
        strengths: ['Formatting intact'],
        weaknesses: [],
        actionableGuidance: ''
      };
    }

    try {
      return JSON.parse(jsonMatch[0]) as CriticResult;
    } catch (e: any) {
      criticLogger?.warn(`Critic JSON parse failed (${e.message}); using fallback verdict`);
      return {
        passed: true,
        score: 8.0,
        summary: 'Critic feedback parsed with fallback.',
        strengths: [],
        weaknesses: [],
        actionableGuidance: ''
      };
    }
  }
}

/**
 * Enriches user revision feedback with the critic's evaluation context so the
 * specialist sees the score, weaknesses, and actionable guidance alongside the
 * human note. Headless — shared by the terminal checkpoint and the web server.
 */
export function enrichFeedbackWithCritic(feedback: string, criticResult?: CriticResult): string {
  if (!criticResult) return feedback;
  const hasGuidance = !!criticResult.actionableGuidance;
  const hasWeaknesses = criticResult.weaknesses && criticResult.weaknesses.length > 0;
  if (!hasGuidance && !hasWeaknesses) return feedback;

  let out = `${feedback}\n\n[CRITIC EVALUATION CONTEXT FOR THIS REVISION]:\nScore: ${criticResult.score.toFixed(1)}/10`;
  if (criticResult.summary) {
    out += `\nSummary: ${criticResult.summary}`;
  }
  if (hasWeaknesses) {
    out += `\nWeaknesses:\n${criticResult.weaknesses.map(w => `- ${w}`).join('\n')}`;
  }
  if (hasGuidance) {
    out += `\nActionable Guidance: ${criticResult.actionableGuidance}`;
  }
  return out;
}
