import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Specialist Packages & RTM', () => {
  const registry = new SpecialistRegistry();

  it('loads all 8 specialists including general, conops, capabilities, requirements, rtm, milestones, wbs, sow', () => {
    const packages = registry.listSpecialists();
    expect(packages.map(p => p.id)).toEqual(
      expect.arrayContaining([
        'general',
        'conops',
        'capabilities',
        'requirements',
        'rtm',
        'milestones',
        'wbs',
        'sow'
      ])
    );
  });

  it('rtm specialist has prerequisite REQUIREMENTS, tabular rubric, and secret sauce example', () => {
    const rtm = registry.get('rtm');
    expect(rtm).toBeDefined();
    expect(rtm!.name).toContain('Traceability Matrix');
    expect(rtm!.prerequisiteArtifactId).toBe('REQUIREMENTS');
    expect(rtm!.secretSauceExamples[0]).toContain('| Req ID | Requirement Summary | Method |');
    expect(rtm!.criticRubric).toContain('Tabular Matrix Structure');
  });

  it('requirements specialist has prerequisite CAPABILITIES and Requirement 1.a numbering', () => {
    const reqs = registry.get('requirements');
    expect(reqs).toBeDefined();
    expect(reqs!.prerequisiteArtifactId).toBe('CAPABILITIES');
    expect(reqs!.systemPrompt).toContain('Requirement 1.a');
    expect(reqs!.systemPrompt).toContain('plain-text');
  });

  it('capabilities package enforces 1.a numbering and plain text units', () => {
    const cap = registry.get('capabilities');
    expect(cap).toBeDefined();
    expect(cap!.systemPrompt).toContain('1.a');
    expect(cap!.systemPrompt).toContain('plain-text');
  });
});
