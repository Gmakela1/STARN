import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Wrench,
  RefreshCw,
  Camera,
  FlaskConical,
  TriangleAlert,
  CheckCircle2,
  Paperclip,
  Image as ImageIcon
} from 'lucide-react';
import { api } from '../api/client';
import { WorkInstruction } from '../types/api';
import Markdown from '../components/Markdown';

const WI_STATUS_TONE: Record<string, string> = {
  'NOT-STARTED': 'bg-slate-800 text-slate-300',
  'IN-PROGRESS': 'bg-sky-950/80 text-sky-300',
  'BLOCKED': 'bg-rose-950/80 text-rose-300',
  'COMPLETE': 'bg-emerald-950/80 text-emerald-300'
};

function progressOf(wi: WorkInstruction): number {
  if (wi.steps.length === 0) return 0;
  return Math.round((wi.steps.filter(s => s.checked).length / wi.steps.length) * 100);
}

export default function WorkInstructionsView() {
  const [actions, setActions] = useState<WorkInstruction[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkInstruction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingIndex, setTogglingIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadList = async () => {
    try {
      const list = await api.fetchActions();
      setActions(list);
      setError(null);
      if (!selectedId && list.length > 0) setSelectedId(list[0].actionId);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load work instructions');
      setActions([]);
    }
  };

  const loadDetail = async (actionId: string) => {
    try {
      setDetail(await api.fetchAction(actionId));
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load work instruction');
    }
  };

  useEffect(() => { void loadList(); }, []);
  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId]);

  const toggleStep = async (stepIndex: number, checked: boolean) => {
    if (!detail) return;
    setTogglingIndex(stepIndex);
    // Optimistic update
    setDetail(prev => prev ? {
      ...prev,
      steps: prev.steps.map(s => (s.index === stepIndex ? { ...s, checked } : s))
    } : prev);
    try {
      const updated = await api.toggleActionStep(detail.actionId, stepIndex, checked);
      setDetail(prev => prev ? { ...updated, filePath: prev.filePath, content: undefined } : prev);
      void loadList();
    } catch (err: any) {
      setError(err?.message ?? 'Toggle failed');
      void loadDetail(detail.actionId); // rollback to disk truth
    } finally {
      setTogglingIndex(null);
    }
  };

  const uploadEvidence = async (file: File) => {
    if (!detail) return;
    setUploading(true);
    setUploadNotice(null);
    try {
      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.jpg';
      const descriptor = file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toUpperCase()
        .slice(0, 40) || 'EVIDENCE';
      const base = detail.fileName?.replace(/\.md$/i, '') ?? detail.actionId;
      const wiVersionMatch = base.match(/-(\d+)$/);
      const version = wiVersionMatch ? wiVersionMatch[1] : '1';
      const slugMatch = base.match(/^ACTION-\d+-(.*?)-WORK-INSTRUCTION/i);
      const slug = slugMatch ? slugMatch[1] : 'TASK';
      const filename = `${detail.actionId}-${slug}-WI-${version}-${descriptor}${ext}`;
      const result = await api.uploadArtifact(filename, file);
      setUploadNotice(`Saved ${result.path}`);
      setTimeout(() => setUploadNotice(null), 5000);
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const sortedActions = useMemo(
    () => (actions ?? []).slice().sort((a, b) => a.actionId.localeCompare(b.actionId, undefined, { numeric: true })),
    [actions]
  );

  if (actions === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading shop floor…
      </div>
    );
  }

  if (actions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Wrench className="h-10 w-10 text-slate-700" aria-hidden />
        <p className="text-sm text-slate-400">No work instructions yet.</p>
        <p className="max-w-sm text-xs leading-relaxed text-slate-600">
          Once the build sequence is approved, ask the agent to “write the work instruction for
          ACTION-01” and it will appear here as an executable checklist.
        </p>
      </div>
    );
  }

  const hasDefect = detail && detail.nonConformance.flagStatus.toUpperCase().includes('OPEN');

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[280px_1fr]">
      {/* Action list */}
      <aside className="min-h-0 overflow-y-auto border-r border-slate-800 bg-slate-900/30" aria-label="Work instructions">
        <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Actions</h2>
          <button
            onClick={() => void loadList()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Refresh list"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </button>
        </header>
        <ul>
          {sortedActions.map(wi => {
            const active = wi.actionId === selectedId;
            const pct = progressOf(wi);
            const defect = wi.nonConformance.flagStatus.toUpperCase().includes('OPEN');
            return (
              <li key={wi.filePath}>
                <button
                  onClick={() => setSelectedId(wi.actionId)}
                  className={`block w-full border-l-2 px-3 py-2.5 text-left transition ${
                    active ? 'border-sky-400 bg-slate-800/70' : 'border-transparent hover:bg-slate-900/70'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-sky-300">{wi.actionId}</span>
                    {defect && <TriangleAlert className="h-3.5 w-3.5 text-rose-400" aria-label="Open non-conformance" />}
                    <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-bold ${WI_STATUS_TONE[wi.status.toUpperCase()] ?? 'bg-slate-800 text-slate-400'}`}>
                      {wi.status || '—'}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-300">{wi.title}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800" aria-hidden>
                      <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-500">{pct}%</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Detail */}
      <section className="min-h-0 overflow-y-auto" aria-label="Work instruction detail">
        {!detail ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Select an action…</div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-6">
            <header>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold text-slate-100">{detail.title}</h1>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${WI_STATUS_TONE[detail.status.toUpperCase()] ?? 'bg-slate-800 text-slate-300'}`}>
                  {detail.status}
                </span>
              </div>
              <p className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
                <span>Gate: <span className="font-semibold text-slate-300">{detail.milestoneGate || '—'}</span></span>
                <span>Subsystem: <span className="font-mono font-semibold text-slate-300">{detail.subsystem || '—'}</span></span>
                <span className="font-mono text-slate-600">{detail.filePath}</span>
              </p>
            </header>

            {error && (
              <p className="rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-2 text-xs text-rose-300" role="alert">{error}</p>
            )}

            {/* Non-conformance banner */}
            {hasDefect && (
              <aside className="rounded-xl border border-rose-800/70 bg-rose-950/30 p-3" aria-label="Open non-conformance">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-300">
                  <TriangleAlert className="h-4 w-4" aria-hidden /> Open non-conformance
                </p>
                <p className="mt-1.5 text-sm text-slate-200">{detail.nonConformance.defectDescription}</p>
                {detail.nonConformance.defectEvidence && detail.nonConformance.defectEvidence !== '—' && (
                  <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden /> {detail.nonConformance.defectEvidence}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-slate-400">
                  Route this defect to the AI agent from the <span className="font-semibold text-slate-300">Questions &amp; Issues</span> tab for impact analysis and a repair procedure.
                </p>
              </aside>
            )}

            {/* Checklist */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40">
              <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
                <h2 className="text-sm font-bold text-slate-200">Step-by-step checklist</h2>
                <span className="text-xs text-slate-400">
                  {detail.steps.filter(s => s.checked).length} / {detail.steps.length} complete
                </span>
              </header>
              <ol className="divide-y divide-slate-800/70">
                {detail.steps.map(step => (
                  <li key={step.index} className="flex items-start gap-3 px-4 py-3">
                    <button
                      onClick={() => void toggleStep(step.index, !step.checked)}
                      disabled={togglingIndex !== null}
                      role="checkbox"
                      aria-checked={step.checked}
                      aria-label={`${step.label}: ${step.text}`}
                      className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 transition ${
                        step.checked
                          ? 'border-emerald-600 bg-emerald-900/50 text-emerald-300'
                          : 'border-slate-600 bg-slate-950 text-transparent hover:border-sky-500'
                      }`}
                    >
                      {togglingIndex === step.index ? (
                        <Loader2 className="h-5 w-5 animate-spin text-sky-400" aria-hidden />
                      ) : (
                        <CheckCircle2 className="h-5 w-5" aria-hidden />
                      )}
                    </button>
                    <div className="min-w-0 flex-1 pt-1">
                      <p className={`text-sm leading-relaxed ${step.checked ? 'text-slate-500 line-through decoration-slate-700' : 'text-slate-200'}`}>
                        <span className="font-semibold">{step.label}:</span> {step.text}
                      </p>
                      {step.gated && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-indigo-800 bg-indigo-950/60 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                          <FlaskConical className="h-3 w-3" aria-hidden /> Gated verification test
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* Evidence upload */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-label="Evidence artifacts">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-bold text-slate-200">Evidence artifacts</h2>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,.pdf,.csv,.txt"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) void uploadEvidence(f);
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="ml-auto flex min-h-[44px] items-center gap-2 rounded-lg border border-sky-800 px-4 text-sm font-medium text-sky-300 transition hover:bg-sky-950 disabled:opacity-40"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
                  Upload evidence photo
                </button>
              </div>
              {uploadNotice && (
                <p className="mt-2 text-xs text-emerald-300" role="status">{uploadNotice}</p>
              )}
              {detail.artifacts.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {detail.artifacts.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 font-mono text-xs text-slate-400">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden /> {a}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-slate-600">
                  No evidence linked in the document yet. Uploads land in the flat <span className="font-mono">artifacts/</span> folder with
                  deterministic names the agent can reference.
                </p>
              )}
            </section>

            {/* Raw document toggle */}
            <section>
              <button
                onClick={async () => {
                  if (!showRaw && !detail.content) {
                    await loadDetail(detail.actionId);
                  }
                  setShowRaw(v => !v);
                }}
                className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline"
              >
                {showRaw ? 'Hide full document' : 'Show full document'}
              </button>
              {showRaw && detail.content && (
                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <Markdown content={detail.content} />
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
