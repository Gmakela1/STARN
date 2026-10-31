import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RoadmapPhase } from '../types/api';

export interface DocProgressBarProps {
  phases: RoadmapPhase[];
  docStatus: Record<string, string>;
  totalPhases: number;
  onNavigateToDashboard: () => void;
}

export function computeProgress(
  phases: RoadmapPhase[],
  docStatus: Record<string, string> | null
): {
  approved: number;
  drafted: number;
  notStarted: number;
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

  const greenCount = approved;
  const notStarted = total - approved - drafted;

  return {
    approved,
    drafted,
    notStarted,
    greenCount,
  };
}

export default function DocProgressBar({
  phases,
  docStatus,
  totalPhases,
  onNavigateToDashboard,
}: DocProgressBarProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  const progress = computeProgress(phases, docStatus);
  const total = totalPhases || 13;
  const progressLabel = `Project progress: ${progress.greenCount} of ${total} documents approved`;

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
    if (e.key === 'Escape') {
      setPopoverOpen(false);
      triggerRef.current?.focus();
    }
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
      {/* Progress bar trigger */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-controls={popoverId}
        aria-label={progressLabel}
        onClick={() => setPopoverOpen((prev) => !prev)}
        className="flex cursor-pointer items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3c]"
      >
        <div
          role="progressbar"
          aria-valuenow={progress.greenCount}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={progressLabel}
          className="h-6 w-28 overflow-hidden rounded bg-[#171c26] sm:w-36"
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
        <span className="hidden text-[11px] font-semibold text-[#a8b3c4] tabular-nums lg:inline">
          Docs {progress.approved}/{total}
        </span>
      </button>

      {/* Popover */}
      {popoverOpen && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label="Project status details"
          className="absolute top-full right-0 z-50 mt-2 w-72 rounded-lg border border-[#3b4658] bg-[#0d1017] p-4 shadow-xl sm:left-auto max-sm:left-0 max-sm:right-0"
        >
          <h3 className="mb-3 text-sm font-bold text-[#e8edf5]">
            Document progress
          </h3>

          <div className="space-y-2">
            {/* Approved row */}
            <div className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              <span className="flex-1 text-[#a8b3c4]">Approved</span>
              <span className="font-mono text-[#e8edf5] font-semibold tabular-nums">
                {progress.approved}
              </span>
              <div className="h-2 w-16 overflow-hidden rounded bg-[#171c26]">
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
              <span className="flex-1 text-[#a8b3c4]">Drafted</span>
              <span className="font-mono text-[#e8edf5] font-semibold tabular-nums">
                {progress.drafted}
              </span>
              <div className="h-2 w-16 overflow-hidden rounded bg-[#171c26]">
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
                className="h-2 w-2 rounded-full bg-[#2a3342]"
                aria-hidden
              />
              <span className="flex-1 text-[#a8b3c4]">Not started</span>
              <span className="font-mono text-[#e8edf5] font-semibold tabular-nums">
                {progress.notStarted}
              </span>
              <div className="h-2 w-16 overflow-hidden rounded bg-[#171c26]">
                <div className="h-full bg-[#2a3342]" style={{ width: '100%' }} />
              </div>
            </div>
          </div>

          {/* View full status report button */}
          <button
            type="button"
            onClick={onNavigateToDashboard}
            className="mt-3 w-full rounded-lg border border-[#ff2a3c]/45 bg-[#1a0208]/60 px-3 py-2 text-xs font-semibold text-[#ffb3bd] transition-colors hover:bg-[#1a0208]/90"
          >
            View full status report
          </button>
        </div>
      )}
    </div>
  );
}