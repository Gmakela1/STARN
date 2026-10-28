import { ReactNode, useId, useState } from 'react';
import { Check, Circle, CircleSlash2, Hourglass, Info, Loader2, Lock, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PhaseRailView } from '../lib/workflowState';

/**
 * 5-state build-phase rail (design §5.F + §5.G + §6).
 * One focusable button per phase; shape + icon + text per state (never color
 * alone); aria-current="step" on the single in-progress item; a legend toggle;
 * an sr-only count + sr-only legend vocabulary; and a narrow summary-chip
 * compaction whose popover carries the full dot list + legend.
 */

export interface PhaseRailItem {
  id: string;
  name: string;
  view: PhaseRailView;
  isActive: boolean;
}

interface PhaseRailProps {
  items: PhaseRailItem[];
  approvedCount: number;
  total?: number;
  /** Compact single-chip mode for narrow panes (§5.G). */
  narrow?: boolean;
  className?: string;
  onSelect: (id: string) => void;
}

const LEGEND: Array<{ label: string; Icon: LucideIcon }> = [
  { label: 'Not started', Icon: Circle },
  { label: 'In progress', Icon: Loader2 },
  { label: 'Drafted — awaiting review', Icon: Hourglass },
  { label: 'Approved', Icon: Check },
  { label: 'Error — needs attention', Icon: CircleSlash2 },
];

export default function PhaseRail({
  items,
  approvedCount,
  total = 13,
  narrow = false,
  className,
  onSelect,
}: PhaseRailProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const popoverId = useId();
  const firstActive = items.find(it => it.view.state === 'in-progress') ?? items[0];

  const dotButton = (item: PhaseRailItem): ReactNode => (
    <button
      key={item.id}
      type="button"
      onClick={() => onSelect(item.id)}
      aria-label={`${item.name} — ${item.view.label}`}
      title={`${item.name} — ${item.view.label}`}
      aria-current={item.isActive ? 'step' : undefined}
      className="flex h-5 w-5 min-h-[24px] min-w-[24px] items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/40"
    >
      {markerForView(item.view)}
    </button>
  );

  return (
    <div
      role="group"
      aria-label="Build phases"
      className={`relative flex items-center gap-2 ${className ?? ''}`}
    >
      {narrow ? (
        <button
          type="button"
          onClick={() => setLegendOpen(v => !v)}
          aria-expanded={legendOpen}
          aria-controls={popoverId}
          title="Phase states"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 text-[11px] font-mono text-slate-300 transition hover:bg-slate-900 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
        >
          <Check className="h-3 w-3 text-emerald-400" aria-hidden />
          {approvedCount}/{total} · {firstActive?.name ?? ''}
        </button>
      ) : (
        <>
          <ol role="list" aria-label="Build phase states" className="flex items-center gap-[6px]">
            {items.map(item => (
              <li key={item.id}>{dotButton(item)}</li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setLegendOpen(v => !v)}
            aria-expanded={legendOpen}
            aria-controls={popoverId}
            aria-label="Show phase state legend"
            title="Phase states"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-800 hover:text-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          >
            <Info className="h-4 w-4" aria-hidden />
          </button>
        </>
      )}

      {legendOpen && (
        <div
          id={popoverId}
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl"
        >
          {narrow && (
            <>
              <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Build phases
              </p>
              <ol role="list" className="mb-2 flex items-center gap-[6px] px-1">
                {items.map(item => (
                  <li key={`${item.id}-pop`}>{dotButton(item)}</li>
                ))}
              </ol>
            </>
          )}
          <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Phase states
          </p>
          <ul role="list" className="space-y-1">
            {LEGEND.map(({ label, Icon }) => (
              <li key={label} className="flex items-center gap-2.5 px-1 py-0.5 text-xs text-slate-300">
                <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full border border-slate-600">
                  <Icon className="h-3 w-3 text-slate-400" aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {approvedCount} of {total} approved
      </p>
      <ul className="sr-only" aria-label="Phase state legend">
        {LEGEND.map(({ label }) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </div>
  );
}

/** Marker glyph by rail state — exact design tokens (§5.F marker sizes). */
function markerForView(view: PhaseRailView): ReactNode {
  const base = 'flex h-3 w-3 items-center justify-center rounded-full border';
  switch (view.state) {
    case 'not-started':
      return (
        <span className={`${base} border-slate-600 bg-transparent ${view.locked ? 'relative' : ''}`}>
          <Circle className="h-3 w-3 text-slate-600" aria-hidden />
          {view.locked && <Lock className="absolute -right-1 -top-1 h-2 w-2 text-slate-400" aria-hidden />}
        </span>
      );
    case 'in-progress':
      return (
        <span className={`${base} border-cyan-400 bg-cyan-500/20`}>
          <Loader2 className="h-2.5 w-2.5 text-cyan-300 motion-safe:animate-spin" aria-hidden />
        </span>
      );
    case 'drafted':
      return (
        <span className={`${base} border-amber-400 bg-amber-500/40`}>
          <Hourglass className="h-2.5 w-2.5 text-amber-300" aria-hidden />
        </span>
      );
    case 'approved':
      return (
        <span className={`${base} relative border-emerald-400 bg-emerald-500`}>
          <Check className="h-2.5 w-2.5 text-emerald-950" aria-hidden />
          {view.auto && <Sparkles className="absolute -right-1 -top-1 h-2 w-2 text-sky-300" aria-hidden />}
        </span>
      );
    case 'error-parked':
      return (
        <span className={`${base} border-rose-500 bg-rose-950/60`}>
          <CircleSlash2 className="h-2.5 w-2.5 text-rose-300" aria-hidden />
        </span>
      );
  }
}
