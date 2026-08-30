import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Specialist Packages & RTM', () => {
  const registry = new SpecialistRegistry();

  it('loads all 11 specialists including general, conops, architecture, icd, capabilities, requirements, bom, rtm, milestones, testplans, sow, change-impact', () => {
    const packages = registry.listSpecialists();
    expect(packages.map(p => p.id)).toEqual(
      expect.arrayContaining([
        'general',
        'conops',
        'architecture',
        'icd',
        'capabilities',
        'requirements',
        'bom',
        'rtm',
        'milestones',
        'testplans',
        'sow',
        'change-impact'
      ])
    );
  });

  it('conops specialist enforces story-based intake, clean 5-section structure, and Section 6 Open Questions', () => {
    const conops = registry.get('conops');
    expect(conops).toBeDefined();
    // Story-based intake
    expect(conops!.systemPrompt).toContain('ADAPTIVE STORY-BASED INTAKE INTERVIEW');
    expect(conops!.systemPrompt).toContain('Walk me through how you envision using this');
    // Clean 5-section structure
    expect(conops!.systemPrompt).toContain('## 1. Executive Summary & User Intent');
    expect(conops!.systemPrompt).toContain('## 5. Safety, Environmental & Community Considerations');
    // Section 6 Open Questions
    expect(conops!.systemPrompt).toContain('## 6. Open Questions & Items for Clarification');
    expect(conops!.systemPrompt).toContain('Do NOT silently assume answers');
    expect(conops!.secretSauceExamples[0]).toContain('## 6. Open Questions & Items for Clarification');
  });

  it('rtm specialist has prerequisite REQUIREMENTS, tabular rubric, and secret sauce example', () => {
    const rtm = registry.get('rtm');
    expect(rtm).toBeDefined();
    expect(rtm!.name).toContain('Traceability Matrix');
    expect(rtm!.prerequisiteArtifactId).toBe('REQUIREMENTS');
    expect(rtm!.secretSauceExamples[0]).toContain('| Capability Ref | Req ID | Requirement Statement | Method |');
    expect(rtm!.criticRubric).toContain('100% Upstream Traceability');
    expect(rtm!.criticRubric).toContain('Standard 4 Verification Methods');
  });

  it('milestones specialist enforces MVC -> IOC -> FOC progressive capability gating with consolidated requirements, 4 verification methods, and upgrade provisions', () => {
    const milestones = registry.get('milestones');
    expect(milestones).toBeDefined();
    expect(milestones!.prerequisiteArtifactId).toBe('RTM');
    expect(milestones!.systemPrompt).toContain('MVC');
    expect(milestones!.systemPrompt).toContain('IOC');
    expect(milestones!.systemPrompt).toContain('FOC');
    expect(milestones!.systemPrompt).toContain('Inspect, Test, Demo, Analysis');
    expect(milestones!.systemPrompt).toContain('Evolution & Upgrade Provisions (De-Risking & Hooks)');
    expect(milestones!.secretSauceExamples[0]).toContain('Milestone 1: MVC');
    expect(milestones!.secretSauceExamples[0]).toContain('Milestone 2: IOC');
    expect(milestones!.secretSauceExamples[0]).toContain('Milestone 3: FOC');
    expect(milestones!.secretSauceExamples[0]).toContain('Requirements & Acceptance Gates');
    expect(milestones!.secretSauceExamples[0]).toContain('Evolution & Upgrade Provisions (De-Risking & Hooks)');
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

  it('architecture specialist decomposes CONOPS system-level capabilities into subsystems with block diagram, dependency graph, and design decisions', () => {
    const arch = registry.get('architecture');
    expect(arch).toBeDefined();
    expect(arch!.prerequisiteArtifactId).toBe('CONOPS');
    expect(arch!.systemPrompt).toContain('System Block Diagram');
    expect(arch!.systemPrompt).toContain('Dependency Graph');
    expect(arch!.systemPrompt).toContain('Key Design Decisions');
    expect(arch!.secretSauceExamples[0]).toContain('SS-01');
  });

  it('icd specialist defines mechanical, electrical, data, and thermal interfaces between subsystems', () => {
    const icd = registry.get('icd');
    expect(icd).toBeDefined();
    expect(icd!.prerequisiteArtifactId).toBe('ARCHITECTURE');
    expect(icd!.systemPrompt).toContain('Mechanical Interfaces');
    expect(icd!.systemPrompt).toContain('Electrical Interfaces');
    expect(icd!.systemPrompt).toContain('Data / Signal Interfaces');
    expect(icd!.secretSauceExamples[0]).toContain('ICD-M-01');
  });

  it('bom specialist generates candidate parts per subsystem with requirement satisfaction flags and design decisions', () => {
    const bom = registry.get('bom');
    expect(bom).toBeDefined();
    expect(bom!.prerequisiteArtifactId).toBe('REQUIREMENTS');
    expect(bom!.systemPrompt).toContain('candidate part');
    expect(bom!.systemPrompt).toContain('Design Decisions Required');
    expect(bom!.secretSauceExamples[0]).toContain('Satisfies?');
  });

  it('change-impact specialist cross-checks document consistency without rewriting files', () => {
    const ci = registry.get('change-impact');
    expect(ci).toBeDefined();
    expect(ci!.systemPrompt).toContain('Change Impact');
    expect(ci!.requiresCritic).toBe(false);
    expect(ci!.allowedTools).not.toContain('fs_write');
  });

  it('sow specialist supports tailorability (DIY, turnkey, or multi-contractor)', () => {
    const sow = registry.get('sow');
    expect(sow).toBeDefined();
    expect(sow!.prerequisiteArtifactId).toBe('TEST_PLANS');
    expect(sow!.systemPrompt).toContain('contracting strategy');
  });

  it('requirements specialist has prerequisite CAPABILITIES and Requirement 1.a numbering', () => {
    const reqs = registry.get('requirements');
    expect(reqs).toBeDefined();
    expect(reqs!.prerequisiteArtifactId).toBe('CAPABILITIES');
    expect(reqs!.systemPrompt).toContain('Requirement SS-01');
    expect(reqs!.systemPrompt).toContain('plain-text');
  });

  it('capabilities package enforces pure functional/behavioral traits without premature numeric tolerances', () => {
    const cap = registry.get('capabilities');
    expect(cap).toBeDefined();
    expect(cap!.systemPrompt).toContain('SS-01.a');
    expect(cap!.systemPrompt).toContain('FUNCTIONAL & BEHAVIORAL TRAITS');
    expect(cap!.systemPrompt).toContain('DO NOT embed rigid numeric tolerances');
    expect(cap!.secretSauceExamples[0]).toContain('Proportional Speed & Direction Control');
    expect(cap!.secretSauceExamples[0]).toContain('Low-End Starting Torque Delivery');
  });

  it('deliverable specialists require tool-based inspection of prior documents and maintaining a running plan', () => {
    const deliverableSpecialists = ['architecture', 'icd', 'capabilities', 'requirements', 'bom', 'rtm', 'milestones', 'testplans', 'sow'];
    for (const id of deliverableSpecialists) {
      const pkg = registry.get(id);
      expect(pkg).toBeDefined();
      expect(pkg!.systemPrompt).toContain('DISCOVERY, PLANNING & EXECUTION WORKFLOW');
      expect(pkg!.systemPrompt).toContain('fs_read');
      expect(pkg!.systemPrompt).toContain('running plan');
    }
  });
});