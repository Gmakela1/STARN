import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Test Plan Specialist Updates', () => {
  const registry = new SpecialistRegistry();

  it('has prerequisite MILESTONES (unchanged)', () => {
    const pkg = registry.get('testplans');
    expect(pkg!.prerequisiteArtifactId).toBe('MILESTONES');
  });

  it('includes Build Sequence reading instructions', () => {
    const pkg = registry.get('testplans');
    expect(pkg!.systemPrompt).toContain('BUILD_SEQUENCE_');
    expect(pkg!.systemPrompt).toContain('→ VERIFY: TP-');
  });

  it('includes tabular data entry format in system prompt', () => {
    const pkg = registry.get('testplans');
    expect(pkg!.systemPrompt).toContain('| Parameter | Expected | Actual | Pass/Fail |');
  });

  it('includes Build Sequence Reference field in test procedure format', () => {
    const pkg = registry.get('testplans');
    expect(pkg!.systemPrompt).toContain('Build Sequence Reference');
  });

  it('includes system-level test instructions', () => {
    const pkg = registry.get('testplans');
    expect(pkg!.systemPrompt).toContain('Not tied to a specific build step');
  });
});