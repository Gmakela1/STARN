import { Square } from 'lucide-react';
import { AutopilotStatusResponse } from '../types/api';

export interface AutopilotHudProps {
  status: AutopilotStatusResponse | null;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onResume: (docId?: string) => void;
  onEditDoc?: (docId?: string) => void;
  /** Parked doc items to show inline (from portal items filtered to type='parked') */
  parkedDocs?: Array<{ id: string; title: string; docPath?: string; gaps?: string[] }>;
  /** Phase names for the 13-dot rail */
  phaseNames?: string[];
}

const PHASE_LABELS = [
  'CONOPS', 'Architecture', 'ICD', 'BOM', 'Electrical',
  'Assembly', 'Software', 'Test Plan', 'Safety', 'Manual',
  'Training', 'Compliance', 'Handover'
];

/**
 * Autopilot toggle + 13-dot progress rail + parked doc card.
 * S7: progress rail IS the status locus.
 */
export default function AutopilotHud({
  status,
  onStart: _onStart,
  onStop,
  onResume,
  onEditDoc,
  parkedDocs = [],
  phaseNames
}: AutopilotHudProps) {
  const running = status?.running ?? false;
  const docStatus = status?.docStatus ?? {};
  const passedCount = status?.passedCount ?? 0;
  const totalPhases = status?.totalPhases ?? 13;
  const labels = phaseNames ?? PHASE_LABELS;

  // S6: re-draft ripple — track which dots were affected
  const parkedCount = Object.values(docStatus).filter(v => v === 'parked').length;
  const draftingCount = Object.values(docStatus).filter(v => v === 'drafting').length;

  const statusWord = running
    ? draftingCount > 0
      ? 'Working…'
      : 'Idle'
    : parkedCount > 0
      ? `${parkedCount} parked`
      : 'Idle';

  const currentPhaseId = status?.currentPhaseId;

  const renderDot = (phaseName: string, idx: number) => {
    const id = phaseName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const st = docStatus[id] ?? 'idle';
    let dotClass = 'bg-slate-700';
    let ringClass = '';
    if (st === 'passed') {
      dotClass = 'bg-emerald-500';
    } else if (st === 'drafting') {
      dotClass = 'w-3 bg-cyan-500 motion-safe:animate-pulse ring-2 ring-cyan-500/40';
    } else if (st === 'parked') {
      dotClass = 'bg-rose-500';
      ringClass = 'ring-1 ring-rose-500/60';
    }

    return (
      <span
        key={idx}
        title={`${phaseName} — ${st}`}
        className={`w-2 h-2 rounded-full transition-all ${dotClass} ${ringClass}`}
      />
    );
  };

  return (
    <div className="bg-slate-900/80 border-b border-slate-800">
      {/* Rail */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5"
        role="progressbar"
        aria-valuenow={passedCount}
        aria-valuemin={0}
        aria-valuemax={totalPhases}
        aria-label={`${passedCount} of ${totalPhases} phases complete`}
      >
        {/* Dots */}
        <div className="flex items-center gap-[3px] flex-1 min-w-0">
          {labels.slice(0, 13).map((name, idx) => renderDot(name, idx))}
        </div>

        {/* Active drafting label */}
        {currentPhaseId && docStatus[currentPhaseId] === 'drafting' && (
          <span className="text-[11px] font-bold text-cyan-300 ml-2 truncate max-w-[120px]">
            Drafting: {labels.find(l => l.toLowerCase().replace(/[^a-z0-9]/g, '') === currentPhaseId) ?? currentPhaseId}
          </span>
        )}

        {/* Status word */}
        <span className="text-[10px] font-mono text-slate-500 ml-auto shrink-0">
          {statusWord}
        </span>

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

      {/* Parked doc cards inline */}
      {parkedDocs.length > 0 && !running && (
        <div className="space-y-1.5 px-3 pb-2">
          {parkedDocs.map(doc => (
            <div
              key={doc.id}
              className="rounded-lg border-l-2 border-rose-500 bg-rose-950/20 p-2 animate-park-reveal"
            >
              <p className="text-xs font-semibold text-rose-200">{doc.title}</p>
              {doc.gaps && doc.gaps.length > 0 && (
                <ul className="mt-1 list-inside list-disc">
                  {doc.gaps.map((gap, i) => (
                    <li key={i} className="text-[11px] text-rose-200/70">{gap}</li>
                  ))}
                </ul>
              )}
              <div className="mt-1.5 flex gap-2">
                <button
                  onClick={() => onResume(doc.docPath)}
                  className="rounded border border-rose-700 bg-rose-950/60 px-2 py-0.5 text-[11px] font-medium text-rose-200 hover:bg-rose-900/60"
                >
                  Resolve & Resume
                </button>
                {onEditDoc && (
                  <button
                    onClick={() => onEditDoc(doc.docPath)}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Edit Manually
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
