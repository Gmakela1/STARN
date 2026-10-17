import { describe, it, expect } from 'vitest';
import { layoutSnakeRows } from '../src/core/formatters.js';

describe('layoutSnakeRows', () => {
  it('splits 13 items into 4 rows with alternating ltr/rtl directions', () => {
    const rows = layoutSnakeRows(13, 4);
    expect(rows).toEqual([
      { indices: [0, 1, 2, 3], direction: 'ltr' },
      { indices: [4, 5, 6, 7], direction: 'rtl' },
      { indices: [8, 9, 10, 11], direction: 'ltr' },
      { indices: [12], direction: 'rtl' }
    ]);
  });

  it('handles counts smaller than perRow', () => {
    expect(layoutSnakeRows(3, 4)).toEqual([{ indices: [0, 1, 2], direction: 'ltr' }]);
  });

  it('handles exact multiples of perRow', () => {
    expect(layoutSnakeRows(8, 4)).toEqual([
      { indices: [0, 1, 2, 3], direction: 'ltr' },
      { indices: [4, 5, 6, 7], direction: 'rtl' }
    ]);
  });
});
