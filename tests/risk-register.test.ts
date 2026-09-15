import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Risk Register Specialist', () => {
  const registry = new SpecialistRegistry();

  it('registers risk-register specialist', () => {
    const pkg = registry.get('risk-register');
    expect(pkg).toBeDefined();
    expect(pkg!.id).toBe('risk-register');
    expect(pkg!.name).toContain('Risk');
  });

  it('has prerequisite MILESTONES', () => {
    const pkg = registry.get('risk-register');
    expect(pkg!.prerequisiteArtifactId).toBe('MILESTONES');
  });

  it('includes risk register table format in system prompt', () => {
    const pkg = registry.get('risk-register');
    expect(pkg!.systemPrompt).toContain('| ID | Risk (If/Then) | Source | Phase Impacted | Impact Description | Mitigation | Status |');
  });

  it('includes interview instructions for auto-generate then verify', () => {
    const pkg = registry.get('risk-register');
    expect(pkg!.systemPrompt).toContain('pendingRisks');
    expect(pkg!.systemPrompt).toContain('interview');
  });

  it('includes tool-based discovery workflow', () => {
    const pkg = registry.get('risk-register');
    expect(pkg!.systemPrompt).toContain('DISCOVERY, PLANNING & EXECUTION WORKFLOW');
    expect(pkg!.systemPrompt).toContain('fs_read');
  });
});