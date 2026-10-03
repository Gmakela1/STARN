import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send,
  Square,
  FileText,
  Pencil,
  Eye,
  Save,
  BadgeCheck,
  Loader2,
  RefreshCw,
  Bot,
  User,
  TriangleAlert
} from 'lucide-react';
import { api } from '../api/client';
import { DocData, ProjectInfo, RoadmapPhase } from '../types/api';
import { useTurnStream } from '../api/useTurnStream';
import Markdown from '../components/Markdown';
import CriticScorecard from '../components/CriticScorecard';
import CheckpointPanel from '../components/CheckpointPanel';

export interface DevelopmentViewProps {
  turnStream: ReturnType<typeof useTurnStream>;
  project: ProjectInfo | null;
  onProjectChanged: () => Promise<void> | void;
}

export default function DevelopmentView({ turnStream, project, onProjectChanged }: DevelopmentViewProps) {
  const { entries, busy, status, toolActivity, checkpoint, sendTurn, abortTurn, clearCheckpoint, appendEntry } = turnStream;

  // --- Chat state ---
  const [prompt, setPrompt] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, status, checkpoint]);

  const submit = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setPrompt('');
    await sendTurn(text);
    await refreshDoc();
    await onProjectChanged();
  };

  // --- Document panel state ---
  const [roadmap, setRoadmap] = useState<RoadmapPhase[]>([]);
  const [selectedPhase, setSelectedPhase] = useState<string>('');
  const [doc, setDoc] = useState<DocData | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [docNotice, setDocNotice] = useState<string | null>(null);

  const loadRoadmap = useCallback(async () => {
    try {
      const phases = await api.fetchRoadmap();
      setRoadmap(phases);
      if (!selectedPhase) {
        const firstWithDoc = phases.find(p => p.docExists) ?? phases[0];
        if (firstWithDoc) setSelectedPhase(firstWithDoc.id);
      }
    } catch {
      // header already shows reconnect badge
    }
  }, [selectedPhase]);

  const refreshDoc = useCallback(async () => {
    if (!selectedPhase) return;
    try {
      const d = await api.fetchDoc(selectedPhase);
      setDoc(d);
      setDocError(null);
      if (!editing) setDraft(d.content);
    } catch (err: any) {
      setDoc(null);
      setDocError(err?.message ?? 'Document unavailable');
    }
  }, [selectedPhase, editing]);

  useEffect(() => { void loadRoadmap(); }, [loadRoadmap]);
  useEffect(() => { void refreshDoc(); }, [refreshDoc]);

  const saveDraft = async () => {
    if (!doc) return;
    setSaving(true);
    try {
      await api.saveDoc(selectedPhase, draft);
      setEditing(false);
      setDocNotice('Saved to disk (previous version backed up)');
      await refreshDoc();
      setTimeout(() => setDocNotice(null), 4000);
    } catch (err: any) {
      setDocError(err?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const approvePhase = async () => {
    setApproving(true);
    try {
      await api.approveDoc(selectedPhase);
      setDocNotice('Phase approved — downstream phases unlocked');
      await Promise.all([loadRoadmap(), refreshDoc(), onProjectChanged()]);
      setTimeout(() => setDocNotice(null), 4000);
    } catch (err: any) {
      setDocError(err?.message ?? 'Approval failed');
    } finally {
      setApproving(false);
    }
  };

  const selectedPhaseInfo = roadmap.find(p => p.id === selectedPhase);

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-2">
      {/* ------------------------------ Chat pane ----------------------------- */}
      <section className="flex min-h-0 flex-col border-r border-slate-800" aria-label="Agent conversation">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {entries.length === 0 && !busy && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Bot className="h-10 w-10 text-slate-700" aria-hidden />
              <div>
                <p className="text-sm font-medium text-slate-300">
                  {project ? `Working on ${project.name}` : 'Agent ready'}
                </p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
                  Ask for any deliverable — “draft the CONOPS”, “update the BOM”, “write the work
                  instruction for ACTION-03” — or just ask questions about the project.
                </p>
              </div>
            </div>
          )}

          {entries.map(entry => (
            <article
              key={entry.id}
              className={`max-w-[92%] rounded-xl border p-3 ${
                entry.role === 'user'
                  ? 'ml-auto border-sky-900/60 bg-sky-950/40'
                  : entry.role === 'system'
                    ? 'border-rose-900/60 bg-rose-950/30'
                    : 'border-slate-800 bg-slate-900/70'
              }`}
            >
              <header className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {entry.role === 'user' ? (
                  <><User className="h-3.5 w-3.5" aria-hidden /> You</>
                ) : entry.role === 'system' ? (
                  <><TriangleAlert className="h-3.5 w-3.5 text-rose-400" aria-hidden /> System</>
                ) : (
                  <><Bot className="h-3.5 w-3.5 text-sky-400" aria-hidden /> {entry.specialistName ?? 'Agent'}{entry.aborted ? ' · aborted' : ''}</>
                )}
              </header>
              <Markdown content={entry.text} />
              {entry.criticResult && (
                <div className="mt-2">
                  <CriticScorecard result={entry.criticResult} compact />
                </div>
              )}
            </article>
          ))}

          {busy && (
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-sky-400" aria-hidden />
              <span>{status ?? 'Working…'}</span>
              {toolActivity && (
                <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                  {toolActivity}
                </span>
              )}
            </div>
          )}

          {checkpoint && (
            <CheckpointPanel
              checkpoint={checkpoint}
              onResolved={outcome => {
                clearCheckpoint();
                appendEntry({
                  role: 'system',
                  text: outcome === 'approved' ? 'Draft approved and recorded. ✅' : 'Draft discarded.'
                });
                void loadRoadmap();
                void refreshDoc();
                void onProjectChanged();
              }}
              onRevisionRequested={revisionPrompt => {
                clearCheckpoint();
                appendEntry({ role: 'system', text: 'Revision requested — sending feedback to the specialist…' });
                void sendTurn(revisionPrompt, { silentUserEntry: true });
              }}
            />
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input bar */}
        <footer className="border-t border-slate-800 bg-slate-900/60 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              disabled={busy || checkpoint !== null}
              placeholder={checkpoint ? 'Resolve the pending checkpoint above first…' : 'Message the agent… (Enter to send, Shift+Enter for newline)'}
              aria-label="Message the agent"
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none disabled:opacity-50"
            />
            {busy ? (
              <button
                onClick={() => void abortTurn()}
                className="flex h-[44px] w-[44px] items-center justify-center rounded-lg border border-rose-800 bg-rose-950/60 text-rose-300 transition hover:bg-rose-900/60"
                aria-label="Abort current turn"
                title="Abort current turn"
              >
                <Square className="h-4 w-4" aria-hidden />
              </button>
            ) : (
              <button
                onClick={() => void submit()}
                disabled={!prompt.trim() || checkpoint !== null}
                className="flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-sky-600 text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send message"
                title="Send message"
              >
                <Send className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </footer>
      </section>

      {/* --------------------------- Document pane ---------------------------- */}
      <section className="hidden min-h-0 flex-col lg:flex" aria-label="Document workspace">
        <header className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/40 px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <select
            value={selectedPhase}
            onChange={e => { setEditing(false); setSelectedPhase(e.target.value); }}
            aria-label="Select document phase"
            className="min-h-[36px] rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200 focus:border-sky-600 focus:outline-none"
          >
            {roadmap.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.docExists ? '' : ' (not drafted)'}
              </option>
            ))}
          </select>

          {doc && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                doc.status === 'approved'
                  ? 'bg-emerald-950/70 text-emerald-300'
                  : doc.status === 'rejected'
                    ? 'bg-rose-950/70 text-rose-300'
                    : 'bg-amber-950/70 text-amber-300'
              }`}
            >
              {doc.status.toUpperCase()}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => void refreshDoc()}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
              aria-label="Refresh document"
              title="Refresh document"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
            </button>
            {doc && !editing && (
              <button
                onClick={() => { setDraft(doc.content); setEditing(true); }}
                className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={() => void saveDraft()}
                  disabled={saving}
                  className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
                  Save
                </button>
                <button
                  onClick={() => { setEditing(false); setDraft(doc?.content ?? ''); }}
                  className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 transition hover:bg-slate-800"
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden /> Cancel
                </button>
              </>
            )}
            {doc && !editing && doc.status !== 'approved' && selectedPhaseInfo?.docExists && (
              <button
                onClick={() => void approvePhase()}
                disabled={approving}
                className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-800 px-3 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-950 disabled:opacity-40"
              >
                {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <BadgeCheck className="h-3.5 w-3.5" aria-hidden />}
                Approve phase
              </button>
            )}
          </div>
        </header>

        {docNotice && (
          <p className="border-b border-emerald-900/60 bg-emerald-950/40 px-4 py-1.5 text-xs text-emerald-300" role="status">
            {docNotice}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {editing ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              spellCheck={false}
              aria-label="Document editor"
              className="h-full w-full resize-none bg-slate-950 p-4 font-mono text-[13px] leading-relaxed text-slate-200 focus:outline-none"
            />
          ) : doc ? (
            <div className="p-5">
              <p className="mb-3 font-mono text-[11px] text-slate-600">{doc.path}</p>
              <Markdown content={doc.content} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <FileText className="h-8 w-8 text-slate-700" aria-hidden />
              <p className="text-sm text-slate-400">
                {docError ? 'No document yet for this phase.' : 'Loading…'}
              </p>
              {docError && (
                <p className="max-w-xs text-xs leading-relaxed text-slate-600">
                  Ask the agent to draft it — e.g. “create the {selectedPhaseInfo?.name ?? 'document'}”.
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
