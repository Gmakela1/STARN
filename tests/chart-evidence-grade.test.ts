/**
 * chart-evidence-grade.test.ts — source grading for a chart read
 * (gradeChartEvidence in src/tools/handlers/chart-read.ts).
 *
 * Purpose: a fast-path chart read is graded by WHERE its file lives, and can
 * never reach the auto-apply tier. Pure functions only — no PDF, no I/O.
 */
import { describe, it, expect } from 'vitest';
import {
  gradeChartEvidence,
  PROJECT_DOCUMENT_CONFIDENCE_FLOOR,
  PROJECT_REFERENCE_CONFIDENCE_FLOOR,
} from '../src/tools/handlers/chart-read.js';
import { toBand } from '../src/core/research-delegation.js';
import { UNVERIFIED_CONFIDENCE_CAP } from '../src/core/research-gate.js';

describe('gradeChartEvidence floors', () => {
  it('grades a reference/ document as project-reference at 0.75', () => {
    expect(gradeChartEvidence('reference/vendor/performance-spec-sheet.pdf')).toEqual({
      provenance: 'project-reference',
      confidence: 0.75,
      band: 'medium',
    });
    expect(PROJECT_REFERENCE_CONFIDENCE_FLOOR).toBe(0.75);
  });

  it('grades any other project PDF as project-document at 0.60', () => {
    expect(gradeChartEvidence('docs/me1115.pdf')).toEqual({
      provenance: 'project-document',
      confidence: 0.6,
      band: 'medium',
    });
    expect(PROJECT_DOCUMENT_CONFIDENCE_FLOOR).toBe(0.6);
  });

  it('treats a root-level PDF as a project document', () => {
    expect(gradeChartEvidence('datasheet.pdf').provenance).toBe('project-document');
  });

  it('normalizes win32 separators, a leading ./ and case', () => {
    expect(gradeChartEvidence('reference\\vendor\\spec.pdf').provenance).toBe('project-reference');
    expect(gradeChartEvidence('./Reference/spec.pdf').provenance).toBe('project-reference');
    expect(gradeChartEvidence('REFERENCE/spec.pdf').provenance).toBe('project-reference');
  });

  it('does not read a reference-lookalike folder as reference/', () => {
    expect(gradeChartEvidence('myreference/spec.pdf').provenance).toBe('project-document');
    expect(gradeChartEvidence('docs/reference/spec.pdf').provenance).toBe('project-document');
  });
});

describe('gradeChartEvidence cap and band', () => {
  it('never exceeds UNVERIFIED_CONFIDENCE_CAP for either source class', () => {
    for (const file of ['reference/spec.pdf', 'docs/spec.pdf']) {
      expect(gradeChartEvidence(file).confidence).toBeLessThanOrEqual(UNVERIFIED_CONFIDENCE_CAP);
      expect(gradeChartEvidence(file).confidence).toBeLessThanOrEqual(0.85);
    }
  });

  it('bands with the shared toBand mapping', () => {
    for (const file of ['reference/spec.pdf', 'docs/spec.pdf']) {
      const grade = gradeChartEvidence(file);
      expect(grade.band).toBe(toBand(grade.confidence));
    }
  });
});