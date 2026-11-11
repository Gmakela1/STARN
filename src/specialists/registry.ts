import { SpecialistPackage } from './types.js';
import { OPEN_QUESTIONS_SECTION_RULES } from './open-questions.js';
import { generalPackage } from './packages/general/index.js';
import { conopsPackage } from './packages/conops/index.js';
import { architecturePackage } from './packages/architecture/index.js';
import { icdPackage } from './packages/icd/index.js';
import { capabilitiesPackage } from './packages/capabilities/index.js';
import { requirementsPackage } from './packages/requirements/index.js';
import { bomPackage } from './packages/bom/index.js';
import { rtmPackage } from './packages/rtm/index.js';
import { milestonesPackage } from './packages/milestones/index.js';
import { testplansPackage } from './packages/testplans/index.js';
import { sowPackage } from './packages/sow/index.js';
import { changeImpactPackage } from './packages/change-impact/index.js';
import { riskRegisterPackage } from './packages/risk-register/index.js';
import { buildSequencePackage } from './packages/build-sequence/index.js';
import { workInstructionsPackage } from './packages/work-instructions/index.js';

export class SpecialistRegistry {
  private specialists: Map<string, SpecialistPackage> = new Map();

  constructor() {
    this.register(generalPackage);
    this.register(conopsPackage);
    this.register(architecturePackage);
    this.register(icdPackage);
    this.register(capabilitiesPackage);
    this.register(requirementsPackage);
    this.register(bomPackage);
    this.register(rtmPackage);
    this.register(milestonesPackage);
    this.register(testplansPackage);
    this.register(sowPackage);
    this.register(changeImpactPackage);
    this.register(riskRegisterPackage);
    this.register(buildSequencePackage);
    this.register(workInstructionsPackage);
    this.applyOpenQuestionsRules();
    this.applyReferenceInspectionRules();
    this.applyDocumentOutputRules();
    this.applyInformationPlanRule();
  }

  /**
   * Appends the information-plan rule: before drafting, the specialist must
   * state which claims it knows (and from where) and which it does not, so the
   * unknown ones can be delegated with request_research instead of invented.
   *
   * Drafting packages already carry the `DISCOVERY, PLANNING & EXECUTION
   * WORKFLOW` step; the rule extends that running plan. Packages without the
   * workflow (conops, general, change-impact) get the information-only variant.
   * Appends only — the existing workflow text is asserted by tests with
   * `toContain`, so it is never rewritten.
   */
  private applyInformationPlanRule(): void {
    const BODY = `Before the first write, extend your plan with the information it depends on:
  - <claim> — KNOWN: <doc> §<section>
  - <claim> — UNKNOWN: <the exact question> → likely in <file path | vendor page | standard>
Every UNKNOWN line must be resolved before you draft: call request_research once per UNKNOWN, in the order written, up to three calls. Batch related gaps into ONE question rather than spending a call each. When the fact is a value plotted on a curve in a project PDF (typically a manufacturer sheet under reference/), call request_research with the \`chart\` form (file plus the x and y axis labels and ranges) instead of a plain question: about a second, source-graded and marked unverified. Declare ONE axis at a time and correct the declaration when the tool names the axes the page actually has. A claim you cannot verify and did not research must be written as provisional, not stated as fact.`;
    const PLAN_HEADING = 'INFORMATION PLAN (MANDATORY, part of the running plan):';
    const NEEDED_HEADING = 'INFORMATION NEEDED (MANDATORY):';
    for (const pkg of this.specialists.values()) {
      const hasWorkflow = pkg.systemPrompt.includes('DISCOVERY, PLANNING & EXECUTION WORKFLOW');
      const heading = hasWorkflow ? PLAN_HEADING : NEEDED_HEADING;
      if (pkg.systemPrompt.includes(heading)) continue;
      pkg.systemPrompt = `${pkg.systemPrompt}\n\n${heading}\n${BODY}`;
    }
  }

  /**
   * Appends reference-document inspection instructions to packages that have
   * doc_transcribe in their allowed tools. This ensures the model checks the
   * reference/ directory for scanned PDFs and transcribes them during drafting.
   */
  private applyReferenceInspectionRules(): void {
    const RULE = `
## Reference Document Inspection
Before drafting, use \`fs_list\` to check whether a \`reference/\` directory exists in the project root. If it does, inspect each file there via \`fs_read\` — scanned PDFs will be automatically transcribed so you can read their content (manuals, datasheets, technical drawings). Incorporate any specifications, constraints, or parameters from these reference documents into your deliverable.`;
    for (const pkg of this.specialists.values()) {
      if (pkg.id === 'general' || pkg.id === 'change-impact') continue;
      if (!pkg.allowedTools.includes('doc_transcribe')) continue;
      if (pkg.systemPrompt.includes('## Reference Document Inspection')) continue;
      pkg.systemPrompt = `${pkg.systemPrompt}
${RULE}`;
    }
  }

  /**
   * Appends a mandatory document output format instruction to every specialist
   * that produces artifacts. This ensures the model writes to disk and returns
   * the full document content, not commentary.
   */
  private applyDocumentOutputRules(): void {
    const RULE = `
## Document Output Format (MANDATORY)
You MUST write the deliverable to the correct file path using the \`fs_write\` tool. Your text response MUST be the COMPLETE document content starting with a level-1 heading (# Title). Do NOT return commentary, summaries, placeholders, or messages like "I have drafted the document" instead of the document itself. If you use any other tools first (fs_read, state_read, etc.), you MUST still call fs_write at the end to produce the deliverable file. A document that exists only in your response text but not on disk will be treated as empty and rejected by the critic.`;
    for (const pkg of this.specialists.values()) {
      if (pkg.id === 'general' || pkg.id === 'change-impact') continue;
      if (pkg.systemPrompt.includes('## Document Output Format')) continue;
      pkg.systemPrompt = `${pkg.systemPrompt}
${RULE}`;
    }
  }

  /**
   * Appends the shared Open Questions section rules to every specialist's
   * system prompt. CONOPS is excluded (it defines richer, document-specific
   * Section 6 rules) and general is excluded (not a document specialist).
   */
  private applyOpenQuestionsRules(): void {
    for (const pkg of this.specialists.values()) {
      if (pkg.id === 'general' || pkg.id === 'conops') continue;
      if (pkg.systemPrompt.includes('OPEN QUESTIONS SECTION (MANDATORY)')) continue;
      pkg.systemPrompt = `${pkg.systemPrompt}\n\n${OPEN_QUESTIONS_SECTION_RULES}`;
    }
  }

  public register(pkg: SpecialistPackage): void {
    this.specialists.set(pkg.id, pkg);
  }

  public get(id: string): SpecialistPackage | undefined {
    return this.specialists.get(id);
  }

  public listSpecialists(): SpecialistPackage[] {
    return Array.from(this.specialists.values());
  }
}
