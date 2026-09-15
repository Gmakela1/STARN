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
    this.applyOpenQuestionsRules();
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
