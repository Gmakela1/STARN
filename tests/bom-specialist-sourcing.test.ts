import { describe, it, expect } from 'vitest';
import { bomPackage } from '../src/specialists/packages/bom/index.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('BOM Specialist Sourcing & Grocery List Discipline', () => {
  it('allows web_search and web_fetch tools for BOM specialist', () => {
    expect(bomPackage.allowedTools).toContain('web_search');
    expect(bomPackage.allowedTools).toContain('web_fetch');
  });

  it('restricts web_search and web_fetch from non-research specialists', () => {
    const registry = new SpecialistRegistry();
    const nonResearchSpecialists = ['conops', 'requirements', 'milestones', 'risk-register'];

    for (const specId of nonResearchSpecialists) {
      const pkg = registry.get(specId);
      expect(pkg).toBeDefined();
      expect(pkg!.allowedTools).not.toContain('web_search');
      expect(pkg!.allowedTools).not.toContain('web_fetch');
    }
  });

  it('enforces Grocery List First, Sourcing Second in the BOM system prompt', () => {
    const prompt = bomPackage.systemPrompt.toLowerCase();
    expect(prompt).toContain('grocery list');
    expect(prompt).toContain('stage 1');
    expect(prompt).toContain('stage 2');
    expect(prompt).toContain('web_search');
  });

  it('includes Consumed in allowed procurement statuses in secret sauce', () => {
    const secretSauce = bomPackage.secretSauceExamples.join('\n');
    expect(secretSauce).toContain('Consumed');
  });
});
