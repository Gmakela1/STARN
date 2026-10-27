import { describe, it, expect } from 'vitest';
import { buildRevisionGuidance, buildCriticNote } from '../src/core/critic-revision.js';
import { CriticResult } from '../src/core/critic.js';

const failingResult: CriticResult = {
  passed: false,
  score: 8.9,
  summary: 'Strong CONOPS foundation.',
  strengths: ['Clear operational modes'],
  weaknesses: ['PTO spline dimension omitted'],
  actionableGuidance: 'Specify 1-3/8 inch 6-spline shaft in Section 3.2.'
};

describe('buildRevisionGuidance', () => {
  it('locks the delta-review branch byte-identically', () => {
    // source of truth: src/core/runner.ts revision prompt, isDeltaReview === true
    expect(buildRevisionGuidance(failingResult, true, 'CONOPS')).toBe(
      'The Critic evaluated your targeted edits to docs/CONOPS.md and found the following issues:\n' +
        '- PTO spline dimension omitted\n\n' +
        'Actionable Guidance:\nSpecify 1-3/8 inch 6-spline shaft in Section 3.2.\n\n' +
        'INSTRUCTION: Use the fs_edit tool to surgically resolve these specific issues in the document. Do NOT rewrite or regenerate the entire document.'
    );
  });

  it('locks the plain full-draft branch byte-identically', () => {
    // source of truth: src/core/runner.ts revision prompt, isDeltaReview === false
    expect(buildRevisionGuidance(failingResult, false, 'CONOPS')).toBe(
      'The Critic evaluated your draft and found the following weaknesses:\n' +
        '- PTO spline dimension omitted\n\n' +
        'Actionable Guidance:\nSpecify 1-3/8 inch 6-spline shaft in Section 3.2.\n\n' +
        'Please revise the deliverable to resolve all weaknesses while maintaining rigorous physical engineering standards and program alignment.'
    );
  });

  it('falls back to "Fix weaknesses" when actionableGuidance is empty', () => {
    const result: CriticResult = { ...failingResult, actionableGuidance: '' };
    expect(buildRevisionGuidance(result, false, 'CONOPS')).toContain(
      'Actionable Guidance:\nFix weaknesses\n\nPlease revise the deliverable'
    );
  });

  it('joins multiple weaknesses with bullet lines', () => {
    const result: CriticResult = {
      ...failingResult,
      weaknesses: ['Shield grounding missing', 'PTO rating not specified']
    };
    const guidance = buildRevisionGuidance(result, false, 'CONOPS');
    expect(guidance).toContain('found the following weaknesses:\n- Shield grounding missing\n- PTO rating not specified');
  });
});

describe('buildCriticNote', () => {
  it('locks the full critic note format byte-identically', () => {
    // source of truth: src/core/runner.ts critic note assembly
    expect(buildCriticNote('CONOPS & User Intent', failingResult, false)).toBe(
      '[Critic Review for CONOPS & User Intent]: Score: 8.9/10.\n' +
        'Summary: Strong CONOPS foundation.\n' +
        'Weaknesses:\n- PTO spline dimension omitted\n' +
        'Actionable Guidance: Specify 1-3/8 inch 6-spline shaft in Section 3.2.'
    );
  });

  it('emits only the score line when optional fields are absent', () => {
    const minimal: CriticResult = {
      passed: true,
      score: 9.2,
      summary: '',
      strengths: [],
      weaknesses: [],
      actionableGuidance: ''
    };
    expect(buildCriticNote('BOM Specialist', minimal, true)).toBe(
      '[Critic Review for BOM Specialist]: Score: 9.2/10.'
    );
  });

  it('appends summary but skips empty weaknesses and guidance', () => {
    const result: CriticResult = {
      passed: true,
      score: 8.0,
      summary: 'Good enough.',
      strengths: [],
      weaknesses: [],
      actionableGuidance: ''
    };
    expect(buildCriticNote('Risk Specialist', result, true)).toBe(
      '[Critic Review for Risk Specialist]: Score: 8.0/10.\nSummary: Good enough.'
    );
  });
});