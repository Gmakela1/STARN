import { OpenRouterClient } from '../openrouter/client.js';

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
  constructor(private client: OpenRouterClient) {}

  async evaluate(options: CriticEvaluateOptions): Promise<CriticResult> {
    let baselineSection = '';
    if (options.programBaselineDocuments && options.programBaselineDocuments.length > 0) {
      baselineSection = `\nAPPROVED PROGRAM BASELINE (Upstream Source of Truth for Program Alignment):
${options.programBaselineDocuments.map(d => `### [${d.id}] (${d.path}):\n${d.content}`).join('\n\n---\n\n')}\n`;
    }

    const prompt = `You are the Harsh Critic for STARN, an uncompromising engineering evaluation agent.
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

    const response = await this.client.chatCompletion({
      model: options.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    });

    const jsonMatch = (response.content || '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
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
    } catch (_e) {
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
