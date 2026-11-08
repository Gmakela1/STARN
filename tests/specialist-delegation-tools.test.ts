/**
 * specialist-delegation-tools.test.ts — Verifies the researcher is a single
 * retrieval owner: every specialist can call request_research, only bom also
 * sources directly, and the research side cannot recurse into request_research.
 * Inputs: exported specialist packages, PREFLIGHT_ALLOWED_TOOLS.
 * Outputs: vitest assertions; throws nothing.
 */
import { describe, it, expect } from 'vitest';
import { PREFLIGHT_ALLOWED_TOOLS } from '../src/core/research-preflight.js';
import { architecturePackage } from '../src/specialists/packages/architecture/index.js';
import { bomPackage } from '../src/specialists/packages/bom/index.js';
import { buildSequencePackage } from '../src/specialists/packages/build-sequence/index.js';
import { capabilitiesPackage } from '../src/specialists/packages/capabilities/index.js';
import { changeImpactPackage } from '../src/specialists/packages/change-impact/index.js';
import { conopsPackage } from '../src/specialists/packages/conops/index.js';
import { generalPackage } from '../src/specialists/packages/general/index.js';
import { icdPackage } from '../src/specialists/packages/icd/index.js';
import { milestonesPackage } from '../src/specialists/packages/milestones/index.js';
import { requirementsPackage } from '../src/specialists/packages/requirements/index.js';
import { riskRegisterPackage } from '../src/specialists/packages/risk-register/index.js';
import { rtmPackage } from '../src/specialists/packages/rtm/index.js';
import { sowPackage } from '../src/specialists/packages/sow/index.js';
import { testplansPackage } from '../src/specialists/packages/testplans/index.js';
import { workInstructionsPackage } from '../src/specialists/packages/work-instructions/index.js';

const ALL_PACKAGES = [
  generalPackage,
  conopsPackage,
  architecturePackage,
  icdPackage,
  capabilitiesPackage,
  requirementsPackage,
  bomPackage,
  rtmPackage,
  milestonesPackage,
  testplansPackage,
  sowPackage,
  changeImpactPackage,
  riskRegisterPackage,
  buildSequencePackage,
  workInstructionsPackage
];

describe('Specialist delegation tools', () => {
  it('covers all 15 specialist packages', () => {
    expect(ALL_PACKAGES).toHaveLength(15);
  });

  it('gives every package request_research', () => {
    for (const pkg of ALL_PACKAGES) {
      expect(pkg.allowedTools).toContain('request_research');
    }
  });

  it('keeps direct web sourcing on bom only', () => {
    expect(bomPackage.allowedTools).toContain('web_search');
    expect(bomPackage.allowedTools).toContain('web_fetch');

    for (const pkg of ALL_PACKAGES) {
      if (pkg.id === 'bom') continue;
      expect(pkg.allowedTools).not.toContain('web_search');
      expect(pkg.allowedTools).not.toContain('web_fetch');
    }
  });

  it('does not let the research side recurse into request_research', () => {
    expect(PREFLIGHT_ALLOWED_TOOLS as readonly string[]).not.toContain('request_research');
  });
});
