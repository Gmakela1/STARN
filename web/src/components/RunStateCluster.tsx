import { CheckCircle2, Loader2, MessageSquare, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RunState } from '../lib/runState';

/**
 * Run-state cluster (design §5.H + §5.G + §6).
 * One line: [marker][label] (or the failed detail).
 * Every state carries a distinct icon AND a distinct word (never color alone);
 * the word is also exposed via `aria-label` so the icon choice is verifiable.
 */

export interface RunStateClusterProps {
  runState: RunState;
  /** Failed state only: says what is wrong instead of the generic word. */
  detail?: string;
  /** Failed state only: longer reason, exposed as a tooltip on the detail. */
  detailTitle?: string;
}

const STATE_VIEW: Record<RunState, { word: string; text: string }> = {
  working: { word: 'Working…', text: 'text-cyan-300' },
  waiting: { word: 'Waiting for your answer', text: 'text-amber-300' },
  finished: { word: 'Finished', text: 'text-emerald-300' },
  failed: { word: 'Needs attention', text: 'text-rose-300' },
  ready: { word: 'Agents Ready', text: 'text-emerald-300' },
};

function markerFor(runState: RunState): ReactNode {
  switch (runState) {
    case 'working':
      return <Loader2 className="h-3.5 w-3.5 shrink-0 text-cyan-300 motion-safe:animate-spin" aria-hidden />;
    case 'waiting':
      return <MessageSquare className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />;
    case 'finished':
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />;
    case 'failed':
      return <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-rose-300" aria-hidden />;
    default:
      return <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />;
  }
}

export default function RunStateCluster({ runState, detail, detailTitle }: RunStateClusterProps) {
  const view = STATE_VIEW[runState];
  const hasDetail = runState === 'failed' && typeof detail === 'string' && detail.length > 0;
  const word = hasDetail ? detail : view.word;
  const wordTitle = hasDetail ? detailTitle : undefined;

  return (
    <span
      role="status"
      data-run-state={runState}
      aria-label={`Agents status: ${word}`}
      className="inline-flex min-w-0 items-center gap-1.5"
    >
      <span className="inline-flex shrink-0 items-center gap-1.5">
        {markerFor(runState)}
        <span className={`whitespace-nowrap text-xs font-semibold ${view.text}`} title={wordTitle}>
          {word}
        </span>
      </span>
    </span>
  );
}
