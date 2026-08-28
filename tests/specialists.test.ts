import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Specialist Packages & RTM', () => {
  const registry = new SpecialistRegistry();

  it('loads all 9 specialists including general, conops, capabilities, requirements, rtm, milestones, testplans, wbs, sow', () => {
    const packages = registry.listSpecialists();
    expect(packages.map(p => p.id)).toEqual(
      expect.arrayContaining([
        'general',
        'conops',
        'capabilities',
        'requirements',
        'rtm',
        'milestones',
        'testplans',
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

  it('milestones specialist enforces MVC -> IOC -> FOC progressive capability gating with consolidated requirements and 4 standard verification methods', () => {
    const milestones = registry.get('milestones');
    expect(milestones).toBeDefined();
    expect(milestones!.prerequisiteArtifactId).toBe('RTM');
    expect(milestones!.systemPrompt).toContain('MVC');
    expect(milestones!.systemPrompt).toContain('IOC');
    expect(milestones!.systemPrompt).toContain('FOC');
    expect(milestones!.systemPrompt).toContain('Inspect, Test, Demo, Analysis');
    expect(milestones!.systemPrompt).toContain('Evolution / Upgrade Path');
    expect(milestones!.secretSauceExamples[0]).toContain('Milestone 1: MVC');
    expect(milestones!.secretSauceExamples[0]).toContain('Milestone 2: IOC');
    expect(milestones!.secretSauceExamples[0]).toContain('Milestone 3: FOC');
    expect(milestones!.secretSauceExamples[0]).toContain('Requirements & Acceptance Gates');
  });

  it('testplans specialist has prerequisite MILESTONES and conducts shop tooling interview to build phased test procedures', () => {
    const testplans = registry.get('testplans');
    expect(testplans).toBeDefined();
    expect(testplans!.name).toContain('Test Plans');
    expect(testplans!.prerequisiteArtifactId).toBe('MILESTONES');
    expect(testplans!.systemPrompt).toContain('SHOP TOOLING INTERVIEW');
    expect(testplans!.systemPrompt).toContain('TP-MVP');
    expect(testplans!.secretSauceExamples[0]).toContain('TP-MVP');
  });

  it('wbs specialist has prerequisite TEST_PLANS and builds towards MVP milestone first', () => {
    const wbs = registry.get('wbs');
    expect(wbs).toBeDefined();
    expect(wbs!.prerequisiteArtifactId).toBe('TEST_PLANS');
    expect(wbs!.systemPrompt).toContain('Milestone');
  });

  it('sow specialist supports tailorability (DIY, turnkey, or multi-contractor)', () => {
    const sow = registry.get('sow');
    expect(sow).toBeDefined();
    expect(sow!.prerequisiteArtifactId).toBe('WBS');
    expect(sow!.systemPrompt).toContain('contracting strategy');
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

  it('deliverable specialists require tool-based inspection of prior documents and maintaining a running plan', () => {
    const deliverableSpecialists = ['capabilities', 'requirements', 'rtm', 'milestones', 'testplans', 'wbs', 'sow'];
    for (const id of deliverableSpecialists) {
      const pkg = registry.get(id);
      expect(pkg).toBeDefined();
      expect(pkg!.systemPrompt).toContain('DISCOVERY, PLANNING & EXECUTION WORKFLOW');
      expect(pkg!.systemPrompt).toContain('fs_read');
      expect(pkg!.systemPrompt).toContain('running plan');
    }
  });
});
