import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Specialist Packages', () => {
  const registry = new SpecialistRegistry();

  it('loads all 6 primary specialists including general, conops, capabilities, milestones, wbs, sow', () => {
    const packages = registry.listSpecialists();
    expect(packages.map(p => p.id)).toEqual(
      expect.arrayContaining(['general', 'conops', 'capabilities', 'milestones', 'wbs', 'sow'])
    );
  });

  it('general specialist has critic disabled and read-only tools', () => {
    const general = registry.get('general');
    expect(general).toBeDefined();
    expect(general!.requiresCritic).toBe(false);
    expect(general!.allowedTools).not.toContain('fs_write');
  });

  it('engineering deliverable specialists have secret sauce examples and critic rubric', () => {
    const conops = registry.get('conops');
    expect(conops).toBeDefined();
    expect(conops!.requiresCritic).toBe(true);
    expect(conops!.secretSauceExamples.length).toBeGreaterThan(0);
    expect(conops!.criticRubric).toContain('Physical Environment');

    const wbs = registry.get('wbs');
    expect(wbs).toBeDefined();
    expect(wbs!.requiresCritic).toBe(true);
    expect(wbs!.secretSauceExamples.length).toBeGreaterThan(0);
    expect(wbs!.criticRubric).toContain('Work Breakdown Structure');
  });
});
