import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
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
  Paperclip,
  ChevronDown,
  Check,
  Mic,
  BookOpen,
  FolderOpen,
  FilePen,
  PenLine,
  Database,
  Star,
  Search,
  Globe,
  Wrench,
  Activity,
  Clock3,
  CheckCircle2,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../api/client';
import { AnswerState, DocData, PortalItem, ProjectInfo, RoadmapPhase } from '../types/api';
import { useTurnStream, ChatEntry, ActivityMeta } from '../api/useTurnStream';
import { useAutopilotEvents, AutopilotLiveEvent } from '../hooks/useAutopilotEvents';
import Markdown from '../components/Markdown';
import { docNeedsApproval } from '../lib/workflowState';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import CriticScorecard from '../components/CriticScorecard';
import CheckpointPanel from '../components/CheckpointPanel';
import QuestionBadge from '../components/QuestionBadge';
import QuestionPanel from '../components/QuestionPanel';
import PaneSplitter from '../components/PaneSplitter';
import StartAutopilotButton from '../components/StartAutopilotButton';
// React Bits (reactbits.dev) decorative effect — see web/src/components/reactbits.
import DotGrid from '../components/reactbits/DotGrid';
import LatticeLoader from '../components/reactbits/LatticeLoader/LatticeLoader';
import { deriveQueuedAnswerStates } from '../lib/queuedStates';
import {
  applyAnchorHighlight,
  clearAnchorHighlights,
  extractRequirementIds,
  pickAnchorId
} from '../lib/requirementAnchor';

/** §11 — artifact basename (docPath / artifactPath are both `dir/NAME.ext`). */
function basename(path: string): string {
  return path.split('/').pop() ?? '';
}

/** Render a tool call as a short human-readable action instead of raw JSON. */
const TOOL_ICON_BY_NAME: Record<string, LucideIcon> = {
  fs_read: BookOpen,
  fs_list: FolderOpen,
  fs_write: FilePen,
  fs_edit: PenLine,
  state_read: Database,
  state_update: Save,
  example_reader: Star,
  examples_list: Star,
  pdf_extract: FileText,
  doc_transcribe: FileText,
  web_search: Search,
  web_fetch: Globe
};

interface ToolCallLine {
  icon: LucideIcon;
  text: string;
}

function formatToolCall(tool: string, args: unknown): ToolCallLine {
  const a = (args ?? {}) as Record<string, unknown>;
  const path = typeof a.path === 'string' ? a.path : typeof a.file === 'string' ? a.file : '';
  const dir = typeof a.dir === 'string' ? a.dir : '';
  const query = typeof a.query === 'string' ? a.query : typeof a.q === 'string' ? a.q : '';
  const url = typeof a.url === 'string' ? a.url : '';
  const shorten = (s: string) => (s.length > 60 ? s.slice(0, 57) + '…' : s);
  switch (tool) {
    case 'fs_read':
      return { icon: BookOpen, text: path ? `Reading ${shorten(path)}` : 'Reading file' };
    case 'fs_list':
      return { icon: FolderOpen, text: dir ? `Listing ${shorten(dir)}` : 'Listing directory' };
    case 'fs_write':
      return { icon: FilePen, text: path ? `Writing ${shorten(path)}` : 'Writing file' };
    case 'fs_edit':
      return { icon: PenLine, text: path ? `Editing ${shorten(path)}` : 'Editing file' };
    case 'state_read':
      return { icon: Database, text: 'Checking project state' };
    case 'state_update':
      return { icon: Save, text: 'Saving project state' };
    case 'example_reader':
    case 'examples_list':
      return { icon: Star, text: 'Reviewing quality examples' };
    case 'pdf_extract':
    case 'doc_transcribe':
      return { icon: FileText, text: path ? `Transcribing ${shorten(path)}` : 'Transcribing document' };
    case 'web_search':
      return { icon: Search, text: query ? `Searching: ${shorten(query)}` : 'Searching web' };
    case 'web_fetch':
      return { icon: Globe, text: url ? `Fetching ${shorten(url)}` : 'Fetching URL' };
    default:
      return { icon: Wrench, text: tool };
  }
}

/** §4.3 — natural-English line for a phase event. */
function phaseLine(ev: AutopilotLiveEvent & { kind: 'phase' }): string {
  const name = ev.name || ev.phaseId;
  switch (ev.status) {
    case 'drafting': return `Drafting ${name}…`;
    case 'critic': return `Reviewing the ${name} draft…`;
    case 'revising': return `Polishing ${name} after the review…`;
    case 'passed': return `${name} completed`;
    case 'auto-approved': return `Approved ${name} — continuing…`;
    case 'parked': return `Held ${name} for your review`;
    default: return `Working on ${name}…`;
  }
}

/** §4.3 — wrap-up summary line for a complete event. */
function summaryLine(ev: AutopilotLiveEvent & { kind: 'complete' }): string {
  const n = ev.result.passed.length;
  const m = ev.result.parked.length;
  if (ev.reason === 'stopped') {
    return m > 0 ? `Stopped — ${n} finalized so far, ${m} on hold` : `Stopped — ${n} finalized so far`;
  }
  return m > 0 ? `All done — ${n} documents finalized, ${m} on hold for review` : `All done — ${n} documents finalized`;
}

/** §3.1 — lucide icon for a feed line; per-tool icons win for tool events. */
function feedIconFor(m: ActivityMeta, text: string): LucideIcon {
  if (m.kind === 'tool') {
    return TOOL_ICON_BY_NAME[m.tool ?? ''] ?? Wrench;
  }
  switch (m.kind) {
    case 'phase':
      if (text.startsWith('Approved')) return CheckCircle2;
      if (text.startsWith('Held')) return Clock3;
      return FileText;
    case 'complete':
      return CheckCircle2;
    case 'error':
      return TriangleAlert;
    case 'live':
    case 'note':
    default:
      return Activity;
  }
}

/** §6.3 — timeline dot tone for a feed line. */
function dotTone(m: ActivityMeta, opts: { live: boolean; held: boolean }): string {
  if (m.kind === 'error') return 'bg-rose-400';
  if (opts.held || m.stopped) return 'bg-amber-400';
  if (m.kind === 'complete') return 'bg-[#8b5cf6]';
  if (opts.live) return 'bg-[#ff2a3c] ring-2 ring-[#ff2a3c]/30 motion-safe:animate-pulse';
  return 'bg-[#2a3342]';
}

/** §6.3 — activity prose with emphasized phase names. */
function renderActivityText(m: ActivityMeta, text: string) {
  if (m.phaseName && text.includes(m.phaseName)) {
    const [before, after] = text.split(m.phaseName);
    return (
      <>
        {before}
        <span className="text-[#a8b3c4] font-medium">{m.phaseName}</span>
        {after}
      </>
    );
  }
  return <>{text}</>;
}

/** §3.1 + §3.3 + §3.4 — calm live-stream feed line. */
function ActivityFeedEntry({ entry, isLive, running }: { entry: ChatEntry; isLive: boolean; running: boolean }) {
  const m = entry.activity!;
  const held = m.kind === 'phase' && entry.text.startsWith('Held');

  // §3.3 — warm error block (never a "System" card)
  if (m.kind === 'error') {
    const raw = m.reason ?? entry.text;
    const isParked = /blocked|parked|produced no document/i.test(raw);
    const reason = raw.replace(/^Phase\s+\S+:\s*/, '');
    return (
      <div
        role="alert"
        className={`relative flex items-start gap-2 py-[3px] pl-5 pr-2 text-xs leading-relaxed ${isLive ? 'opacity-100' : 'opacity-80'}`}
      >
        <span aria-hidden className={`absolute left-1 top-[9px] h-1.5 w-1.5 rounded-full ${isParked ? 'bg-amber-400' : 'bg-rose-400'}`} />
        <div className={`min-w-0 flex-1 rounded-lg border px-3 py-2 ${isParked ? 'border-amber-800/70 bg-amber-950/40' : 'border-rose-800/70 bg-rose-950/40'}`}>
          <div className="flex items-start gap-2">
            <TriangleAlert className={`mt-px h-3.5 w-3.5 shrink-0 ${isParked ? 'text-amber-400' : 'text-rose-400'}`} aria-hidden />
            <div className="min-w-0">
              <p className={`text-[11px] font-bold ${isParked ? 'text-amber-300' : 'text-rose-300'}`}>
                {isParked ? 'Needs attention' : 'Something went wrong'}
              </p>
              <p className={`mt-0.5 break-words ${isParked ? 'text-amber-200/90' : 'text-rose-200/90'}`}>{reason}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const live = isLive && running;
  const tone = dotTone(m, { live, held });
  const Icon = feedIconFor(m, entry.text);
  return (
    <div
      className={`relative flex items-start gap-2 py-[3px] pl-5 pr-2 text-xs leading-relaxed hover:rounded-md hover:bg-[#0d1017]/70 ${isLive ? 'opacity-100' : 'opacity-80'}`}
    >
      <span aria-hidden className={`absolute left-1 top-[9px] h-1.5 w-1.5 rounded-full ${tone}`} />
      <Icon className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[#6e7d92]" aria-hidden />
      <p className="min-w-0 flex-1 break-words text-[#a8b3c4]">
        {renderActivityText(m, entry.text)}
        {live && (
          <span className="ml-2 inline-block self-center rounded-full border border-[#ff2a3c]/45 bg-[#1a0208] px-2 py-px align-middle text-[10px] font-medium text-[#ffb3bd]">
            auto-drafting
          </span>
        )}
      </p>
    </div>
  );
}

/** §4.4 + §6.2 — classifier + calm note for untagged system entries. */
function LegacySystemNote({ entry }: { entry: ChatEntry }) {
  const stripped = entry.text.replace(/^[\s🔍✓⚠✎✔🚀☑]*/, '');

  if (/^(Error|Connection error):/i.test(stripped)) {
    const reason = stripped.replace(/^(Error|Connection error):\s*/i, '');
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-3 py-2 text-xs"
      >
        <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-rose-300">Something went wrong</p>
          <p className="mt-0.5 break-words text-rose-200/90">{reason}</p>
        </div>
      </div>
    );
  }

  if (/^(Draft approved|Saved|✔ Uploaded)/i.test(stripped)) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-[#8b5cf6]/60 bg-[#2e1065]/30 px-3 py-1.5 text-xs text-[#e8edf5]">
        <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-[#e8edf5]" aria-hidden />
        <p className="break-words">{stripped}</p>
      </div>
    );
  }

  return (
    <div className="relative flex items-start gap-2 py-[3px] pl-5 pr-2 text-xs leading-relaxed">
      <span aria-hidden className="absolute left-1 top-[9px] h-1.5 w-1.5 rounded-full bg-[#2a3342]" />
      <Activity className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[#6e7d92]" aria-hidden />
      <p className="min-w-0 flex-1 break-words text-[#a8b3c4]">{stripped}</p>
    </div>
  );
}

export interface DevelopmentViewProps {
  turnStream: ReturnType<typeof useTurnStream>;
  project: ProjectInfo | null;
  onProjectChanged: () => Promise<void> | void;
  initialPhase?: string;
  /** Workstream C/D: deep-link into the question panel (consumed once). */
  initialQuestionId?: string;
  /** Workstream C/D: state-based return path to the queue (design BC-5). */
  onNavigate?: (tab: string) => void;
}

export default function DevelopmentView({
  turnStream,
  project,
  onProjectChanged,
  initialPhase,
  initialQuestionId
}: DevelopmentViewProps) {
  const { entries, busy, status, toolActivity, checkpoint, sendTurn, abortTurn, clearCheckpoint, appendEntry } = turnStream;

  // Mount autopilot event hook locally; append live events to the chat pane.
  const handleAutopilotEvent = useCallback((ev: AutopilotLiveEvent) => {
    switch (ev.kind) {
      case 'start':
        return appendEntry({
          role: 'system',
          text: 'Auto-drafting started — working through the phases in order…',
          activity: { kind: 'phase' }
        });
      case 'phase':
        return appendEntry({
          role: 'system',
          text: phaseLine(ev),
          activity: { kind: 'phase', phaseId: ev.phaseId, phaseName: ev.name }
        });
      case 'status':
        return appendEntry({ role: 'system', text: ev.message, activity: { kind: 'live' } });
      case 'tool_call': {
        const { text } = formatToolCall(ev.tool, ev.args);
        return appendEntry({ role: 'system', text, activity: { kind: 'tool', tool: ev.tool } });
      }
      case 'complete':
        return appendEntry({
          role: 'system',
          text: summaryLine(ev),
          activity: {
            kind: 'complete',
            passedCount: ev.result.passed.length,
            parkedCount: ev.result.parked.length,
            stopped: ev.reason === 'stopped'
          }
        });
      case 'error':
        return appendEntry({ role: 'system', text: ev.message, activity: { kind: 'error', reason: ev.message } });
      case 'answer_queued':
        // §1.3 — no chat entry for queue heartbeats, only the card chip.
        setAnswerStates(prev => ({ ...prev, [ev.itemId]: { phase: 'queued' } }));
        return;
      case 'answer_applying':
        setAnswerStates(prev => ({ ...prev, [ev.itemId]: { phase: 'applying' } }));
        return;
      case 'answer_applied': {
        // §1.4.3 — exactly one chat entry per apply cycle, driven by this frame.
        setAnswerStates(prev => ({ ...prev, [ev.itemId]: { phase: 'applied' } }));
        const docPath = ev.item?.docPath;
        const firstAffected = ev.affectedDocs?.[0];
        let line: string;
        if (docPath) {
          line = `Answer applied to ${docPath.split('/').pop()} — scanning downstream docs…`;
        } else if (firstAffected) {
          line = `Answer applied — also updated ${firstAffected.split('/').pop()}.`;
        } else {
          line = 'Answer applied — incorporated into the run.';
        }
        return appendEntry({ role: 'system', text: line });
      }
      case 'answer_failed': {
        setAnswerStates(prev => ({ ...prev, [ev.itemId]: { phase: 'failed', error: ev.error } }));
        const title = portalItemsRef.current.find(i => i.id === ev.itemId)?.title ?? 'this question';
        return appendEntry({
          role: 'system',
          text: `Couldn't apply your answer to "${title}" — ${(ev.error ?? '').slice(0, 200)}. Retry from the question panel.`
        });
      }
      default:
        return; // question/parked surface via portal + right-pane panel
    }
  }, [appendEntry]);

  const { status: autopilotStatus, portalItems } = useAutopilotEvents(handleAutopilotEvent);

  // --- React Bits LatticeLoader (chat footer) ---
  // Shows while agents are working: `busy` covers critic/specialist turns
  // (it is the closest busy state in view scope); autopilotStatus.running
  // covers auto-draft runs. On working → idle, flashes 'done' for 2s.
  const agentsWorking = busy || !!autopilotStatus?.running;
  const [loaderFlash, setLoaderFlash] = useState(false);
  const prevWorkingRef = useRef(false);
  useEffect(() => {
    if (agentsWorking) {
      prevWorkingRef.current = true;
      setLoaderFlash(false);
      return;
    }
    if (!prevWorkingRef.current) return;
    prevWorkingRef.current = false;
    setLoaderFlash(true);
    const timer = setTimeout(() => setLoaderFlash(false), 2000);
    return () => clearTimeout(timer);
  }, [agentsWorking]);

  // --- Chat state ---
  const [prompt, setPrompt] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  // §8.1 — lifted question-surface state (D7): 'closed' | 'open' | 'minimized'
  // plus the general dismissal set. The badge and the right-pane panel both
  // derive from portalItems minus dismissedIds, so dismissal is deterministic
  // between 3s polls instead of waiting on the server.
  const [surface, setSurface] = useState<'closed' | 'open' | 'minimized'>('closed');
  const badgeRef = useRef<HTMLButtonElement>(null);
  const prevSurfaceRef = useRef<'closed' | 'open' | 'minimized' | null>(null);
  // §8.2 — Close restores focus to the badge (a11y); never steals focus on mount.
  useEffect(() => {
    if (prevSurfaceRef.current !== null && surface === 'closed' && prevSurfaceRef.current !== 'closed') {
      badgeRef.current?.focus();
    }
    prevSurfaceRef.current = surface;
  }, [surface]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [answerStates, setAnswerStates] = useState<Record<string, AnswerState>>({});

  // Board #53B — reload recovery: SSE answer frames are point-in-time and
  // never backfilled, so an answer that was queued before a reload must be
  // rebuilt from portal data. The server marks items with a pending queue
  // entry (meta.answerQueued) on the portal list payload; live frames always
  // win (the derive helper never downgrades an existing state).
  useEffect(() => {
    setAnswerStates(prev => deriveQueuedAnswerStates(portalItems, prev));
  }, [portalItems]);

  const portalItemsRef = useRef(portalItems);
  useEffect(() => {
    portalItemsRef.current = portalItems;
  }, [portalItems]);

  // §8.1/D7 — badge counts and panel items derive from the visible pool only.
  const visibleItems = useMemo(
    () => portalItems.filter(i => !dismissedIds.has(i.id) && (i.status === 'open' || i.status === 'answered')),
    [portalItems, dismissedIds]
  );
  const pendingCount = visibleItems.filter(i => i.status === 'open').length;
  const queuedOrApplyingCount = Object.values(answerStates).filter(s => s.phase === 'queued' || s.phase === 'applying').length;
  const blockingCount = visibleItems.filter(i => i.severity === 'blocking' && i.status === 'open').length;
  const appliedCount = Object.values(answerStates).filter(s => s.phase === 'applied').length;

  // §8.8 — live-region announcements on per-item answer-state phase transitions
  // only (moved from the retired left-pane question bar). First mount seeds the baseline so
  // pre-existing states are NOT announced; batch transitions accumulate in
  // order instead of overwriting each other.
  const [announcement, setAnnouncement] = useState('');
  const announcementMountedRef = useRef(false);
  const prevStatesRef = useRef<Record<string, AnswerState>>({});
  useEffect(() => {
    const current = answerStates ?? {};
    if (!announcementMountedRef.current) {
      announcementMountedRef.current = true;
      prevStatesRef.current = current;
      return;
    }
    const phrases: string[] = [];
    for (const [id, st] of Object.entries(current)) {
      const prev = prevStatesRef.current[id];
      if (!prev || prev.phase !== st.phase) {
        switch (st.phase) {
          case 'queued': phrases.push('Answer queued. Will apply after the current phase finishes.'); break;
          case 'applying': phrases.push('Applying answer to the document.'); break;
          case 'applied': phrases.push('Answer applied.'); break;
          case 'failed':
            phrases.push(`Couldn't apply your answer.${st.error ? ` ${st.error.slice(0, 200)}` : ''}`);
            break;
        }
      }
    }
    if (phrases.length > 0) setAnnouncement(phrases.join(' '));
    prevStatesRef.current = current;
  }, [answerStates]);

  // §8.6/§8.8 — announce question arrivals ("item arrives while closed → badge
  // pulse + count + live-region announce"). Seed the baseline on mount so
  // pre-existing items are not announced; only new arrivals announce.
  const prevPendingCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevPendingCountRef.current === null) {
      prevPendingCountRef.current = pendingCount;
      return;
    }
    const delta = pendingCount - prevPendingCountRef.current;
    prevPendingCountRef.current = pendingCount;
    if (delta > 0) {
      setAnnouncement(delta === 1 ? 'New question arrived.' : `${delta} new questions arrived.`);
    }
  }, [pendingCount]);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    chatEndRef.current?.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth' });
  }, [entries, status, checkpoint]);

  // Voice recorder
  const { recording, startRecording, stopRecording, error: voiceError } = useVoiceRecorder();

  // Alt-hold-to-record key listener. Only while the question panel is closed:
  // when it is open, QuestionPanel owns the Alt treatment for answer drafts
  // (exactly one window-level owner, no double recording).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // e.ctrlKey bails for AltGr layouts, which synthesize Ctrl+Alt.
      if (e.key === 'Alt' && !e.repeat && !recording && !e.ctrlKey) {
        startRecording();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && recording && !e.ctrlKey) {
        stopRecording().then(text => {
          if (text) setPrompt(prev => prev + text);
        });
      }
    };
    if (!busy && checkpoint === null && surface === 'closed') {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [busy, checkpoint, surface, recording, startRecording, stopRecording]);

  // §8.8 — Ctrl+. (or Meta+.) toggles the question panel: open ↔ minimized
  // (and opens from closed). The !e.altKey guard blocks AltGr layouts that
  // synthesize Ctrl+Alt+.; cleanup on unmount covers the project-switch remount.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.repeat && !e.isComposing && e.key === '.') {
        e.preventDefault();
        setSurface(s => (s === 'open' ? 'minimized' : 'open'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // §1.6.5 — SSE-drop fallback: the 3s poll only fetches open items, so an
  // answered item never appears in portalItems. When a queued/applying chip has
  // no open item behind it, the stream likely dropped between the 202 and the
  // terminal frame — check the answered pool directly. No chat entry from this
  // path (the SSE answer_applied handler owns the log).
  useEffect(() => {
    const openIds = new Set(portalItems.map(i => i.id));
    const pendingMissing = Object.entries(answerStates)
      .filter(([, st]) => st.phase === 'queued' || st.phase === 'applying')
      .map(([id]) => id)
      .filter(id => !openIds.has(id));
    if (pendingMissing.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await api.fetchPortalItems({ status: 'answered' });
        if (cancelled) return;
        const answeredIds = new Set(res.items.filter(i => i.status === 'answered').map(i => i.id));
        for (const id of pendingMissing) {
          if (!answeredIds.has(id)) continue;
          setAnswerStates(prev => {
            const cur = prev[id];
            if (!cur || (cur.phase !== 'queued' && cur.phase !== 'applying')) return prev;
            return { ...prev, [id]: { phase: 'applied' } };
          });
        }
      } catch {
        // Transient failure — the 3s poll retries naturally.
      }
    })();
    return () => { cancelled = true; };
  }, [portalItems, answerStates]);

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
  // Header compact mode: below 500px the selector shows status pill + chevron
  // only (doc name hidden) so the h-12 header line never wraps.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerCompact, setHeaderCompact] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setHeaderCompact(entry.contentRect.width < 500);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // §5.A cover semantics (Workstream C) — the DOC is never inert: it is what
  // the user reads while answering. The FEED gets inert + aria-hidden in its
  // place so tab order cannot wander underneath the panel overlay. The doc
  // element keeps docContentRef for the scroll/highlight logic only.
  const docContentRef = useRef<HTMLDivElement>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = feedScrollRef.current;
    if (!el) return;
    if (surface === 'open') {
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
    }
  }, [surface]);

  // --- Workstream C: pane sizing + collapse/Zen (design §5.I) ---
  const [leftPct, setLeftPct] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('starn.studio.splitPct');
      if (raw !== null) {
        const n = parseFloat(raw);
        if (Number.isFinite(n) && n >= 20 && n <= 80) return n;
      }
    } catch { /* storage unavailable — default 50/50 */ }
    return 50;
  });
  // MIN = 340px expressed as a % of the container; MAX keeps the right pane at
  // its 340px floor. minPct is capped at 33 (the clamp floor at the lg 1024px
  // breakpoint) per the design's sane-range rule.
  const [minPct, setMinPct] = useState(20);
  const maxPct = 100 - minPct;
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const computeClamp = () => {
      const width = rootRef.current?.getBoundingClientRect().width ?? window.innerWidth ?? 1024;
      setMinPct(Math.min(20, Math.round((200 / Math.max(width, 1)) * 100)));
    };
    computeClamp();
    window.addEventListener('resize', computeClamp);
    return () => window.removeEventListener('resize', computeClamp);
  }, []);

  const [docCollapsed, setDocCollapsed] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [zenPane, setZenPane] = useState<'left' | 'right' | null>(null);

  const leftIsRail = leftCollapsed || zenPane === 'right';
  const rightIsRail = docCollapsed || zenPane === 'left';
  let leftStyle: CSSProperties;
  let rightStyle: CSSProperties;
  if (zenPane === 'left') {
    leftStyle = { flex: '1 1 0%' };
    rightStyle = { flexBasis: '44px' };
  } else if (zenPane === 'right') {
    leftStyle = { flexBasis: '44px' };
    rightStyle = { flex: '1 1 0%' };
  } else if (leftCollapsed) {
    leftStyle = { flexBasis: '44px' };
    rightStyle = { flex: '1 1 0%' };
  } else if (docCollapsed) {
    leftStyle = { flex: '1 1 0%' };
    rightStyle = { flexBasis: '44px' };
  } else {
    leftStyle = { flexBasis: `${leftPct}%` };
    rightStyle = { flexBasis: `${100 - leftPct}%` };
  }
  const clampToRange = (pct: number) => Math.min(Math.max(pct, minPct), maxPct);
  const persistSplit = (pct: number) => {
    try {
      localStorage.setItem('starn.studio.splitPct', String(Math.round(clampToRange(pct))));
    } catch { /* presentational only */ }
  };

  // Esc exits Zen — but never while the open panel owns Escape (one owner).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (surface === 'open') return;
      setZenPane(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [surface]);

  // --- Workstream C: requirement-ID doc highlight (design §5.C) ---
  const [highlight, setHighlight] = useState<{ id: string; docPath: string; token: number } | null>(null);
  const highlightTokenRef = useRef(0);
  const selectedDocName = useMemo(
    () => roadmap.find(p => p.id === selectedPhase)?.artifactPath.split('/').pop(),
    [roadmap, selectedPhase]
  );
  const docHasTable = useMemo(() => /(?:^|\n)\s*\|/m.test(doc?.content ?? ''), [doc]);

  // Apply once the item's doc is loaded AND rendered (doc identity check keeps
  // the wrong/placeholder DOM from producing a false "couldn't locate").
  useEffect(() => {
    if (!highlight || editing) return;
    if (basename(highlight.docPath) !== selectedDocName) return;
    if (!doc || basename(doc.path) !== basename(highlight.docPath)) return;
    const root = docContentRef.current;
    if (!root) return;
    const ok = applyAnchorHighlight(root, highlight.id);
    setAnnouncement(ok
      ? `Jumped to ${highlight.id} in ${basename(highlight.docPath)}.`
      : `Opened ${basename(highlight.docPath)} — couldn't locate ${highlight.id} in this document.`);
  }, [highlight, doc, editing, selectedDocName]);

  // Clear highlights on edit-mode, doc change, panel close, and unmount.
  useEffect(() => {
    const el = docContentRef.current;
    if (!el) return;
    return () => clearAnchorHighlights(el);
  }, [doc, editing, surface]);

  // Deep-link (design §5.E): the panel adopts the focusRequest and emits
  // onFocusDocument, which runs the navigation below exactly once (no double
  // navigate/highlight). The initialQuestionId prop is consumed once.
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: number } | null>(null);
  const focusTokenRef = useRef(0);
  const consumedInitialRef = useRef(false);
  useEffect(() => {
    if (consumedInitialRef.current || !initialQuestionId) return;
    const item = visibleItems.find(i => i.id === initialQuestionId);
    if (!item) return;
    consumedInitialRef.current = true;
    setSurface('open');
    setFocusRequest({ id: item.id, token: ++focusTokenRef.current });
  }, [initialQuestionId, visibleItems]);

  /**
   * §5.C trigger handler — the panel emits onFocusDocument on chip/pager
   * click, open-onto-an-item, and deep-link adoption. Owns the doc navigation
   * (selectPhaseByDocPath) + highlight state; applyAnchorHighlight in the
   * effect above is the real doc-presence check once the target doc renders.
   */
  const handleFocusDocument = async (item: PortalItem): Promise<void> => {
    const docName = item.docPath ? basename(item.docPath) : '';
    if (!item.docPath || !docName) {
      setHighlight(null);
      return;
    }
    const ids = extractRequirementIds(`${item.title}\n${item.detail ?? ''}`);
    const targetLoaded = selectedDocName === docName;
    let id = pickAnchorId(ids, doc?.content ?? '');
    if (!targetLoaded) {
      await selectPhaseByDocPath(item.docPath);
      // Cross-doc: presence can't be checked against the unloaded target, so
      // carry the first candidate; the effect's applyAnchorHighlight verifies
      // against the rendered doc (false positives degrade to "no highlight").
      if (id === null && ids.length > 0) id = ids[0];
    }
    if (id) {
      setHighlight({ id, docPath: item.docPath, token: ++highlightTokenRef.current });
    } else {
      setHighlight(null);
      setAnnouncement(`Opened ${docName} — couldn't locate a requirement anchor in this document.`);
    }
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

  // Autopilot start/stop controls (§5) live in StartAutopilotButton (board #57
  // extraction) so the start flow and stop-failure alert are unit-testable.
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

  // §1.6.4 — submit wrapper: converts either POST shape (queued/applied) and any
  // throw into answerStates; failures log here, successes are logged exclusively
  // by the answer_applied frame.
  const handleQueueAnswer = useCallback(async (id: string, text: string): Promise<void> => {
    try {
      const res = await api.submitPortalAnswer(id, text);
      setAnswerStates(prev => ({ ...prev, [id]: { phase: 'queued' in res ? 'queued' : 'applied' } }));
    } catch (err) {
      setAnswerStates(prev => ({ ...prev, [id]: { phase: 'failed', error: (err as Error).message } }));
      appendEntry({ role: 'system', text: `Couldn't send your answer — ${(err as Error).message}.` });
      return;
    }
    await refreshDoc();   // keep existing refresh behavior; a refresh failure can't flip a good submit to 'failed'
  }, [appendEntry, refreshDoc]);

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

  /**
   * §8.1/D1/D5 — select the roadmap phase whose artifact filename matches a
   * portal item's docPath, then start from a clean (non-editing) view. Path
   * prefixes differ between docPath and artifactPath, so match by filename
   * suffix. Uses the doc-dropdown onSelect call pattern for api.setActivePhase.
   * No-op when no phase matches.
   */
  const selectPhaseByDocPath = async (docPath: string): Promise<void> => {
    const wanted = docPath.split('/').pop();
    if (!wanted) return;
    const phase = roadmap.find(p => p.artifactPath.split('/').pop() === wanted);
    if (!phase) return;
    setSelectedPhase(phase.id);
    setEditing(false);
    try {
      await api.setActivePhase(phase.id);
      await onProjectChanged();
    } catch {}
  };

  const renderStatusPill = (phase?: RoadmapPhase) => {
    if (!phase) return null;
    // Design §6 — autopilot completed the doc and open questions are flagged:
    // show the review state so the user can jump in and approve (option click
    // selects the doc; the existing onSelect flow is the review entry point).
    if (docNeedsApproval({
      docStatus: autopilotStatus?.docStatus[phase.id],
      openQuestions: phase.openQuestions
    })) {
      return (
        <span className="rounded bg-violet-950/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-300 border border-violet-800 shrink-0 inline-flex items-center gap-1">
          <Eye className="h-3 w-3" aria-hidden />
          Completed — needs approval
        </span>
      );
    }
    if (phase.status === 'COMPLETED') {
      return (
        <span className="rounded bg-[#2e1065] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#e8edf5] border border-[#8b5cf6] shrink-0">
          Completed
        </span>
      );
    }
    if (phase.status === 'IN_PROGRESS' || phase.status === 'PENDING_REVIEW') {
      return (
        <span className="rounded bg-violet-950/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-300 border border-violet-800 shrink-0">
          In Work
        </span>
      );
    }
    return (
      <span className="rounded bg-[#11151d] px-2 py-0.5 font-mono text-[10px] font-medium text-[#a8b3c4] border border-[#3b4658] shrink-0">
        Not Drafted
      </span>
    );
  };

  const lastActivityIdx = entries.reduce((last, e, i) => (e.activity ? i : last), -1);
  const latestActivityText = lastActivityIdx >= 0 ? entries[lastActivityIdx].text : '';

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      {/* ------------ Left pane: question surface covers the feed (§5.A) ------------ */}
      <section
        aria-label="Agent conversation"
        style={leftStyle}
        className={`relative flex min-h-0 flex-col border-r border-[#2a3342] ${leftIsRail ? 'overflow-hidden' : ''}`}
      >
        {/* §5.I — collapse / Zen strip (lg+ only; below lg the chat stays single-pane) */}
        <div className="hidden h-8 shrink-0 items-center gap-1 border-b border-[#2a3342] bg-[#0d1017]/70 px-2 lg:flex">
          <button
            type="button"
            onClick={() => setLeftCollapsed(true)}
            aria-label="Collapse conversation pane"
            title="Collapse conversation pane"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          </button>
          {zenPane === 'left' ? (
            <button
              type="button"
              onClick={() => setZenPane(null)}
              aria-label="Exit focus conversation pane"
              title="Exit focus conversation pane"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
            >
              <Minimize2 className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setZenPane('left')}
              aria-label="Focus conversation pane"
              title="Focus conversation pane"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
            >
              <Maximize2 className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        {leftIsRail && (
          <div className="absolute inset-0 z-30 hidden w-11 flex-col items-center justify-center gap-2 bg-[#0d1017]/95 lg:flex">
            <button
              type="button"
              onClick={() => {
                if (zenPane === 'right') setZenPane(null);
                else setLeftCollapsed(false);
              }}
              aria-label="Expand conversation pane"
              title="Expand conversation pane"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
            >
              <PanelLeftOpen className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        <div ref={feedScrollRef} id="studio-feed" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 relative">
          {entries.length === 0 && !busy && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-[#ff2a3c]/45 bg-[#1a0208]">
                {/* DotGrid (React Bits) replaces the bp-grid wash on the empty
                    pane placeholder; pointer-events-none + aria-hidden. */}
                <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                  <DotGrid
                    dotSize={2}
                    gap={24}
                    baseColor="#2a3342"
                    activeColor="#d9a441"
                    glow={0.1}
                    mouseInteraction={false}
                    clickShock={false}
                  />
                </div>
                <Bot className="relative h-7 w-7 text-[#ff2a3c]" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-medium text-[#e8edf5]">
                  {project ? `Let's build ${project.name}` : 'Engineering Studio ready'}
                </p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-[#a8b3c4]">
                  Tell the AI in plain words what you want next — “draft the shopping list”,
                  “check electrical safety”, or “write the step-by-step guide for ACTION-03”.
                  It will research, draft, and ask for your approval before saving.
                </p>
              </div>
            </div>
          )}

          {entries.map((entry, idx) => {
            // §6.3 — autopilot feed lines render as a calm dot-rail, never a "System" card
            if (entry.activity) {
              return (
                <ActivityFeedEntry
                  key={entry.id}
                  entry={entry}
                  isLive={idx === lastActivityIdx}
                  running={autopilotStatus?.running === true}
                />
              );
            }
            if (entry.role === 'system') {
              return <LegacySystemNote key={entry.id} entry={entry} />;
            }
            return (
              <article
                key={entry.id}
                className={`max-w-[92%] rounded-xl border p-3 ${
                  entry.role === 'user'
                    ? 'ml-auto border-violet-800/60 bg-violet-950/40'
                    : 'border-[#2a3342] bg-[#0d1017]/70'
                }`}
              >
                <header className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#a8b3c4]">
                  {entry.role === 'user' ? (
                    <><User className="h-3.5 w-3.5" aria-hidden /> You</>
                  ) : (
                    <>
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1a0208] ring-1 ring-[#ff2a3c]/45">
                        <Bot className="h-2.5 w-2.5 text-[#ffb3bd]" aria-hidden />
                      </span>
                      <span className="text-[#ffb3bd]">{entry.specialistName ?? 'AI Studio'}</span>
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
            );
          })}

          {busy && (
            <div className="flex items-center gap-2.5 rounded-xl border border-[#ff2a3c]/45 bg-[#1a0208]/80 p-3 text-xs text-[#ffb3bd]" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-[#ff2a3c] saber-on" aria-hidden />
              <span className="font-semibold">{status ?? 'AI is working…'}</span>
              {toolActivity && (
                <span className="flex min-w-0 items-center gap-1.5 rounded-lg border border-[#ff2a3c]/45 bg-[#05070c]/60 px-2.5 py-1 text-[11px] text-[#ffb3bd]">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#ff2a3c]" aria-hidden />
                  <span className="truncate">{formatToolCall(toolActivity, {}).text}</span>
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
          {/* S5 answer-feedback chat entries were replaced by the typed
              answer_applied / answer_failed frames — see handleAutopilotEvent. */}
          <div ref={chatEndRef} />
          {/* §7 — screen-reader live region for the newest activity line */}
          <div role="status" aria-live="polite" className="sr-only">
            {latestActivityText}
          </div>
        </div>

        {/* S1: QuestionBadge between scroll region and footer; opens the right-pane panel */}
        <QuestionBadge
          count={pendingCount}
          queuedCount={queuedOrApplyingCount}
          blockingCount={blockingCount}
          resolvedCount={appliedCount}
          surface={surface}
          subdued={checkpoint !== null}
          onOpen={() => setSurface('open')}
          buttonRef={badgeRef}
        />

        {/* Input bar */}
        <footer className="border-t border-[#2a3342] bg-[#0d1017]/70 p-3">
          <div className="flex flex-col gap-2">
            {/* LatticeLoader (React Bits) — agents-working indicator above the composer */}
            {(agentsWorking || loaderFlash) && (
              <LatticeLoader
                status={agentsWorking ? 'working' : 'done'}
                pattern="spiral"
                color="#ff2a3c"
                label="Agents working…"
                doneLabel="Agents done"
                showTimer={false}
                className="self-start"
              />
            )}
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
                disabled={busy || checkpoint !== null}
                placeholder={checkpoint ? 'Resolve the pending checkpoint above first…' : 'Message the agent… (Enter to send, Shift+Enter for newline)'}
                aria-label="Message the agent"
                className="min-h-[44px] flex-1 resize-none rounded-lg border border-[#3b4658] bg-[#05070c] px-3 py-2.5 text-sm text-[#e8edf5] placeholder:text-[#6e7d92] focus:border-[#ff2a3c] focus:outline-none disabled:opacity-50"
              />
              {/* Autopilot start/stop (icon variant, 44px) — left of mic, per §3 */}
              <StartAutopilotButton
                size="icon"
                running={!!autopilotStatus?.running}
                onStart={async () => { await api.autopilotStart(); }}
                onStop={async () => { await api.autopilotStop(); }}
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
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  recording
                    ? 'bg-rose-600 text-white motion-safe:animate-pulse'
                    : 'border border-[#3b4658] bg-[#11151d] text-[#a8b3c4] hover:border-[#ff2a3c] hover:text-[#ff2a3c]'
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
                  className="cut-corner-sm flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-[#d61f2c] text-white transition hover:bg-[#e11d3f] disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Send message"
                  title="Send message"
                >
                  <Send className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </div>
        </footer>
        {/* §8.8 — persistent live region owned by DevelopmentView; works with the panel closed */}
        <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
        {/* §5.A — the panel covers the feed inside the LEFT pane; the doc is never covered. */}
        {surface !== 'closed' && (
          <QuestionPanel
            surface={surface}
            items={visibleItems.filter(i => i.status === 'open')}
            answerStates={answerStates}
            onSubmit={handleQueueAnswer}
            onDismiss={async (id) => {
              setDismissedIds(prev => new Set(prev).add(id));
              try {
                await api.dismissPortalItem(id);
              } catch {
                // Roll back the local dismissal so the item stays visible/retryable
                // (the 3s poll keeps returning it until the server accepts).
                setDismissedIds(prev => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                });
                setAnnouncement('Couldn’t dismiss that question — it will reappear.');
              }
            }}
            onResume={async (docPath) => { try { await api.autopilotResume(docPath); } catch {} }}
            onEditDoc={(docPath) => { setSurface('closed'); void selectPhaseByDocPath(docPath); setEditing(true); }}
            selectedDocName={selectedDocName}
            onOpenDocument={(docPath) => { setSurface('closed'); void selectPhaseByDocPath(docPath); }}
            onExpand={() => setSurface('open')}
            onClose={() => setSurface('closed')}
            onFocusDocument={handleFocusDocument}
            focusRequest={focusRequest}
          />
        )}
      </section>

      {/* §5.I — pane divider (lg+ only; below lg the single chat pane stays full-width) */}
      <div className="hidden lg:flex">
        <PaneSplitter
          leftPct={leftPct}
          onChange={setLeftPct}
          onCommit={persistSplit}
          minPct={minPct}
          maxPct={maxPct}
        />
      </div>

      {/* --------------------------- Document pane ---------------------------- */}
      <section
        aria-label="Document workspace"
        style={rightStyle}
        className={`relative hidden min-h-0 flex-col lg:flex ${rightIsRail ? 'overflow-hidden' : ''}`}
      >
        {rightIsRail && (
          <div className="absolute inset-0 z-30 hidden w-11 flex-col items-center justify-center gap-2 bg-[#0d1017]/95 lg:flex">
            <button
              type="button"
              onClick={() => {
                if (zenPane === 'left') setZenPane(null);
                else setDocCollapsed(false);
              }}
              aria-label="Expand document pane"
              title="Expand document pane"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
            >
              <PanelRightOpen className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        <header ref={headerRef} className="flex h-12 items-center gap-2 border-b border-[#2a3342] bg-[#0d1017]/70 px-3">
          <FileText className="h-4 w-4 shrink-0 text-[#6e7d92]" aria-hidden />

          {/* Custom Document Selector Popover */}
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setDocDropdownOpen(v => !v)}
              aria-haspopup="listbox"
              aria-expanded={docDropdownOpen}
              className={`flex min-h-[40px] items-center gap-2.5 rounded-lg border border-[#3b4658] bg-[#05070c] px-3 text-sm font-medium text-[#e8edf5] hover:bg-[#0d1017] transition-colors cursor-pointer ${headerCompact ? 'w-10 justify-center' : ''}`}
            >
              {!headerCompact && (
                <span className="truncate max-w-[180px] sm:max-w-[240px]">
                  {selectedPhaseInfo ? selectedPhaseInfo.name : 'Select Document'}
                </span>
              )}
              {renderStatusPill(selectedPhaseInfo)}
              <ChevronDown className={`h-4 w-4 text-[#a8b3c4] transition-transform ${docDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {docDropdownOpen && (
              <div
                role="listbox"
                className="absolute left-0 top-full z-50 mt-1 max-h-80 w-80 sm:w-96 overflow-y-auto rounded-xl border border-[#3b4658] bg-[#05070c] p-1.5 shadow-2xl space-y-1"
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
                          ? 'bg-violet-950/70 text-violet-200 border border-violet-800/60 font-semibold'
                          : 'text-[#a8b3c4] hover:bg-[#0d1017] hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-mono text-[#6e7d92] text-[10px] w-4">{idx + 1}.</span>
                        <span className="truncate">{p.name}</span>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {renderStatusPill(p)}
                        {isSelected && <Check className="h-3.5 w-3.5 text-violet-400" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0" />

          <div className="flex shrink-0 items-center gap-1.5">
            {/* §5.B — folded quality-example drop zone: one Paperclip button, same file input */}
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
              aria-label="Attach a quality example"
              title="Attach a quality example"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60 disabled:opacity-40"
            >
              {uploadingExample ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Paperclip className="h-4 w-4" aria-hidden />}
            </button>
            {/* Doc header keeps a global stop reachable while autopilot runs;
                start lives solely in the chat composer (no duplicate Start surface). */}
            {autopilotStatus?.running && (
              <StartAutopilotButton
                running={!!autopilotStatus?.running}
                onStart={async () => { await api.autopilotStart(); }}
                onStop={async () => { await api.autopilotStop(); }}
              />
            )}
            <button
              onClick={() => void refreshDoc()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
              aria-label="Refresh document"
              title="Refresh document"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
            </button>
            {doc && !editing && (
              <button
                onClick={() => { setDraft(doc.content); setEditing(true); }}
                className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#3b4658] px-3 text-xs font-medium text-[#a8b3c4] transition hover:bg-[#11151d]"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={() => void saveDraft()}
                  disabled={saving}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#7c3aed] px-3 text-xs font-semibold text-white transition hover:bg-[#8b5cf6] disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
                  Save
                </button>
                <button
                  onClick={() => { setEditing(false); setDraft(doc?.content ?? ''); }}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#3b4658] px-3 text-xs text-[#a8b3c4] transition hover:bg-[#11151d]"
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden /> Cancel
                </button>
              </>
            )}
            {doc && !editing && doc.status !== 'approved' && selectedPhaseInfo?.docExists && (
              <button
                onClick={() => void approvePhase()}
                disabled={approving}
                className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#8b5cf6] px-3 text-xs font-semibold text-[#c4b5fd] transition hover:bg-[#2e1065] disabled:opacity-40"
              >
                {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <BadgeCheck className="h-3.5 w-3.5" aria-hidden />}
                Approve phase
              </button>
            )}
            <button
              type="button"
              onClick={() => setDocCollapsed(true)}
              aria-label="Collapse document pane"
              title="Collapse document pane"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
            >
              <PanelRightClose className="h-4 w-4" aria-hidden />
            </button>
            {zenPane === 'right' ? (
              <button
                type="button"
                onClick={() => setZenPane(null)}
                aria-label="Exit focus"
                title="Exit focus"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
              >
                <Minimize2 className="h-4 w-4" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setZenPane('right')}
                aria-label="Focus document pane"
                title="Focus document pane"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
              >
                <Maximize2 className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </header>

        {uploadNotice && (
          <p className={`border-b px-4 py-1.5 text-xs ${uploadNotice.startsWith('✔') ? 'border-[#8b5cf6]/60 bg-[#2e1065]/40 text-[#e8edf5]' : 'border-rose-800/60 bg-rose-950/40 text-rose-300'}`}>
            {uploadNotice}
          </p>
        )}

        {docNotice && (
          <p className="border-b border-[#8b5cf6]/60 bg-[#2e1065]/40 px-4 py-1.5 text-xs text-[#e8edf5]" role="status">
            {docNotice}
          </p>
        )}

        {/* §5.B — drag/drop now lives on the doc body wrapper (the strip is folded) */}
        <div
          className="relative min-h-0 flex-1"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFileUpload(file);
          }}
        >
          <div ref={docContentRef} className="h-full overflow-y-auto">
          {editing ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              spellCheck={false}
              aria-label="Document editor"
              className="h-full w-full resize-none bg-[#05070c] p-4 font-mono text-[13px] leading-relaxed text-[#e8edf5] focus:outline-none"
            />
          ) : doc ? (
            <div className={`px-6 py-4 ${docHasTable ? '' : 'max-w-[72ch]'}`}>
              <p className="mb-3 font-mono text-[11px] text-[#6e7d92]">{doc.path}</p>
              <Markdown content={doc.content} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <FileText className="h-8 w-8 text-[#3b4658]" aria-hidden />
              <p className="text-sm text-[#a8b3c4]">
                {docError ? 'No document yet for this phase.' : 'Loading…'}
              </p>
              {docError && (
                <p className="max-w-xs text-xs leading-relaxed text-[#6e7d92]">
                  Ask the agent to draft it — e.g. “create the {selectedPhaseInfo?.name ?? 'document'}”.
                </p>
              )}
            </div>
          )}
          </div>
        </div>
      </section>
    </div>
  );
}
