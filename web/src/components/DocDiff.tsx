// GitHub-style unified line diff for the revised-doc view (red/green content
// semantics ONLY — this is the one surface where red/green rows are allowed).
import { useMemo } from 'react';
import { diffLines } from '../lib/lineDiff';

export interface DocDiffProps {
  /** Last-approved document content. */
  approved: string;
  /** Current on-disk document content. */
  current: string;
}

/**
 * Renders a line-level diff between the approved snapshot and the current
 * document. Removed lines = original (red bg), added lines = new (green bg).
 * Monospace unified rows; no animations (reduced-motion safe by construction).
 */
export default function DocDiff({ approved, current }: DocDiffProps) {
  const rows = useMemo(() => diffLines(approved, current), [approved, current]);
  const added = rows.filter(r => r.type === 'added').length;
  const removed = rows.filter(r => r.type === 'removed').length;

  return (
    <div
      className="max-w-[80ch] overflow-x-auto rounded-lg border border-[#3b4658] bg-[#05070c]"
      aria-label="Document diff"
    >
      <p className="border-b border-[#3b4658] px-3 py-1.5 font-mono text-[11px] text-[#a8b3c4]">
        {added} lines added, {removed} lines removed
      </p>
      <div className="p-1 font-mono text-[12px] leading-relaxed">
        {rows.map((row, i) => {
          let sign = ' ';
          let cls = 'text-[#6e7d92]';
          if (row.type === 'added') {
            sign = '+';
            cls = 'bg-[#14532d]/40 text-[#dcfce7]';
          } else if (row.type === 'removed') {
            sign = '−';
            cls = 'bg-[#7f1d1d]/40 text-[#fecaca]';
          }
          return (
            <div key={i} className={`flex ${cls}`}>
              <span className="w-6 shrink-0 select-none text-right pr-1">{sign}</span>
              <span className="whitespace-pre-wrap break-all">{row.text === '' ? '\u00A0' : row.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
