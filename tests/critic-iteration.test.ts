import { describe, it, expect } from 'vitest';
import { decideCriticIteration } from '../src/core/critic-iteration.js';
import type { CriticResult } from '../src/core/critic.js';

function criticResult(passed: boolean): CriticResult {
  return {
    passed,
    score: passed ? 8.5 : 7.0,
    summary: passed ? 'good' : 'needs work',
    strengths: [],
    weaknesses: passed ? [] : ['weakness'],
    actionableGuidance: passed ? '' : 'fix it'
  };
}

describe('decideCriticIteration', () => {
  it('returns pass when the critic passed, at any attempts count', () => {
    expect(decideCriticIteration(criticResult(true), 0, 2)).toBe('pass');
    expect(decideCriticIteration(criticResult(true), 1, 2)).toBe('pass');
    expect(decideCriticIteration(criticResult(true), 2, 2)).toBe('pass');
    expect(decideCriticIteration(criticResult(true), 3, 2)).toBe('pass');
  });

  it('returns revise when not passed and attempts are under the cap', () => {
    expect(decideCriticIteration(criticResult(false), 0, 2)).toBe('revise');
    expect(decideCriticIteration(criticResult(false), 1, 2)).toBe('revise');
  });

  it('returns give-up when not passed and attempts are at or beyond the cap', () => {
    expect(decideCriticIteration(criticResult(false), 2, 2)).toBe('give-up');
    expect(decideCriticIteration(criticResult(false), 3, 2)).toBe('give-up');
  });
});