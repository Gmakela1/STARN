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
  MessageSquare,
  Flag,
  Image as ImageIcon
} from 'lucide-react';
import { api } from '../api/client';
import { StepComment, WorkInstruction } from '../types/api';
import Markdown from '../components/Markdown';

const WI_STATUS_TONE: Record<string, string> = {
  'NOT-STARTED': 'bg-[#11151d] text-[#a8b3c4]',
  'IN-PROGRESS': 'bg-violet-950/80 text-violet-300',
  'BLOCKED': 'bg-rose-950/80 text-rose-300',
  'COMPLETE': 'bg-[#2e1065] text-[#e8edf5]'
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
  const [shopMode, setShopMode] = useState(false);
  const [stepAnnotations, setStepAnnotations] = useState<Record<number, { comments?: StepComment[]; flagged?: boolean }>>({});
  const [openComments, setOpenComments] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
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

  // Hydrate per-step annotations whenever the selected action changes.
  useEffect(() => {
    if (!detail) return;
    const map: Record<number, { comments?: StepComment[]; flagged?: boolean }> = {};
    if (detail.stepAnnotations) {
      for (const [stepId, entry] of Object.entries(detail.stepAnnotations)) {
        const num = Number(stepId);
        if (Number.isInteger(num)) {
          map[num] = { comments: entry.comments ?? [], flagged: !!entry.flagged };
        }
      }
    }
    setStepAnnotations(map);
    setOpenComments(null);
    setCommentDraft('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.actionId]);

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

  const toggleComments = (stepIdx: number) => {
    setOpenComments(prev => (prev === stepIdx ? null : stepIdx));
    setCommentDraft('');
  };

  const handleFlag = async (stepIdx: number) => {
    if (!detail) return;
    const next = !(stepAnnotations[stepIdx]?.flagged ?? false);
    // Optimistic update, then reconcile with server truth. Rollback on error.
    setStepAnnotations(cur => ({ ...cur, [stepIdx]: { ...(cur[stepIdx] ?? { comments: [], flagged: false }), flagged: next } }));
    try {
      await api.toggleActionFlag(detail.actionId, stepIdx, next);
    } catch (err: any) {
      setError(err?.message ?? 'Flag update failed');
      setStepAnnotations(cur => ({ ...cur, [stepIdx]: { ...(cur[stepIdx] ?? { comments: [], flagged: false }), flagged: !next } }));
    }
  };

  const submitComment = async (stepIdx: number) => {
    const text = commentDraft.trim();
    if (!text || !detail) return;
    const before = stepAnnotations[stepIdx]?.comments ?? [];
    const comment: StepComment = { text, at: new Date().toISOString() };
    // Optimistic update, then reconcile with server truth. Rollback on error.
    setStepAnnotations(cur => ({ ...cur, [stepIdx]: { ...(cur[stepIdx] ?? { comments: [], flagged: false }), comments: [...before, comment] } }));
    setCommentDraft('');
    try {
      await api.postActionComment(detail.actionId, stepIdx, text);
    } catch (err: any) {
      setError(err?.message ?? 'Comment failed');
      setStepAnnotations(cur => ({ ...cur, [stepIdx]: { ...(cur[stepIdx] ?? { comments: [], flagged: false }), comments: before } }));
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
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[#6e7d92]" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading shop floor…
      </div>
    );
  }

  if (actions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Wrench className="h-10 w-10 text-[#3b4658]" aria-hidden />
        <p className="text-sm text-[#a8b3c4]">No work instructions yet.</p>
        <p className="max-w-sm text-xs leading-relaxed text-[#6e7d92]">
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
      <aside className="min-h-0 overflow-y-auto border-r border-[#2a3342] bg-[#0d1017]/50" aria-label="Work instructions">
        <header className="flex items-center justify-between border-b border-[#2a3342] px-3 py-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#a8b3c4]">Actions</h2>
          <button
            onClick={() => void loadList()}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-[#a8b3c4] hover:bg-[#11151d] hover:text-[#e8edf5]"
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
                    active ? 'border-violet-400 bg-[#11151d]/70' : 'border-transparent hover:bg-[#0d1017]/70'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-violet-300">{wi.actionId}</span>
                    {defect && <TriangleAlert className="h-3.5 w-3.5 text-rose-400" aria-label="Open non-conformance" />}
                    <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${WI_STATUS_TONE[wi.status.toUpperCase()] ?? 'bg-[#11151d] text-[#a8b3c4]'}`}>
                      {wi.status.toUpperCase() === 'COMPLETE' && <CheckCircle2 className="h-3 w-3" aria-hidden />}
                      {wi.status || '—'}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[#a8b3c4]">{wi.title}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#11151d]" aria-hidden>
                      <div className={`h-full rounded-full ${pct === 100 ? 'bg-[#8b5cf6]' : 'bg-violet-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[11px] text-[#a8b3c4]">{pct}%</span>
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
          <div className="flex h-full items-center justify-center text-sm text-[#6e7d92]">Select an action…</div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-6">
            <header>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold text-[#e8edf5]">{detail.title}</h1>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${WI_STATUS_TONE[detail.status.toUpperCase()] ?? 'bg-[#11151d] text-[#a8b3c4]'}`}>
                  {detail.status}
                </span>
                <button
                  type="button"
                  onClick={() => setShopMode(v => !v)}
                  className={`ml-auto flex min-h-[44px] items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition ${
                    shopMode
                      ? 'border-[#ff2a3c]/60 bg-[#d61f2c] text-white shadow-md shadow-[#1a0208]/40 hover:bg-[#e11d3f]'
                      : 'border-[#ff2a3c]/45 bg-[#1a0208]/80 text-[#ffb3bd] hover:bg-[#1a0208]'
                  }`}
                  aria-pressed={shopMode}
                  title={shopMode ? 'Switch back to Desktop view' : 'Switch to high-contrast Shop Floor Mode'}
                >
                  <Wrench className="h-4 w-4" aria-hidden />
                  {shopMode ? 'Shop Mode ON' : 'Shop Floor Mode'}
                </button>
              </div>
              <p className="mt-1 flex flex-wrap gap-3 text-xs text-[#a8b3c4]">
                <span>Gate: <span className="font-semibold text-[#a8b3c4]">{detail.milestoneGate || '—'}</span></span>
                <span>Subsystem: <span className="font-mono font-semibold text-[#a8b3c4]">{detail.subsystem || '—'}</span></span>
                <span className="font-mono text-[#6e7d92]">{detail.filePath}</span>
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
                <p className="mt-1.5 text-sm text-[#e8edf5]">{detail.nonConformance.defectDescription}</p>
                {detail.nonConformance.defectEvidence && detail.nonConformance.defectEvidence !== '—' && (
                  <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-[#a8b3c4]">
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden /> {detail.nonConformance.defectEvidence}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-[#a8b3c4]">
                  Route this defect to the AI agent from the <span className="font-semibold text-[#a8b3c4]">Questions &amp; Issues</span> tab for impact analysis and a repair procedure.
                </p>
              </aside>
            )}

            {/* Checklist */}
            <section className="rounded-xl border border-[#2a3342] bg-[#0d1017]/70">
              <header className="flex items-center justify-between border-b border-[#2a3342] px-4 py-2.5">
                <h2 className="text-sm font-bold text-[#e8edf5]">Step-by-step checklist</h2>
                <span className="text-xs text-[#a8b3c4]">
                  {detail.steps.filter(s => s.checked).length} / {detail.steps.length} complete
                </span>
              </header>
              <ol className="divide-y divide-[#2a3342]/70">
                {detail.steps.map((step, stepIdx) => {
                  const stepComments = stepAnnotations[stepIdx]?.comments ?? [];
                  const stepFlagged = stepAnnotations[stepIdx]?.flagged ?? false;
                  return (
                    <li key={step.index} className="flex items-start gap-3 px-4 py-3">
                      <button
                        onClick={() => void toggleStep(step.index, !step.checked)}
                        disabled={togglingIndex !== null}
                        role="checkbox"
                        aria-checked={step.checked}
                        aria-label={`${step.label}: ${step.text}`}
                        className={`mt-0.5 flex shrink-0 items-center justify-center rounded-lg border-2 transition ${
                          shopMode ? 'h-16 w-16' : 'h-11 w-11'
                        } ${
                          step.checked
                            ? 'border-[#8b5cf6] bg-[#7c3aed] text-white shadow-md shadow-[#2e1065]/40'
                            : 'border-[#3b4658] bg-[#05070c] text-transparent hover:border-[#ff2a3c]'
                        }`}
                      >
                        {togglingIndex === step.index ? (
                          <Loader2 className="h-5 w-5 animate-spin text-violet-400" aria-hidden />
                        ) : (
                          <CheckCircle2 className="h-5 w-5" aria-hidden />
                        )}
                      </button>
                      {/* Shop-floor comment + flag affordances */}
                      <div className="flex flex-col items-center gap-1 pt-0.5">
                        <button
                          onClick={() => toggleComments(stepIdx)}
                          className="text-xs text-[#6e7d92] hover:text-[#ff2a3c] transition-colors p-1"
                          aria-label={`${stepComments.length} comments`}
                          aria-expanded={openComments === stepIdx}
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {stepComments.length > 0 && <span className="ml-0.5">{stepComments.length}</span>}
                        </button>
                        <button
                          onClick={() => handleFlag(stepIdx)}
                          aria-pressed={stepFlagged}
                          aria-label={stepFlagged ? 'Clear shop floor flag' : 'Flag this step'}
                          className={`p-1 rounded transition-colors ${stepFlagged ? 'text-rose-400 bg-rose-950/40' : 'text-[#6e7d92] hover:text-[#a8b3c4]'}`}
                        >
                          <Flag className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1 pt-1">
                        <p className={`${shopMode ? 'text-base font-medium leading-relaxed' : 'text-sm leading-relaxed'} ${step.checked ? 'text-[#6e7d92] line-through decoration-[#3b4658]' : 'text-[#e8edf5]'}`}>
                          <span className="font-semibold">{step.label}:</span> {step.text}
                        </p>
                        {step.gated && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-violet-700 bg-violet-950/60 px-2 py-0.5 text-[11px] font-semibold text-violet-300">
                            <FlaskConical className="h-3 w-3" aria-hidden /> Gated verification test
                          </span>
                        )}
                        {openComments === stepIdx && (
                          <div className="mt-2 rounded-lg bg-[#0d1017]/70 p-2">
                            {stepComments.length === 0 ? (
                              <p className="text-xs text-[#6e7d92]">No comments yet.</p>
                            ) : (
                              <ul className="space-y-2">
                                {stepComments.slice(0, 3).map((c, i) => (
                                  <li key={`${c.at}-${i}`}>
                                    <p className="text-xs text-[#e8edf5]">{c.text}</p>
                                    <p className="mt-0.5 text-[10px] text-[#6e7d92]">
                                      {c.author ? `${c.author} · ` : ''}{new Date(c.at).toLocaleString()}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {stepComments.length > 3 && (
                              <p className="mt-1 text-[11px] text-[#6e7d92]">{stepComments.length - 3} more…</p>
                            )}
                            <textarea
                              value={commentDraft}
                              onChange={e => setCommentDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  void submitComment(stepIdx);
                                }
                              }}
                              placeholder="Add a comment… Enter to send"
                              className="mt-2 w-full resize-none rounded-lg border border-[#3b4658] bg-[#05070c] px-2 py-1.5 text-xs text-[#e8edf5] placeholder:text-[#6e7d92] focus:border-[#ff2a3c] focus:outline-none"
                            />
                            <button
                              onClick={() => void submitComment(stepIdx)}
                              disabled={!commentDraft.trim()}
                              className="mt-1.5 rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
                            >
                              Submit
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* Evidence upload */}
            <section className="rounded-xl border border-[#2a3342] bg-[#0d1017]/70 p-4" aria-label="Evidence artifacts">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-bold text-[#e8edf5]">Evidence artifacts</h2>
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
                  className="ml-auto flex min-h-[44px] items-center gap-2 rounded-lg border border-violet-800 px-4 text-sm font-medium text-violet-300 transition hover:bg-violet-950 disabled:opacity-40"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
                  Upload evidence photo
                </button>
              </div>
              {uploadNotice && (
                <p className="mt-2 text-xs text-[#e8edf5]" role="status">{uploadNotice}</p>
              )}
              {detail.artifacts.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {detail.artifacts.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 font-mono text-xs text-[#a8b3c4]">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-[#6e7d92]" aria-hidden /> {a}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-[#6e7d92]">
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
                className="text-xs font-medium text-[#6e7d92] underline-offset-4 hover:text-[#a8b3c4] hover:underline"
              >
                {showRaw ? 'Hide full document' : 'Show full document'}
              </button>
              {showRaw && detail.content && (
                <div className="mt-3 rounded-xl border border-[#2a3342] bg-[#0d1017]/70 p-4">
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
