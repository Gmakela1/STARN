import {
  CircleCheck,
  CircleDot,
  FileClock,
  Lock,
  CircleDashed,
  HelpCircle,
  Award
} from 'lucide-react';
import { RoadmapPhase } from '../types/api';

interface TreasureMapRoadmapProps {
  roadmap: RoadmapPhase[];
}

/** Template paths (e.g. {GATE}, {NUM}) show their folder instead of the raw pattern. */
const displayPath = (p: string) => (p.includes('{') ? p.slice(0, p.lastIndexOf('/') + 1) : p);

export default function TreasureMapRoadmap({ roadmap }: TreasureMapRoadmapProps) {
  // Rows of 4 in natural (DOM/reading) order. Row 2 is reversed visually on
  // lg screens only (4 columns) to form the serpentine; narrower layouts stay sequential.
  const row1 = roadmap.slice(0, 4);
  const row2 = roadmap.slice(4, 8);
  const row3 = roadmap.slice(8, 12);
  const row4 = roadmap.slice(12, 13);

  const renderStation = (phase: RoadmapPhase, displayIndex: number) => {
    const isCompleted = phase.status === 'COMPLETED';
    const isInProgress = phase.status === 'IN_PROGRESS';
    const isPendingReview = phase.status === 'PENDING_REVIEW';
    const isLocked = phase.status === 'LOCKED';

    let borderClass = 'border-slate-800 bg-slate-900/60';
    let ringClass = 'bg-slate-800 text-slate-400 border-slate-700';

    if (isCompleted) {
      borderClass = 'border-emerald-500/40 bg-emerald-950/20 shadow-emerald-950/50 shadow-sm';
      ringClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50';
    } else if (isInProgress) {
      borderClass = 'border-sky-500 bg-sky-950/30 shadow-sky-900/30 shadow-md';
      ringClass = 'bg-sky-500 text-slate-950 font-bold border-sky-400';
    } else if (isPendingReview) {
      borderClass = 'border-amber-500/50 bg-amber-950/20';
      ringClass = 'bg-amber-500/20 text-amber-300 border-amber-500/50';
    }

    return (
      <div
        key={phase.id}
        className={`relative flex h-full flex-col justify-between rounded-xl border p-3.5 ${borderClass}`}
      >
        <div className="flex items-start justify-between gap-2">
          {/* Station Number Ring */}
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-mono font-bold ${ringClass}`}
          >
            {displayIndex.toString().padStart(2, '0')}
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-1">
            {isCompleted && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-950/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-800/40">
                <CircleCheck className="h-3 w-3" /> Approved
              </span>
            )}
            {isInProgress && (
              <span className="inline-flex items-center gap-1 rounded bg-sky-950/80 px-2 py-0.5 text-[10px] font-semibold text-sky-300 border border-sky-800/40 motion-safe:animate-pulse">
                <CircleDot className="h-3 w-3" /> Active Gate
              </span>
            )}
            {isPendingReview && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-950/80 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-800/40">
                <FileClock className="h-3 w-3" /> Draft
              </span>
            )}
            {isLocked && (
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-600">
                <Lock className="h-3 w-3" />
              </span>
            )}
            {!isCompleted && !isInProgress && !isPendingReview && !isLocked && (
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                <CircleDashed className="h-3 w-3" /> Pending
              </span>
            )}
          </div>
        </div>

        {/* Phase Details */}
        <div className="mt-2.5">
          <h4 className="text-sm font-bold text-slate-100">
            {phase.name}
          </h4>
          <p className="mt-0.5 font-mono text-[11px] text-slate-400 truncate" title={phase.artifactPath}>
            {displayPath(phase.artifactPath)}
          </p>
        </div>

        {/* Footer Badges: Critic Score & Open Questions */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-800/60 pt-2">
          {phase.criticScore !== undefined ? (
            <span className="inline-flex items-center gap-1 rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300 border border-amber-500/20">
              <Award className="h-3 w-3 text-amber-400" />
              {phase.criticScore.toFixed(1)}/10
            </span>
          ) : (
            <span className="text-[10px] text-slate-600">—</span>
          )}

          {phase.openQuestions > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-rose-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300 border border-rose-800/30">
              <HelpCircle className="h-3 w-3" />
              {phase.openQuestions} Q{phase.openQuestions > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            Program Roadmap
          </h3>
          <p className="text-xs text-slate-400">
            Each approved deliverable unlocks the next phase.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* ROW 1: 1 -> 4 (Left to Right) */}
        <div className="relative">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {row1.map((p, i) => renderStation(p, i + 1))}
          </div>
          {/* Connector down-right to row 2 on desktop */}
          <div className="hidden lg:block absolute -bottom-5 right-12 h-6 w-12 border-r-2 border-b-2 border-dashed border-sky-500/60 rounded-br-xl" />
        </div>

        {/* ROW 2: 8 <- 5 (Right to Left) */}
        <div className="relative">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {row2.map((p, i) => (
              <div key={p.id} className={['lg:order-4', 'lg:order-3', 'lg:order-2', 'lg:order-1'][i]}>
                {renderStation(p, 5 + i)}
              </div>
            ))}
          </div>
          {/* Connector down-left to row 3 on desktop */}
          <div className="hidden lg:block absolute -bottom-5 left-12 h-6 w-12 border-l-2 border-b-2 border-dashed border-sky-500/60 rounded-bl-xl" />
        </div>

        {/* ROW 3: 9 -> 12 (Left to Right) */}
        <div className="relative">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {row3.map((p, i) => renderStation(p, 9 + i))}
          </div>
          {/* Connector down-right to row 4 on desktop */}
          <div className="hidden lg:block absolute -bottom-5 right-12 h-6 w-12 border-r-2 border-b-2 border-dashed border-sky-500/60 rounded-br-xl" />
        </div>

        {/* ROW 4: 13 Final Station */}
        <div className="flex justify-end">
          <div className="w-full sm:w-1/2 lg:w-1/4">
            {row4.map(p => renderStation(p, 13))}
          </div>
        </div>
      </div>
    </div>
  );
}
