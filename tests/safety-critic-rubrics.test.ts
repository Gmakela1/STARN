import { describe, it, expect } from 'vitest';
import { architecturePackage } from '../src/specialists/packages/architecture/index.js';
import { icdPackage } from '../src/specialists/packages/icd/index.js';
import { riskRegisterPackage } from '../src/specialists/packages/risk-register/index.js';

describe('Safety & Defense-in-Depth Specialist and Critic Enhancements', () => {
  describe('Architecture Specialist Package', () => {
    it('architecturePackage.systemPrompt mentions Defense-in-Depth, fail-safe states, and single-point-of-failure mitigation', () => {
      const prompt = architecturePackage.systemPrompt;
      expect(prompt).toMatch(/defense-in-depth/i);
      expect(prompt).toMatch(/fail-safe/i);
      expect(prompt).toMatch(/single-point-of-failure/i);
    });

    it('architecturePackage.criticRubric includes a criterion evaluating Physical Safety & Defense-in-Depth', () => {
      const rubric = architecturePackage.criticRubric;
      expect(rubric).toMatch(/Physical Safety & Defense-in-Depth/);
      expect(rubric).toMatch(/fail-safe/i);
      expect(rubric).toMatch(/isolation/i);
      expect(rubric).toMatch(/thermal|barrier/i);
    });
  });

  describe('ICD Specialist Package', () => {
    it('icdPackage.systemPrompt specifies physical interface protection including fusing, reverse polarity, shielding, and isolation barriers', () => {
      const prompt = icdPackage.systemPrompt;
      expect(prompt).toMatch(/overcurrent|fusing/i);
      expect(prompt).toMatch(/reverse polarity/i);
      expect(prompt).toMatch(/shielding/i);
      expect(prompt).toMatch(/isolation barrier/i);
    });

    it('icdPackage.criticRubric includes a criterion evaluating Interface Safety & Overcurrent Protection', () => {
      const rubric = icdPackage.criticRubric;
      expect(rubric).toMatch(/Interface Safety & Overcurrent Protection/);
      expect(rubric).toMatch(/fusing/i);
      expect(promptOrRubricHasAmpacity(rubric)).toBe(true);
      expect(rubric).toMatch(/isolation/i);
    });
  });

  describe('Risk Register Specialist Package', () => {
    it('riskRegisterPackage.systemPrompt mandates multi-layer defense-in-depth mitigations', () => {
      const prompt = riskRegisterPackage.systemPrompt;
      expect(prompt).toMatch(/defense-in-depth/i);
      expect(prompt).toMatch(/prevention/i);
      expect(prompt).toMatch(/containment/i);
      expect(prompt).toMatch(/emergency cutoff|emergency shutdown/i);
    });

    it('riskRegisterPackage.criticRubric requires multi-layered defense-in-depth mitigations for high-severity hazards', () => {
      const rubric = riskRegisterPackage.criticRubric;
      expect(rubric).toMatch(/defense-in-depth/i);
      expect(rubric).toMatch(/high-severity|hazard/i);
    });
  });
});

function promptOrRubricHasAmpacity(text: string): boolean {
  return /ampacity|wire gauge/i.test(text);
}
