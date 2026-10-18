import { describe, it, expect } from 'vitest';
import { architecturePackage } from '../src/specialists/packages/architecture/index.js';
import { icdPackage } from '../src/specialists/packages/icd/index.js';
import { conopsPackage } from '../src/specialists/packages/conops/index.js';
import { requirementsPackage } from '../src/specialists/packages/requirements/index.js';
import { milestonesPackage } from '../src/specialists/packages/milestones/index.js';
import { buildSequencePackage } from '../src/specialists/packages/build-sequence/index.js';

describe('Grounded Technical Research & Scoping for Architecture and ICD', () => {
  it('scopes web_search and web_fetch strictly to architecture and icd, not other upstream packages', () => {
    // Authorized
    expect(architecturePackage.allowedTools).toContain('web_search');
    expect(architecturePackage.allowedTools).toContain('web_fetch');

    expect(icdPackage.allowedTools).toContain('web_search');
    expect(icdPackage.allowedTools).toContain('web_fetch');

    // Strictly blocked for other specialists
    expect(conopsPackage.allowedTools).not.toContain('web_search');
    expect(conopsPackage.allowedTools).not.toContain('web_fetch');

    expect(requirementsPackage.allowedTools).not.toContain('web_search');
    expect(requirementsPackage.allowedTools).not.toContain('web_fetch');

    expect(milestonesPackage.allowedTools).not.toContain('web_search');
    expect(milestonesPackage.allowedTools).not.toContain('web_fetch');

    expect(buildSequencePackage.allowedTools).not.toContain('web_search');
    expect(buildSequencePackage.allowedTools).not.toContain('web_fetch');
  });

  it('architecture systemPrompt requires technical grounding and citations for hardware specs', () => {
    const prompt = architecturePackage.systemPrompt;
    expect(prompt).toMatch(/web_search/i);
    expect(prompt).toMatch(/reference/i);
    expect(prompt).toMatch(/cite|citation/i);
  });

  it('icd systemPrompt requires physical pinout, wire gauge (AWG), and connector grounding with citations', () => {
    const prompt = icdPackage.systemPrompt;
    expect(prompt).toMatch(/web_search/i);
    expect(prompt).toMatch(/pinout/i);
    expect(prompt).toMatch(/wire|gauge|awg/i);
    expect(prompt).toMatch(/cite|citation/i);
  });
});
