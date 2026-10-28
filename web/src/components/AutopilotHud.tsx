import { Square } from 'lucide-react';
import { AutopilotStatusResponse, RoadmapPhase } from '../types/api';
import PhaseRail, { PhaseRailItem } from './PhaseRail';
import { railStateFor } from '../lib/workflowState';

export interface AutopilotHudProps {
  status: AutopilotStatusResponse | null;
  enabled: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  /** Phase names for the 13-dot rail */
  phaseNames?: string[];
  /** Roadmap phases — supplies roadmapStatus + docExists to the 5-state mapper. */
  roadmap?: RoadmapPhase[];
  /** Dot-click → phase select (reuses the doc-dropdown onSelect pattern). */
  onSelectPhase?: (id: string) => void;
}

// Real phase order from ORDERED_WORKFLOW_PHASES (src/workspace/state.ts).
// Abbreviated labels for the compact 13-dot rail.
const PHASE_LABELS = [
  'CONOPS', 'Architecture', 'ICD', 'Capabilities', 'Requirements',
  'BOM', 'RTM', 'Milestones', 'Risk', 'Build Seq',
  'WI', 'Test Plans', 'SOW'
];

// Real phase ids matching ORDERED_WORKFLOW_PHASES (src/workspace/state.ts).
// These are the keys the server uses in docStatus, so the lookup must match.
const PHASE_IDS = [
  'conops', 'architecture', 'icd', 'capabilities', 'requirements',
  'bom', 'rtm', 'milestones', 'risk-register', 'build-sequence',
  'work-instructions', 'testplans', 'sow'
];

/**
 * Autopilot toggle + 5-state progress rail (thin wrapper around PhaseRail).
 * S7: progress rail IS the status locus.
 */
export default function AutopilotHud({
  status,
  enabled,
  onStart,
  onStop,
  phaseNames,
  roadmap,
  onSelectPhase
}: AutopilotHudProps) {
  // When autopilot is disabled in settings, render nothing.
  if (!enabled) return null;

  const running = status?.running ?? false;
  const docStatus = status?.docStatus ?? {};
  const totalPhases = status?.totalPhases ?? 13;
  const labels = phaseNames ?? PHASE_LABELS;

  // S6: re-draft ripple — track which dots were affected
  const parkedCount = Object.values(docStatus).filter(v => v === 'parked').length;
  const draftingCount = Object.values(docStatus).filter(v => v === 'drafting').length;
  const autoApprovedCount = Object.values(docStatus).filter(v => v === 'auto-approved').length;

  const statusWord = running
    ? draftingCount > 0
      ? 'Working…'
      : 'Idle'
    : parkedCount > 0
      ? `${parkedCount} parked`
      : autoApprovedCount > 0
        ? `${autoApprovedCount} auto-approved`
        : 'Idle';

  // 5-state mapper (§5.F): docStatus + roadmapStatus + docExists per phase.
  const items: PhaseRailItem[] = PHASE_IDS.slice(0, 13).map((phaseId, idx) => {
    const roadmapPhase = roadmap?.find(p => p.id === phaseId);
    const view = railStateFor({
      docStatus: docStatus[phaseId] ?? 'idle',
      roadmapStatus: roadmapPhase?.status,
      docExists: roadmapPhase?.docExists
    });
    return {
      id: phaseId,
      name: labels[idx] ?? phaseId,
      view,
      isActive: view.state === 'in-progress'
    };
  });
  const approvedCount = items.filter(i => i.view.state === 'approved').length;

  return (
    <div className="bg-slate-900/80 border-b border-slate-800">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        {/* 5-state rail — replaces the old color-only 13-dot row */}
        <PhaseRail
          items={items}
          approvedCount={approvedCount}
          total={totalPhases}
          onSelect={id => onSelectPhase?.(id)}
          className="flex-1 min-w-0"
        />

        {/* Status word or Start button */}
        {running ? (
          <span className="text-[10px] font-mono text-slate-500 shrink-0">
            {statusWord}
          </span>
        ) : (
          <button
            onClick={() => void onStart()}
            className="shrink-0 flex items-center gap-1 rounded-md bg-cyan-600 px-3 py-1 text-[11px] font-bold text-white transition hover:bg-cyan-500"
            aria-label="Start autopilot auto-drafting"
          >
            Start Auto-Drafting
          </button>
        )}

        {/* Stop button */}
        {running && (
          <button
            onClick={() => void onStop()}
            className="flex h-5 w-5 items-center justify-center rounded bg-rose-600 text-white hover:bg-rose-500"
            aria-label="Stop autopilot"
          >
            <Square className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
