import { type Ref } from 'react';
import { CheckCircle2, ChevronDown, Clock3, MessageSquare } from 'lucide-react';

export interface QuestionBadgeProps {
  /** Open (pending) items — the count pill. */
  count: number;
  /** Items in queued or applying answer state — the Clock3 chip. */
  queuedCount: number;
  /** Open items with severity 'blocking' — turns the pill/dot rose. */
  blockingCount: number;
  /** Items in applied answer state — the muted resolved readout. */
  resolvedCount: number;
  /** Panel surface state; aria-expanded mirrors whether it is fully open. */
  surface: 'closed' | 'open' | 'minimized';
  /** Checkpoint pending: render the compact subdued line instead of the full strip. */
  subdued: boolean;
  /** Ref to the trigger button, so the parent can restore focus on close (a11y). */
  buttonRef?: Ref<HTMLButtonElement>;
  /** Open the question panel (parent owns the surface transition). */
  onOpen: () => void;
}

/**
 * §8.3 — left-pane trigger for the right-pane question panel. Pure
 * presentational: all counts derive from DevelopmentView state.
 *
 * Three render states:
 * 1. nothing pending/queued/resolved → null (hidden entirely).
 * 2. checkpoint pending → compact h-8 subdued line. Still a real, operable
 *    <button> (D9: a portal answer is not checkpoint-locked; stranding pending
 *    questions behind the checkpoint would make the panel unreachable).
 * 3. otherwise → full clickable strip with count pill, queued chip, resolved
 *    readout, and a chevron that rotates when the panel is open.
 */
export default function QuestionBadge({
  count,
  queuedCount,
  blockingCount,
  resolvedCount,
  surface,
  subdued,
  onOpen,
  buttonRef,
}: QuestionBadgeProps) {
  // Hidden entirely: nothing pending, nothing queued, nothing resolved.
  if (count === 0 && queuedCount === 0 && resolvedCount === 0) {
    return null;
  }

  const statusLabel = [
    'Open questions from AI',
    count > 0 ? `${count} pending` : null,
    queuedCount > 0 ? `${queuedCount} queued` : null,
    blockingCount > 0 ? `${blockingCount} blocking` : null,
    resolvedCount > 0 ? `${resolvedCount} resolved` : null,
  ]
    .filter(Boolean)
    .join(', ');

  // §3 — lifecycle dot: rose when any parked/blocking item, sky when answers
  // are queued/applying, amber for plain pending. The chip text always carries
  // the status word, so color is never the only signal.
  let dotClass = 'bg-amber-400';
  if (blockingCount > 0) {
    dotClass = 'bg-rose-400';
  } else if (queuedCount > 0) {
    dotClass = 'bg-sky-400';
  }

  if (subdued) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={surface === 'open'}
        aria-controls="question-panel"
        aria-label={statusLabel}
        ref={buttonRef}
        className="flex h-8 w-full items-center gap-2 border-t border-slate-800 bg-slate-900/60 px-3 opacity-60 transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
        <span className="truncate text-[11px] font-medium text-amber-300">
          {count} pending{queuedCount > 0 ? ` · ${queuedCount} queued` : ''}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={surface === 'open'}
      aria-controls="question-panel"
      aria-label={statusLabel}
      ref={buttonRef}
      className={`flex min-h-[44px] w-full items-center gap-2 border-l-2 bg-slate-900/80 px-3 transition hover:bg-slate-800/80 focus:outline-none focus:ring-2 focus:ring-sky-500/40 ${
        blockingCount > 0 ? 'border-rose-500' : 'border-amber-500'
      }`}
    >
      <span
        key={count}
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass} animate-question-arrive`}
        aria-hidden
      />
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
        <MessageSquare className="h-3 w-3 text-amber-400" aria-hidden />
      </span>
      <span className="truncate text-xs font-medium text-amber-200">Needs Input</span>
      {queuedCount > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-700/50 bg-sky-950/40 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
          <Clock3 className="h-3 w-3" aria-hidden />
          {queuedCount} queued
        </span>
      )}
      {count > 0 && (
        <span
          className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
            blockingCount > 0
              ? 'border border-rose-800 bg-rose-950/60 text-rose-200'
              : 'bg-slate-800 text-cyan-300'
          }`}
        >
          {count}
        </span>
      )}
      {resolvedCount > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
          <CheckCircle2 className="h-3 w-3 text-emerald-400/80" aria-hidden />
          {resolvedCount} resolved
        </span>
      )}
      <ChevronDown
        className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${surface !== 'closed' ? 'rotate-180' : ''}`}
        aria-hidden
      />
    </button>
  );
}