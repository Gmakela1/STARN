// Line-level diff for the revised-doc view (GitHub-style, no new deps).

export interface DiffLine {
  type: 'equal' | 'added' | 'removed';
  text: string;
}

/**
 * Computes a line-level LCS diff between two documents.
 * Inputs: before/after raw strings (split on '\n').
 * Returns unified-order rows: equal lines shared, then removed/added pairs.
 * Throws nothing; empty/undefined-safe.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  // LCS length table (n+1 x m+1).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'equal', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      out.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'removed', text: a[i++] });
  while (j < m) out.push({ type: 'added', text: b[j++] });
  return out;
}
