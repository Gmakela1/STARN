import { describe, it, expect } from 'vitest';
import { resolveDocTarget, formatViewerHeader } from '../src/cli/doc-viewer.js';
import { ORDERED_WORKFLOW_PHASES } from '../src/workspace/state.js';

describe('resolveDocTarget', () => {
  it('resolves by 1-based phase number', () => {
    const p1 = resolveDocTarget('1', ORDERED_WORKFLOW_PHASES);
    expect(p1?.id).toBe('conops');
    const p6 = resolveDocTarget('6', ORDERED_WORKFLOW_PHASES);
    expect(p6?.id).toBe('bom');
  });

  it('resolves by exact phase id', () => {
    const p = resolveDocTarget('architecture', ORDERED_WORKFLOW_PHASES);
    expect(p?.id).toBe('architecture');
    const pRisk = resolveDocTarget('risk-register', ORDERED_WORKFLOW_PHASES);
    expect(pRisk?.id).toBe('risk-register');
  });

  it('resolves by fragment or uppercase', () => {
    const p = resolveDocTarget('BOM', ORDERED_WORKFLOW_PHASES);
    expect(p?.id).toBe('bom');
    const pRisk = resolveDocTarget('risk', ORDERED_WORKFLOW_PHASES);
    expect(pRisk?.id).toBe('risk-register');
  });

  it('returns undefined for invalid target', () => {
    expect(resolveDocTarget('unknown-xyz', ORDERED_WORKFLOW_PHASES)).toBeUndefined();
    expect(resolveDocTarget('99', ORDERED_WORKFLOW_PHASES)).toBeUndefined();
  });
});

describe('formatViewerHeader', () => {
  it('formats header with title, path, status, and score', () => {
    const header = formatViewerHeader({
      title: 'Concept of Operations',
      relativePath: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.1,
      lineCount: 140
    });

    expect(header).toContain('Concept of Operations');
    expect(header).toContain('docs/CONOPS.md');
    expect(header).toContain('APPROVED');
    expect(header).toContain('9.1/10');
    expect(header).toContain('140 lines');
  });
});
