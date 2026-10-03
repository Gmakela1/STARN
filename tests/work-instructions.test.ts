import { describe, it, expect } from 'vitest';
import { workInstructionsPackage } from '../src/specialists/packages/work-instructions/index.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Work Instructions Specialist', () => {
  it('is registered in SpecialistRegistry with correct metadata and prerequisites', () => {
    const registry = new SpecialistRegistry();
    const pkg = registry.get('work-instructions');
    expect(pkg).toBeDefined();
    expect(pkg?.id).toBe('work-instructions');
    expect(pkg?.name).toContain('Work Instructions');
    expect(pkg?.prerequisiteArtifactId).toBe('BUILD_SEQUENCE');
    expect(pkg?.requiresCritic).toBe(true);
    expect(pkg?.allowedTools).toContain('fs_write');
    expect(pkg?.allowedTools).toContain('fs_edit');
  });

  it('contains secret sauce with prerequisites, checklists, evidence, and non-conformance log', () => {
    const sauce = workInstructionsPackage.secretSauceExamples[0];
    expect(sauce).toContain('Prerequisites & Required Resources');
    expect(sauce).toContain('Step-by-Step Action Checklist');
    expect(sauce).toContain('Verification & Evidence Artifacts');
    expect(sauce).toContain('Hardware Non-Conformance / Bug Log');
    expect(sauce).toContain('artifacts/');
  });

  it('enforces flat artifacts folder and action-specific naming convention in system prompt', () => {
    expect(workInstructionsPackage.systemPrompt).toContain('docs/work_instructions/ACTION-');
    expect(workInstructionsPackage.systemPrompt).toContain('artifacts/');
    expect(workInstructionsPackage.systemPrompt).toContain('OPEN_NON_CONFORMANCE');
    expect(workInstructionsPackage.systemPrompt).toContain('GATED TEST PLAN EXECUTION');
  });
});
