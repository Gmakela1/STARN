import { SpecialistPackage } from './types.js';
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
