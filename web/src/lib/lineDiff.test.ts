import { describe, it, expect } from 'vitest';
import { diffLines } from './lineDiff';

describe('diffLines', () => {
  it('marks identical documents as all equal', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc');
    expect(rows.every(r => r.type === 'equal')).toBe(true);
    expect(rows.map(r => r.text)).toEqual(['a', 'b', 'c']);
  });

  it('detects added lines (green)', () => {
    const rows = diffLines('a\nb', 'a\nx\nb');
    expect(rows.filter(r => r.type === 'added').map(r => r.text)).toEqual(['x']);
    expect(rows.filter(r => r.type === 'removed')).toEqual([]);
  });

  it('detects removed lines (red)', () => {
    const rows = diffLines('a\nx\nb', 'a\nb');
    expect(rows.filter(r => r.type === 'removed').map(r => r.text)).toEqual(['x']);
    expect(rows.filter(r => r.type === 'added')).toEqual([]);
  });

  it('pairs changed lines as removed-then-added', () => {
    const rows = diffLines('old line', 'new line');
    expect(rows).toEqual([
      { type: 'removed', text: 'old line' },
      { type: 'added', text: 'new line' }
    ]);
  });

  it('handles empty inputs (empty string = a single empty line)', () => {
    expect(diffLines('', '')).toEqual([{ type: 'equal', text: '' }]);
    expect(diffLines('', 'new')).toEqual([
      { type: 'removed', text: '' },
      { type: 'added', text: 'new' }
    ]);
    expect(diffLines('old', '')).toEqual([
      { type: 'removed', text: 'old' },
      { type: 'added', text: '' }
    ]);
  });

  it('keeps order stable across a mixed edit', () => {
    const rows = diffLines('a\nb\nc\nd', 'a\nb2\nc\nd');
    expect(rows.map(r => `${r.type}:${r.text}`)).toEqual([
      'equal:a', 'removed:b', 'added:b2', 'equal:c', 'equal:d'
    ]);
  });
});
