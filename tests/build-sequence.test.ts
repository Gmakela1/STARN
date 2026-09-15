import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Build Sequence Specialist', () => {
  const registry = new SpecialistRegistry();

  it('registers build-sequence specialist', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg).toBeDefined();
    expect(pkg!.id).toBe('build-sequence');
    expect(pkg!.name).toContain('Build');
  });

  it('has prerequisite MILESTONES', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg!.prerequisiteArtifactId).toBe('MILESTONES');
  });

  it('has dual prerequisite including RISK_REGISTER', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg!.prerequisiteArtifactIds).toContain('RISK_REGISTER');
  });

  it('includes step-by-step procedure format in system prompt', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg!.systemPrompt).toContain('Step-by-Step Procedure');
    expect(pkg!.systemPrompt).toContain('→ VERIFY: TP-');
  });

  it('includes upstream document references in system prompt', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg!.systemPrompt).toContain('[From Architecture');
    expect(pkg!.systemPrompt).toContain('[From ICD');
    expect(pkg!.systemPrompt).toContain('[From BOM');
    expect(pkg!.systemPrompt).toContain('[From Risk Register');
  });

  it('includes tool-based discovery workflow', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg!.systemPrompt).toContain('DISCOVERY, PLANNING & EXECUTION WORKFLOW');
    expect(pkg!.systemPrompt).toContain('fs_read');
  });
});