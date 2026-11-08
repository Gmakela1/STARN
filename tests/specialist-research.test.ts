/**
 * specialist-research.test.ts — Enforces the research-delegation contract.
 * Inputs: the exported specialist packages.
 * Outputs: vitest assertions; throws nothing.
 * Contract: BOM sources directly (web_search + web_fetch). Architecture and ICD
 * delegate via request_research and hold no web tools. Upstream packages hold
 * neither web tool.
 */
import { describe, it, expect } from 'vitest';
import { architecturePackage } from '../src/specialists/packages/architecture/index.js';
import { icdPackage } from '../src/specialists/packages/icd/index.js';
import { bomPackage } from '../src/specialists/packages/bom/index.js';
import { conopsPackage } from '../src/specialists/packages/conops/index.js';
import { requirementsPackage } from '../src/specialists/packages/requirements/index.js';
import { milestonesPackage } from '../src/specialists/packages/milestones/index.js';
import { buildSequencePackage } from '../src/specialists/packages/build-sequence/index.js';

describe('Research ownership: BOM sources directly, Architecture and ICD delegate', () => {
  it('scopes web_search and web_fetch strictly to bom, and requires request_research on every package', () => {
    // Authorized to source directly: bom only.
    expect(bomPackage.allowedTools).toContain('web_search');
    expect(bomPackage.allowedTools).toContain('web_fetch');

    // Delegating specialists: no web tools, but they can request research.
    expect(architecturePackage.allowedTools).not.toContain('web_search');
    expect(architecturePackage.allowedTools).not.toContain('web_fetch');
    expect(architecturePackage.allowedTools).toContain('request_research');

    expect(icdPackage.allowedTools).not.toContain('web_search');
    expect(icdPackage.allowedTools).not.toContain('web_fetch');
    expect(icdPackage.allowedTools).toContain('request_research');

    // Strictly blocked for other specialists
    expect(conopsPackage.allowedTools).not.toContain('web_search');
    expect(conopsPackage.allowedTools).not.toContain('web_fetch');

    expect(requirementsPackage.allowedTools).not.toContain('web_search');
    expect(requirementsPackage.allowedTools).not.toContain('web_fetch');

    expect(milestonesPackage.allowedTools).not.toContain('web_search');
    expect(milestonesPackage.allowedTools).not.toContain('web_fetch');

    expect(buildSequencePackage.allowedTools).not.toContain('web_search');
    expect(buildSequencePackage.allowedTools).not.toContain('web_fetch');

    for (const pkg of [
      bomPackage,
      architecturePackage,
      icdPackage,
      conopsPackage,
      requirementsPackage,
      milestonesPackage,
      buildSequencePackage
    ]) {
      expect(pkg.allowedTools).toContain('request_research');
    }
  });

  it('architecture systemPrompt delegates protocol grounding to request_research and requires citations', () => {
    const prompt = architecturePackage.systemPrompt;
    expect(prompt).toMatch(/request_research/);
    expect(prompt).toMatch(/reference/i);
    expect(prompt).toMatch(/cite|citation/i);
  });

  it('icd systemPrompt delegates pinout, wire gauge (AWG), and connector grounding to request_research with citations', () => {
    const prompt = icdPackage.systemPrompt;
    expect(prompt).toMatch(/request_research/);
    expect(prompt).toMatch(/pinout/i);
    expect(prompt).toMatch(/wire|gauge|awg/i);
    expect(prompt).toMatch(/cite|citation/i);
  });
});
