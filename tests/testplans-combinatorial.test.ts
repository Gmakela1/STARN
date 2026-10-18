import { describe, it, expect } from 'vitest';
import { testplansPackage } from '../src/specialists/packages/testplans/index.js';

describe('Test Plans Combinatorial Test Matrices', () => {
  it('requires Combinatorial Test Matrices for multi-variable subsystems in systemPrompt', () => {
    const prompt = testplansPackage.systemPrompt;
    expect(prompt).toContain('COMBINATORIAL TEST MATRICES & PARAMETER INTERACTIONS');
    expect(prompt).toContain('MANDATORY FOR MULTI-VARIABLE SUBSYSTEMS');
    expect(prompt).toMatch(/operating variables/i);
    expect(prompt).toMatch(/combinatorial test matrix/i);
    expect(prompt).toMatch(/boundary combinations/i);
  });

  it('includes a formatted Combinatorial Test Matrix table in secretSauceExamples[0]', () => {
    const example = testplansPackage.secretSauceExamples[0];
    expect(example).toBeDefined();
    expect(example).toContain('TP-FOC-02');
    expect(example).toMatch(/Combinatorial Test Matrix/i);
    // Expect a markdown table with parameters like Ambient Temp, Battery SOC, Mechanical Draw, and Expected outcomes
    expect(example).toMatch(/\|\s*Test Config(uration)?\s*\|\s*Ambient Temp/i);
    expect(example).toMatch(/Battery SOC/i);
    expect(example).toMatch(/Mechanical Draw/i);
  });

  it('evaluates Combinatorial Test Coverage in criticRubric', () => {
    const rubric = testplansPackage.criticRubric;
    expect(rubric).toContain('Combinatorial Test Coverage');
    expect(rubric).toMatch(/operating variables/i);
    expect(rubric).toMatch(/boundary interactions/i);
  });
});
