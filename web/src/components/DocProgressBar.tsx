import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoadmapPhase } from '../types/api';

export interface DocProgressBarProps {
  phases: RoadmapPhase[];
  docStatus: Record<string, string>;
  totalPhases: number;
  openQuestions: number;
  onNavigateToDashboard: () => void;
}

export function computeProgress(
  phases: RoadmapPhase[],
  docStatus: Record<string, string> | null,
  openQuestions: number
): {
  approved: number;
  drafted: number;
  notStarted: number;
  openQuestions: number;
  greenCount: number;
} {
  const status = docStatus ?? {};
  const total = phases.length || 13;
  let approved = 0;
  let drafted = 0;

  for (const phase of phases) {
    const docResult = status[phase.id];
    const isApproved =
      docResult === 'passed' ||
      docResult === 'auto-approved' ||
      phase.status === 'COMPLETED';
    const isDrafted =
      !isApproved &&
      (phase.docExists === true ||
        phase.status === 'PENDING_REVIEW' ||
        docResult === 'drafted');

    if (isApproved) approved++;
    else if (isDrafted) drafted++;
  }

  const greenCount = Math.max(0, approved - openQuestions);
  const notStarted = total - approved - drafted;

  return {
    approved,
    drafted,
    notStarted,
    openQuestions,
    greenCount,
  };
}

export default function DocProgressBar({
  phases,
  docStatus,
  totalPhases,
  openQuestions,
  onNavigateToDashboard,
}: DocProgressBarProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const progress = computeProgress(phases, docStatus, openQuestions);
  const total = totalPhases || 13;

  const greenPct = total > 0 ? (progress.greenCount / total) * 100 : 0;
  const draftedPct = total > 0 ? (progress.drafted / total) * 100 : 0;

  // Close popover on click-outside
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      popoverRef.current &&
      !popoverRef.current.contains(e.target as Node) &&
      containerRef.current &&
      !containerRef.current.contains(e.target as Node)
    ) {
      setPopoverOpen(false);
    }
  }, []);

  // Close popover on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setPopoverOpen(false);
  }, []);

  useEffect(() => {
    if (popoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [popoverOpen, handleClickOutside, handleKeyDown]);

  return (
    <div className="relative flex items-center gap-2" ref={containerRef}>
      {/* Progress bar */}
      <div
        role="progressbar"
        aria-valuenow={progress.greenCount + progress.drafted}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`Project progress: ${progress.greenCount + progress.drafted} of ${total} phases complete`}
        className="h-6 w-28 cursor-pointer overflow-hidden rounded bg-slate-700 sm:w-36"
        onClick={() => setPopoverOpen((prev) => !prev)}
      >
        <div className="flex h-full w-full">
          {greenPct > 0 && (
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${greenPct}%` }}
            />
          )}
          {draftedPct > 0 && (
            <div
              className="h-full"
              style={{
                width: `${draftedPct}%`,
                background:
                  'repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(56,189,248,0.5) 4px,rgba(56,189,248,0.5) 8px)',
              }}
            />
          )}
        </div>
      </div>

      {/* Open-question badge */}
      {openQuestions > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 text-[10px] font-bold text-amber-300 min-w-[18px]"
          aria-hidden
        >
          {openQuestions}
        </span>
      )}

      {/* Popover */}
      {popoverOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Project status details"
          className="absolute top-full right-0 z-50 mt-2 w-72 rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl sm:left-auto max-sm:left-0 max-sm:right-0"
        >
          <h3 className="mb-3 text-sm font-bold text-slate-200">
            Project Status
          </h3>

          <div className="space-y-2">
            {/* Approved row */}
            <div className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              <span className="flex-1 text-slate-300">Approved</span>
              <span className="font-mono text-slate-100 font-semibold tabular-nums">
                {progress.approved}
              </span>
              <div className="h-2 w-16 overflow-hidden rounded bg-slate-700">
                <div
                  className="h-full bg-emerald-500"
                  style={{
                    width: `${total > 0 ? (progress.approved / total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* Drafted row */}
            <div className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-full bg-sky-600" aria-hidden />
              <span className="flex-1 text-slate-300">Drafted</span>
              <span className="font-mono text-slate-100 font-semibold tabular-nums">
                {progress.drafted}
              </span>
              <div className="h-2 w-16 overflow-hidden rounded bg-slate-700">
                <div
                  className="h-full"
                  style={{
                    width: `${total > 0 ? (progress.drafted / total) * 100 : 0}%`,
                    background:
                      'repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(56,189,248,0.5) 4px,rgba(56,189,248,0.5) 8px)',
                  }}
                />
              </div>
            </div>

            {/* Not started row */}
            <div className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 rounded-full bg-slate-600"
                aria-hidden
              />
              <span className="flex-1 text-slate-300">Not started</span>
              <span className="font-mono text-slate-100 font-semibold tabular-nums">
                {progress.notStarted}
              </span>
              <div className="h-2 w-16 overflow-hidden rounded bg-slate-700">
                <div className="h-full bg-slate-600" style={{ width: '100%' }} />
              </div>
            </div>
          </div>

          {/* Open questions row */}
          <div className="mt-3 flex items-center gap-2 border-t border-slate-700 pt-3 text-xs">
            <span
              className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/20 text-[10px] text-amber-300 font-bold"
              aria-hidden
            >
              ?
            </span>
            <span className="flex-1 text-slate-300">Open questions</span>
            <span className="font-mono text-amber-300 font-semibold tabular-nums">
              {progress.openQuestions}
            </span>
          </div>

          {/* View full status report button */}
          <button
            type="button"
            onClick={onNavigateToDashboard}
            className="mt-3 w-full rounded-lg border border-cyan-500/40 bg-cyan-950/50 px-3 py-2 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-900/60"
          >
            View full status report
          </button>
        </div>
      )}
    </div>
  );
}