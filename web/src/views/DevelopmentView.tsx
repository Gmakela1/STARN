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
  TriangleAlert,
  Upload,
  Paperclip,
  ChevronDown,
  Check,
  RotateCcw,
  X,
  Mic
} from 'lucide-react';
import { api } from '../api/client';
import { DocData, ProjectInfo, RoadmapPhase } from '../types/api';
import { useTurnStream } from '../api/useTurnStream';
import { useAutopilotEvents, AutopilotLiveEvent } from '../hooks/useAutopilotEvents';
import Markdown from '../components/Markdown';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import CriticScorecard from '../components/CriticScorecard';
import CheckpointPanel from '../components/CheckpointPanel';
import QuestionBar from '../components/QuestionBar';
import AutopilotHud from '../components/AutopilotHud';

/** Render a tool call as a short human-readable action instead of raw JSON. */
function formatToolCall(tool: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const path = typeof a.path === 'string' ? a.path : typeof a.file === 'string' ? a.file : '';
  const dir = typeof a.dir === 'string' ? a.dir : '';
  const query = typeof a.query === 'string' ? a.query : typeof a.q === 'string' ? a.q : '';
  const url = typeof a.url === 'string' ? a.url : '';
  const shorten = (s: string) => (s.length > 60 ? s.slice(0, 57) + '…' : s);
  switch (tool) {
    case 'fs_read':
      return path ? `📖 Reading ${shorten(path)}` : '📖 Reading file';
    case 'fs_list':
      return dir ? `🗂 Listing ${shorten(dir)}` : '🗂 Listing directory';
    case 'fs_write':
      return path ? `✍️ Writing ${shorten(path)}` : '✍️ Writing file';
    case 'fs_edit':
      return path ? `🖊 Editing ${shorten(path)}` : '🖊 Editing file';
    case 'state_read':
      return '📋 Reading project state';
    case 'state_update':
      return '💾 Updating project state';
    case 'example_reader':
    case 'examples_list':
      return '⭐ Checking quality examples';
    case 'pdf_extract':
    case 'doc_transcribe':
      return path ? `🖨 Transcribing ${shorten(path)}` : '🖨 Transcribing document';
    case 'web_search':
      return query ? `🔎 Searching: ${shorten(query)}` : '🔎 Searching web';
    case 'web_fetch':
      return url ? `🌐 Fetching ${shorten(url)}` : '🌐 Fetching URL';
    default:
      return `🛠 ${tool}`;
  }
}

export interface DevelopmentViewProps {
  turnStream: ReturnType<typeof useTurnStream>;
  project: ProjectInfo | null;
  onProjectChanged: () => Promise<void> | void;
  initialPhase?: string;
}

export default function DevelopmentView({
  turnStream,
  project,
  onProjectChanged,
  initialPhase
}: DevelopmentViewProps) {
  const { entries, busy, status, toolActivity, checkpoint, sendTurn, abortTurn, clearCheckpoint, appendEntry } = turnStream;

  // Mount autopilot event hook locally; append live events to the chat pane.
  const handleAutopilotEvent = useCallback((ev: AutopilotLiveEvent) => {
    if (ev.kind === 'phase') {
      const icon = ev.status === 'passed' ? '✓' : ev.status === 'auto-approved' ? '✓' : ev.status === 'parked' ? '⚠' : '✎';
      const label = ev.status === 'drafting' ? 'Drafting' : ev.status === 'critic' ? 'Critic review' : ev.status === 'revising' ? 'Revising' : ev.status === 'passed' ? 'Passed' : ev.status === 'auto-approved' ? 'Auto-approved' : ev.status === 'parked' ? 'Parked' : ev.status;
      appendEntry({ role: 'system', text: `${icon} Autopilot: ${label} ${ev.phaseId}` });
    } else if (ev.kind === 'complete') {
      const msg = `✓ Autopilot complete: ${ev.result.passed.length} passed` + (ev.result.parked.length > 0 ? `, ${ev.result.parked.length} parked` : '');
      appendEntry({ role: 'system', text: msg });
    } else if (ev.kind === 'error') {
      appendEntry({ role: 'system', text: `⚠ Autopilot error: ${ev.message}` });
    } else if (ev.kind === 'status') {
      // Live status updates (discovery, drafting, critic progress)
      appendEntry({ role: 'system', text: `🔍 ${ev.message}` });
    } else if (ev.kind === 'tool_call') {
      // Tool call notifications (human-readable)
      appendEntry({ role: 'system', text: formatToolCall(ev.tool, ev.args) });
    }
  }, [appendEntry]);

  const { status: autopilotStatus, portalItems } = useAutopilotEvents(handleAutopilotEvent);

  // --- Chat state ---
  const [prompt, setPrompt] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [dismissedParked, setDismissedParked] = useState<Set<string>>(new Set());
  const [answerNotice, setAnswerNotice] = useState<string | null>(null);
  const [docUpdateBanner, setDocUpdateBanner] = useState<string | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, status, checkpoint]);

  // Voice recorder
  const { recording, startRecording, stopRecording, error: voiceError } = useVoiceRecorder();

  // Alt-hold-to-record key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && !e.repeat && !recording) {
        startRecording();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && recording) {
        stopRecording().then(text => {
          if (text) setPrompt(prev => prev + text);
        });
      }
    };
    if (!busy && checkpoint === null) {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [busy, checkpoint, recording, startRecording, stopRecording]);

  // S5: answer feedback — watch for answered items in portalItems
  useEffect(() => {
    const answered = portalItems.filter(i => i.status === 'answered' && i.answer);
    if (answered.length > 0) {
      const latest = answered[answered.length - 1];
      if (latest.docPath) {
        setAnswerNotice(`✎ Answer applied to ${latest.docPath.split('/').pop()} — scanning downstream impact…`);
        setTimeout(() => setAnswerNotice(null), 2000);
        setTimeout(() => {
          setDocUpdateBanner('This document was updated from your answer.');
          setTimeout(() => setDocUpdateBanner(null), 4000);
        }, 2500);
      }
    }
  }, [portalItems]);

  const submit = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setPrompt('');
    await sendTurn(text, { activePhase: selectedPhase });
    await refreshDoc();
    await onProjectChanged();
  };

  // --- Document panel state ---
  const [roadmap, setRoadmap] = useState<RoadmapPhase[]>([]);
  const [selectedPhase, setSelectedPhase] = useState<string>(initialPhase || '');

  useEffect(() => {
    if (initialPhase) {
      setSelectedPhase(initialPhase);
    }
  }, [initialPhase]);
  const [docDropdownOpen, setDocDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<DocData | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDocDropdownOpen(false);
      }
    };
    if (docDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [docDropdownOpen]);
  const [docError, setDocError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [docNotice, setDocNotice] = useState<string | null>(null);

  // S4: parked items from portal
  const parkedItems = portalItems.filter(i => i.type === 'parked' && i.status === 'open' && !dismissedParked.has(i.id));

  const handleDismissParked = (id: string) => {
    setDismissedParked(prev => new Set(prev).add(id));
  };

  // Quality example upload state
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadingExample, setUploadingExample] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File) => {
    if (!selectedPhase || busy) return;
    setUploadingExample(true);
    setUploadNotice(null);
    try {
      const res = await api.uploadExample(selectedPhase, file.name, file);
      setUploadNotice(`✔ Uploaded quality example: ${res.filename}`);
      setTimeout(() => setUploadNotice(null), 5000);
    } catch (err: any) {
      setUploadNotice(`✖ Upload failed: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setUploadingExample(false);
    }
  };

  const loadRoadmap = useCallback(async () => {
    try {
      const phases = await api.fetchRoadmap();
      setRoadmap(phases);
      if (!selectedPhase && !initialPhase) {
        const firstWithDoc = phases.find(p => p.docExists) ?? phases[0];
        if (firstWithDoc) setSelectedPhase(firstWithDoc.id);
      }
    } catch {
      // header already shows reconnect badge
    }
  }, [selectedPhase, initialPhase]);

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

  const renderStatusPill = (phase?: RoadmapPhase) => {
    if (!phase) return null;
    if (phase.status === 'COMPLETED') {
      return (
        <span className="rounded bg-emerald-950/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 border border-emerald-800 shrink-0">
          Completed
        </span>
      );
    }
    if (phase.status === 'IN_PROGRESS' || phase.status === 'PENDING_REVIEW') {
      return (
        <span className="rounded bg-sky-950/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300 border border-sky-800 shrink-0">
          In Work
        </span>
      );
    }
    return (
      <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-400 border border-slate-700 shrink-0">
        Not Drafted
      </span>
    );
  };

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-2">
      {/* ------------------------------ Chat pane ----------------------------- */}
      <section className="flex min-h-0 flex-col border-r border-slate-800" aria-label="Agent conversation">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 relative">
          {/* S4: sticky parked doc card */}
          {parkedItems.length > 0 && (
            <div className="sticky top-0 z-10 space-y-2">
              {parkedItems.map(item => (
                <div
                  key={item.id}
                  className="rounded-xl border-l-2 border-rose-500 bg-rose-950/20 p-3 animate-park-reveal shadow-lg"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-rose-200">Critic blocked — review required</span>
                    <button
                      onClick={() => handleDismissParked(item.id)}
                      className="flex h-5 w-5 items-center justify-center rounded text-rose-400 hover:text-rose-200"
                      aria-label="Dismiss"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-200">{item.title}</p>
                  {item.detail && (
                    <p className="mt-0.5 text-xs text-slate-400">{item.detail}</p>
                  )}
                  {item.gaps && item.gaps.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] font-semibold text-rose-300">Missing requirements:</p>
                      <ul className="list-inside list-disc space-y-0.5">
                        {item.gaps.map((gap, i) => (
                          <li key={i} className="text-[11px] text-rose-200/70">{gap}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {/* Review gaps: expand question bar */}}
                      className="rounded border border-rose-700 bg-rose-950/60 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-rose-900/60"
                    >
                      Review gaps →
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await api.autopilotResume(item.docPath);
                        } catch {}
                      }}
                      className="rounded border border-rose-700 bg-rose-950/60 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-rose-900/60"
                    >
                      <RotateCcw className="mr-1 inline h-3 w-3" aria-hidden />
                      Resolve & Resume
                    </button>
                    <button
                      onClick={() => {
                        setEditing(true);
                      }}
                      className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-800"
                    >
                      Edit Manually
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {entries.length === 0 && !busy && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-950/50">
                <Bot className="h-7 w-7 text-cyan-400" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">
                  {project ? `Let's build ${project.name}` : 'Engineering Studio ready'}
                </p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-400">
                  Tell the AI in plain words what you want next — “draft the shopping list”,
                  “check electrical safety”, or “write the step-by-step guide for ACTION-03”.
                  It will research, draft, and ask for your approval before saving.
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
                  <>
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500/20 ring-1 ring-cyan-500/40">
                      <Bot className="h-2.5 w-2.5 text-cyan-300" aria-hidden />
                    </span>
                    <span className="text-cyan-300">{entry.specialistName ?? 'AI Studio'}</span>
                    {entry.aborted && <span className="text-rose-400 normal-case">· aborted</span>}
                  </>
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
            <div className="flex items-center gap-2.5 rounded-xl border border-cyan-800/60 bg-cyan-950/40 p-3 text-xs text-cyan-200" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-cyan-400" aria-hidden />
              <span className="font-semibold">{status ?? 'AI is working…'}</span>
              {toolActivity && (
                <span className="flex min-w-0 items-center gap-1.5 rounded-lg border border-cyan-700/50 bg-slate-950/60 px-2.5 py-1 text-[11px] text-cyan-100">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-cyan-400" aria-hidden />
                  <span className="truncate">{toolActivity}</span>
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
          {/* S5: answer feedback chat entry */}
          {answerNotice && (
            <article className="max-w-[92%] rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-3">
              <p className="text-xs text-emerald-300">{answerNotice}</p>
            </article>
          )}
          {docUpdateBanner && (
            <article className="max-w-[92%] rounded-xl border border-emerald-800/60 bg-emerald-950/40 p-3">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" aria-hidden />
                <p className="text-xs text-emerald-200">{docUpdateBanner}</p>
              </div>
            </article>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* S1: QuestionBar outside scroll container, between scroll region and footer */}
        <QuestionBar
          items={portalItems}
          onSubmit={async (id, text) => {
            await api.submitPortalAnswer(id, text);
            await refreshDoc();
          }}
          onDismiss={async (id) => {
            await api.dismissPortalItem(id);
          }}
          checkpointVisible={checkpoint !== null}
        />

        {/* Input bar */}
        <footer className="border-t border-slate-800 bg-slate-900/60 p-3">
          <div className="flex flex-col gap-2">
            {/* Recording indicator */}
            {recording && (
              <div className="flex items-center gap-2 rounded-md bg-rose-950/40 px-3 py-1.5 text-xs text-rose-300">
                <span className="inline-block h-2 w-2 rounded-full bg-rose-500 motion-safe:animate-pulse" />
                🎤 Recording… (release Alt to send)
              </div>
            )}
            {voiceError && (
              <div className="rounded-md bg-rose-950/40 px-3 py-1.5 text-xs text-rose-300">
                {voiceError}
              </div>
            )}
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
              {/* Mic button */}
              <button
                onClick={() => {
                  if (recording) {
                    stopRecording().then(text => {
                      if (text) setPrompt(prev => prev + text);
                    });
                  } else {
                    startRecording();
                  }
                }}
                disabled={busy || checkpoint !== null}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  recording
                    ? 'bg-rose-600 text-white motion-safe:animate-pulse'
                    : 'border border-slate-700 bg-slate-800 text-slate-400 hover:border-sky-600 hover:text-sky-400'
                }`}
                aria-label={recording ? 'Stop recording' : 'Record voice message'}
                title="Click or hold Alt to record"
              >
                <Mic className="h-4 w-4" aria-hidden />
              </button>
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
          </div>
        </footer>
      </section>

      {/* --------------------------- Document pane ---------------------------- */}
      <section className="hidden min-h-0 flex-col lg:flex" aria-label="Document workspace">
        <header className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/40 px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />

          {/* Custom Document Selector Popover */}
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setDocDropdownOpen(v => !v)}
              aria-haspopup="listbox"
              aria-expanded={docDropdownOpen}
              className="flex min-h-[40px] items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-900 transition-colors cursor-pointer"
            >
              <span className="truncate max-w-[180px] sm:max-w-[240px]">
                {selectedPhaseInfo ? selectedPhaseInfo.name : 'Select Document'}
              </span>
              {renderStatusPill(selectedPhaseInfo)}
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${docDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {docDropdownOpen && (
              <div
                role="listbox"
                className="absolute left-0 top-full z-50 mt-1 max-h-80 w-80 sm:w-96 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-1.5 shadow-2xl space-y-1"
              >
                {roadmap.map((p, idx) => {
                  const isSelected = p.id === selectedPhase;
                  return (
                    <div
                      key={p.id}
                      role="option"
                      aria-selected={isSelected}
                      onClick={async () => {
                        setEditing(false);
                        setSelectedPhase(p.id);
                        setDocDropdownOpen(false);
                        try {
                          await api.setActivePhase(p.id);
                          await onProjectChanged();
                        } catch {}
                      }}
                      className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs transition-colors ${
                        isSelected
                          ? 'bg-sky-950/70 text-sky-200 border border-sky-800/60 font-semibold'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-mono text-slate-500 text-[10px] w-4">{idx + 1}.</span>
                        <span className="truncate">{p.name}</span>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {renderStatusPill(p)}
                        {isSelected && <Check className="h-3.5 w-3.5 text-sky-400" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => void refreshDoc()}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
              aria-label="Refresh document"
              title="Refresh document"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
            </button>
            {doc && !editing && (
              <button
                onClick={() => { setDraft(doc.content); setEditing(true); }}
                className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={() => void saveDraft()}
                  disabled={saving}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
                  Save
                </button>
                <button
                  onClick={() => { setEditing(false); setDraft(doc?.content ?? ''); }}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 transition hover:bg-slate-800"
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden /> Cancel
                </button>
              </>
            )}
            {doc && !editing && doc.status !== 'approved' && selectedPhaseInfo?.docExists && (
              <button
                onClick={() => void approvePhase()}
                disabled={approving}
                className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-emerald-800 px-3 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-950 disabled:opacity-40"
              >
                {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <BadgeCheck className="h-3.5 w-3.5" aria-hidden />}
                Approve phase
              </button>
            )}
          </div>
        </header>

        {/* S7: AutopilotHud progress rail — always visible when autopilot is enabled */}
        <AutopilotHud
          status={autopilotStatus}
          enabled={autopilotStatus !== null || (turnStream as any).autopilotEnabled}
          onStart={async () => {
            try { await api.autopilotStart(); } catch {}
          }}
          onStop={async () => {
            try { await api.autopilotStop(); } catch {}
          }}
          onResume={async (docId) => {
            try { await api.autopilotResume(docId); } catch {}
          }}
            parkedDocs={parkedItems.map(i => ({
              id: i.id,
              title: i.title,
              docPath: i.docPath,
              gaps: i.gaps
            }))}
          />

        {/* Quality example drop zone */}
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFileUpload(file);
          }}
          className="flex items-center justify-between border-b border-slate-800/80 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-400"
        >
          <div className="flex items-center gap-2 truncate">
            <Upload className="h-3.5 w-3.5 text-sky-400 shrink-0" />
            <span className="truncate">
              Drop example for <strong className="text-slate-200">{selectedPhaseInfo?.name ?? 'phase'}</strong> (.md, .txt, .pdf)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept=".md,.txt,.pdf"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void handleFileUpload(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingExample || busy}
              className="flex min-h-[32px] items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-[11px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            >
              {uploadingExample ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
              Choose file
            </button>
          </div>
        </div>

        {uploadNotice && (
          <p className={`border-b px-4 py-1.5 text-xs ${uploadNotice.startsWith('✔') ? 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300' : 'border-rose-900/60 bg-rose-950/40 text-rose-300'}`}>
            {uploadNotice}
          </p>
        )}

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
              <p className="mb-3 font-mono text-[11px] text-slate-500">{doc.path}</p>
              <Markdown content={doc.content} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <FileText className="h-8 w-8 text-slate-700" aria-hidden />
              <p className="text-sm text-slate-400">
                {docError ? 'No document yet for this phase.' : 'Loading…'}
              </p>
              {docError && (
                <p className="max-w-xs text-xs leading-relaxed text-slate-500">
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
