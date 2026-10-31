import React from 'react';
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
import { PHASE_SUBTITLES } from './roadmapMeta';

interface TreasureMapRoadmapProps {
  roadmap: RoadmapPhase[];
  onSelectPhase?: (phaseId: string) => void;
  hideHeader?: boolean;
}

/** Template paths (e.g. {GATE}, {NUM}) show their folder instead of the raw pattern. */
const displayPath = (p: string) => (p.includes('{') ? p.slice(0, p.lastIndexOf('/') + 1) : p);

// PHASE_SUBTITLES imported from roadmapMeta.ts

interface ConnectorArrowProps {
  dir: 'right' | 'left' | 'down';
  active: boolean;
}

const ConnectorArrow: React.FC<ConnectorArrowProps> = ({ dir, active }) => {
  const colorClass = active ? 'text-emerald-400' : 'text-[#6e7d92]';

  if (dir === 'right') {
    return (
      <div className={`flex items-center justify-center ${colorClass}`} aria-hidden="true">
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14M13 6l6 6-6 6" strokeDasharray={active ? undefined : '3 3'} />
        </svg>
      </div>
    );
  }

  if (dir === 'left') {
    return (
      <div className={`flex items-center justify-center ${colorClass}`} aria-hidden="true">
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5M11 6l-6 6 6 6" strokeDasharray={active ? undefined : '3 3'} />
        </svg>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${colorClass}`} aria-hidden="true">
      <svg
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14M6 13l6 6 6-6" strokeDasharray={active ? undefined : '3 3'} />
      </svg>
    </div>
  );
};

export default function TreasureMapRoadmap({ roadmap, onSelectPhase, hideHeader }: TreasureMapRoadmapProps) {
  const row1 = roadmap.slice(0, 4);
  const row2 = roadmap.slice(4, 8);
  const row3 = roadmap.slice(8, 12);
  const row4 = roadmap.slice(12, 13);

  const renderStation = (phase: RoadmapPhase, displayIndex: number) => {
    const isCompleted = phase.status === 'COMPLETED';
    const isInProgress = phase.status === 'IN_PROGRESS';
    const isPendingReview = phase.status === 'PENDING_REVIEW';
    const isLocked = phase.status === 'LOCKED';

    let borderClass = 'border-[#2a3342] bg-[#0d1017]/70';
    let ringClass = 'bg-[#11151d] text-[#a8b3c4] border-[#3b4658]';

    if (isCompleted) {
      borderClass = 'border-emerald-500/40 bg-emerald-950/20 shadow-emerald-950/50 shadow-sm';
      ringClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50';
    } else if (isInProgress) {
      borderClass = 'border-sky-500 bg-sky-950/30 shadow-sky-900/30 shadow-md';
      ringClass = 'bg-sky-500 text-[#05070c] font-bold border-sky-400';
    } else if (isPendingReview) {
      borderClass = 'border-amber-500/50 bg-amber-950/20';
      ringClass = 'bg-amber-500/20 text-amber-300 border-amber-500/50';
    }

    const isClickable = Boolean(onSelectPhase);
    const interactiveProps = isClickable
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick: () => onSelectPhase?.(phase.id),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectPhase?.(phase.id);
            }
          },
          'aria-label': `Open ${phase.name} in Studio`,
          title: `Open ${phase.name} in Studio`
        }
      : {};

    return (
      <div
        key={phase.id}
        {...interactiveProps}
        className={`group relative flex h-full flex-col justify-between rounded-xl border p-3.5 transition-all ${borderClass} ${
          isClickable
            ? 'cursor-pointer hover:border-[#ff2a3c] hover:shadow-lg hover:shadow-[#1a0208]/40 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3c]'
            : ''
        }`}
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
              <span className="inline-flex items-center gap-1 text-[10px] text-[#6e7d92]">
                <Lock className="h-3 w-3" />
              </span>
            )}
            {!isCompleted && !isInProgress && !isPendingReview && !isLocked && (
              <span className="inline-flex items-center gap-1 text-[10px] text-[#6e7d92]">
                <CircleDashed className="h-3 w-3" /> Pending
              </span>
            )}
          </div>
        </div>

        {/* Phase Details */}
        <div className="mt-2.5">
          <h4 className="text-sm font-bold text-[#e8edf5] group-hover:text-[#ffb3bd] transition-colors">{phase.name}</h4>
          <p className="text-[10px] font-medium text-[#ffb3bd]/80 leading-tight truncate">
            {PHASE_SUBTITLES[phase.id] || 'Milestone Deliverable'}
          </p>
          <p
            className="mt-0.5 font-mono text-[11px] text-[#a8b3c4] truncate"
            title={phase.artifactPath}
          >
            {displayPath(phase.artifactPath)}
          </p>
        </div>

        {/* Footer Badges: Critic Score & Open Questions */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[#2a3342]/60 pt-2">
          {phase.criticScore !== undefined ? (
            <span className="inline-flex items-center gap-1 rounded bg-[#11151d]/90 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300 border border-amber-500/20">
              <Award className="h-3 w-3 text-amber-400" />
              {phase.criticScore.toFixed(1)}/10
            </span>
          ) : (
            <span className="text-[10px] text-[#6e7d92]">—</span>
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
    <div className="rounded-2xl border border-[#2a3342] bg-[#0d1017]/70 p-5 backdrop-blur-sm">
      {!hideHeader && (
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              Program Roadmap
            </h3>
            <p className="text-xs text-[#a8b3c4]">Each approved deliverable unlocks the next phase.</p>
          </div>
        </div>
      )}

      {/* Mobile / Tablet vertical view (< lg) */}
      <div className="lg:hidden space-y-3">
        {roadmap.map((p, idx) => (
          <React.Fragment key={p.id}>
            {renderStation(p, idx + 1)}
            {idx < roadmap.length - 1 && (
              <div className="flex justify-center py-1">
                <ConnectorArrow dir="down" active={p.status === 'COMPLETED'} />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Desktop Serpentine Grid (lg+) */}
      <div className="hidden lg:block space-y-3">
        {/* ROW 1: 1 -> 4 */}
        <div className="grid grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] items-center">
          {row1[0] && renderStation(row1[0], 1)}
          <ConnectorArrow dir="right" active={row1[0]?.status === 'COMPLETED'} />
          {row1[1] && renderStation(row1[1], 2)}
          <ConnectorArrow dir="right" active={row1[1]?.status === 'COMPLETED'} />
          {row1[2] && renderStation(row1[2], 3)}
          <ConnectorArrow dir="right" active={row1[2]?.status === 'COMPLETED'} />
          {row1[3] && renderStation(row1[3], 4)}
        </div>

        {/* Row 1 -> Row 2 Connector (Right edge, under pos 4 / over pos 5) */}
        <div className="grid grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] py-1">
          <div className="col-start-7 flex justify-center">
            <ConnectorArrow dir="down" active={row1[3]?.status === 'COMPLETED'} />
          </div>
        </div>

        {/* ROW 2: 8 <- 5 (Card 8 in col 1, Card 5 in col 7) */}
        <div className="grid grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] items-center">
          {row2[3] && renderStation(row2[3], 8)}
          <ConnectorArrow dir="left" active={row2[2]?.status === 'COMPLETED'} />
          {row2[2] && renderStation(row2[2], 7)}
          <ConnectorArrow dir="left" active={row2[1]?.status === 'COMPLETED'} />
          {row2[1] && renderStation(row2[1], 6)}
          <ConnectorArrow dir="left" active={row2[0]?.status === 'COMPLETED'} />
          {row2[0] && renderStation(row2[0], 5)}
        </div>

        {/* Row 2 -> Row 3 Connector (Left edge, under pos 8 / over pos 9) */}
        <div className="grid grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] py-1">
          <div className="col-start-1 flex justify-center">
            <ConnectorArrow dir="down" active={row2[3]?.status === 'COMPLETED'} />
          </div>
        </div>

        {/* ROW 3: 9 -> 12 */}
        <div className="grid grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] items-center">
          {row3[0] && renderStation(row3[0], 9)}
          <ConnectorArrow dir="right" active={row3[0]?.status === 'COMPLETED'} />
          {row3[1] && renderStation(row3[1], 10)}
          <ConnectorArrow dir="right" active={row3[1]?.status === 'COMPLETED'} />
          {row3[2] && renderStation(row3[2], 11)}
          <ConnectorArrow dir="right" active={row3[2]?.status === 'COMPLETED'} />
          {row3[3] && renderStation(row3[3], 12)}
        </div>

        {/* Row 3 -> Row 4 Connector (Right edge, under pos 12 / over pos 13) */}
        <div className="grid grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] py-1">
          <div className="col-start-7 flex justify-center">
            <ConnectorArrow dir="down" active={row3[3]?.status === 'COMPLETED'} />
          </div>
        </div>

        {/* ROW 4: 13 Final Station (in col 7) */}
        <div className="grid grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] items-center">
          <div className="col-start-7">
            {row4[0] && renderStation(row4[0], 13)}
          </div>
        </div>
      </div>
    </div>
  );
}
