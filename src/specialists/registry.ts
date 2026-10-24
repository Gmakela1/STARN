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
