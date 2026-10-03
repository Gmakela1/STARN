import { describe, it, expect } from 'vitest';
import { formatDocumentToc, extractSections } from '../src/cli/ui.js';
import { enrichFeedbackWithCritic } from '../src/cli/checkpoint.js';
import { CriticResult } from '../src/core/critic.js';

const SAMPLE_DOC = `# BOM

## SS-01: Traction Motor
### Candidate table
content here

## SS-02: Battery Pack
### Candidate table
more content

## Design Decisions
D-001`;

describe('formatDocumentToc', () => {
  it('formats a two-level TOC with all ## and ### headings', () => {
    const toc = formatDocumentToc(SAMPLE_DOC);
    expect(toc).toContain('SS-01: Traction Motor');
    expect(toc).toContain('Candidate table');
    expect(toc).toContain('SS-02: Battery Pack');
    expect(toc).toContain('Design Decisions');
  });
});

describe('extractSections', () => {
  it('extracts section content by heading', () => {
    const sections = extractSections(SAMPLE_DOC);
    expect(sections['SS-01: Traction Motor']).toContain('content here');
    expect(sections['SS-02: Battery Pack']).toContain('more content');
  });
});

describe('enrichFeedbackWithCritic', () => {
  it('appends critic scorecard details when critic guidance is present', () => {
    const criticResult: CriticResult = {
      passed: true,
      score: 8.8,
      summary: 'Solid deliverable with minor omissions.',
      strengths: ['Rigorous analysis'],
      weaknesses: ['Missing PTO shaft diameter'],
      actionableGuidance: 'Add 1-3/8 inch 6-spline diameter to Section 3.'
    };

    const enriched = enrichFeedbackWithCritic('Implement that guidance', criticResult);
    expect(enriched).toContain('Implement that guidance');
    expect(enriched).toContain('[CRITIC EVALUATION CONTEXT FOR THIS REVISION]:');
    expect(enriched).toContain('Score: 8.8/10');
    expect(enriched).toContain('Summary: Solid deliverable with minor omissions.');
    expect(enriched).toContain('Missing PTO shaft diameter');
    expect(enriched).toContain('Actionable Guidance: Add 1-3/8 inch 6-spline diameter to Section 3.');
  });

  it('leaves feedback untouched when criticResult is undefined or lacks findings', () => {
    expect(enrichFeedbackWithCritic('Looks good', undefined)).toBe('Looks good');
    const emptyResult: CriticResult = {
      passed: true,
      score: 9.5,
      summary: 'Flawless',
      strengths: [],
      weaknesses: [],
      actionableGuidance: ''
    };
    expect(enrichFeedbackWithCritic('Looks good', emptyResult)).toBe('Looks good');
  });
});
