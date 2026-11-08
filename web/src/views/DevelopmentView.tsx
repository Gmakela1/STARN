import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
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
  Ellipsis,
  GitCompare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  List
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../api/client';
import {
  AnswerState,
  DocData,
  DocDiff as DocDiffData,
  LibraryFileEntry,
  PortalItem,
  ProjectInfo,
  RoadmapPhase
} from '../types/api';
import type { PromptBarSource } from '../components/reactbits/PromptBar/PromptBar';
import { useTurnStream, ChatEntry, ActivityMeta } from '../api/useTurnStream';
import { useAutopilotEvents, AutopilotLiveEvent, AutopilotPlanEvent } from '../hooks/useAutopilotEvents';
import Markdown, { slugifyHeading } from '../components/Markdown';
import DocDiff from '../components/DocDiff';
import { docNeedsApproval } from '../lib/workflowState';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import CriticScorecard from '../components/CriticScorecard';
import CheckpointPanel from '../components/CheckpointPanel';
import QuestionBadge from '../components/QuestionBadge';
import QuestionPanel from '../components/QuestionPanel';
import QuestionDetails from '../components/question-chat/QuestionDetails';
import RightPaneViewSwitch, { type RightPaneView } from '../components/question-chat/RightPaneViewSwitch';
import PaneSplitter from '../components/PaneSplitter';
import StartAutopilotButton from '../components/StartAutopilotButton';
// React Bits (reactbits.dev) decorative effect — see web/src/components/reactbits.
import DotGrid from '../components/reactbits/DotGrid';
import LatticeLoader from '../components/reactbits/LatticeLoader/LatticeLoader';
import PromptBar from '../components/reactbits/PromptBar/PromptBar';
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

/** One row of the doc-pane `⋯` menu (§3c.5). */
interface DocMenuAction {
  /** Stable key, in inline order. */
  key: string;
  /** Visible row label — identical to the inline button it replaces. */
  label: string;
  Icon: LucideIcon;
  /** The inline button's own handler, called verbatim. */
  onSelect: () => void;
  /** A disabled inline button becomes a disabled row, never an omitted one. */
  disabled?: boolean;
}

interface DocActionsMenuProps {
  /** Folded document actions in inline order (Attach, Refresh, Diff, Approve). */
  actions: DocMenuAction[];
  /** Folded pane-rail actions; rendered last, after a separator. */
  railActions: DocMenuAction[];
  /** Non-interactive status line (`role="presentation"`), null when inline. */
  statusLine?: string | null;
}

const DOC_MENU_ITEM =
  'flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:bg-[#11151d] focus:text-[#e8edf5] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40';

/**
 * `⋯` overflow menu for the doc-pane header (§3c.5 fold ladder).
 * Inputs: `actions` / `railActions` (rows in render order), `statusLine`.
 * Outputs: runs the folded control's own `onSelect`; closes on select, on
 * `Escape` (focus returns to the trigger) or on an outside pointerdown. Owns
 * only `open`. Throws: never.
 */
function DocActionsMenu({ actions, railActions, statusLine }: DocActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the first enabled row on open, so Escape/arrows always land in-menu.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  // Outside click closes (pointerdown, so it beats a row's click).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const closeAndReturnFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** Escape closes, arrows/Home/End rove over the enabled rows, Tab leaves. */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation(); // the pane's window Escape must not also fire
      closeAndReturnFocus();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const rows = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []
    );
    if (rows.length === 0) return;
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % rows.length;
    else next = current <= 0 ? rows.length - 1 : current - 1;
    rows[next].focus();
  }

  const renderRow = (action: DocMenuAction) => (
    <button
      key={action.key}
      type="button"
      role="menuitem"
      disabled={action.disabled}
      onClick={() => {
        closeAndReturnFocus();
        action.onSelect();
      }}
      className={DOC_MENU_ITEM}
    >
      <action.Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{action.label}</span>
    </button>
  );

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="doc-actions-menu"
        aria-label="More document actions"
        title="More document actions"
        /* 36 px visual box + a 4/3 px ::after halo = 44 px target (§3c.5). */
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[#a8b3c4] transition after:absolute after:inset-[-4px_-3px] after:content-[''] hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
      >
        <Ellipsis className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          ref={menuRef}
          id="doc-actions-menu"
          role="menu"
          aria-label="More document actions"
          onKeyDown={handleKeyDown}
          className="absolute right-0 top-full z-50 mt-1 min-w-[13rem] rounded-xl border border-[#3b4658] bg-[#05070c] p-1.5 shadow-2xl"
        >
          {actions.map(renderRow)}
          {actions.length > 0 && railActions.length > 0 && (
            <div role="separator" className="my-1 h-px bg-[#2a3342]" />
          )}
          {railActions.map(renderRow)}
          {statusLine && (
            <>
              <div role="separator" className="my-1 h-px bg-[#2a3342]" />
              {/* Words only: never a disabled menuitem (§3c.5). */}
              <div role="presentation" className="px-2.5 py-2 text-[10px] font-semibold text-[#a8b3c4]">
                {statusLine}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
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
    case 'revised': return `${name} revised by a ripple fix — pending your review`;
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

/** §7.5 — plan lines shown per event; the rest collapse to one `+N more` line. */
const PLAN_LINE_CAP = 5;

/**
 * Information-plan stream lines (spec §7.5): one per UNKNOWN claim, in the
 * specialist's written order. KNOWN claims are not actions and are never
 * shown. Inputs: a `plan` event. Outputs: at most `PLAN_LINE_CAP` lines plus a
 * trailing `+N more` when unknowns were dropped. Throws: never.
 */
export function planLines(ev: AutopilotPlanEvent): string[] {
  const unknown = ev.claims.filter(c => c.status === 'unknown');
  const lines = unknown.slice(0, PLAN_LINE_CAP).map(c => {
    const question = c.question ?? c.claim;
    return c.likelyAt ? `Researching: ${question} — expected in ${c.likelyAt}` : `Researching: ${question}`;
  });
  const hidden = unknown.length - PLAN_LINE_CAP;
  if (hidden > 0) lines.push(`+${hidden} more`);
  return lines;
}

/** §3.1 — lucide icon for a feed line; per-tool icons win for tool events. */
function feedIconFor(m: ActivityMeta, text: string): LucideIcon {
  // §7.5 — a research line reads as a search, not as a generic activity.
  if (text.startsWith('Researching:')) return Search;
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
  /** Workstream C/D: state-based return path to the queue (design BC-5).
   * Optional second arg selects a Vault sub-tab (e.g. ('vault','library')). */
  onNavigate?: (tab: string, subTab?: string) => void;
}

export default function DevelopmentView({
  turnStream,
  project,
  onProjectChanged,
  initialPhase,
  initialQuestionId,
  onNavigate
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
      case 'plan':
        // §7.5 — rendered by `handlePlan` (the hook's onPlan subscriber) so a
        // plan never merges into autopilot status; nothing to append here.
        return;
      default:
        return; // question/parked surface via portal + right-pane panel
    }
  }, [appendEntry]);

  /** §7.5 — one stream line per UNKNOWN plan claim; KNOWN claims are silent. */
  const handlePlan = useCallback(
    (ev: AutopilotPlanEvent) => {
      for (const text of planLines(ev)) {
        appendEntry({ role: 'system', text, activity: { kind: 'live' } });
      }
    },
    [appendEntry]
  );

  const { status: autopilotStatus, portalItems } = useAutopilotEvents(
    handleAutopilotEvent,
    handlePlan
  );

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
  // The draft lives inside PromptBar (React Bits). Externally-produced text
  // (voice transcripts) is appended to it through the injectedDraft channel.
  const [voiceInjection, setVoiceInjection] = useState<{ text: string; seq: number } | null>(null);
  const voiceSeqRef = useRef(0);
  const appendVoiceInjection = useCallback((text: string) => {
    voiceSeqRef.current += 1;
    setVoiceInjection({ text, seq: voiceSeqRef.current });
  }, []);
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

  // §3b — right-pane view switch (session-only, never persisted; not
  // localStorage, unlike the split preference). Document stays mounted at all
  // times; Details is an overlay for the active question (§3b.6(i)).
  const [rightView, setRightView] = useState<RightPaneView>('doc');
  const [detailsItem, setDetailsItem] = useState<PortalItem | null>(null);
  // The exact list QuestionPanel pages through, so "N of M" in Details and in
  // the left-pane context header can never disagree.
  const panelItems = useMemo(
    () => visibleItems.filter(i => i.status === 'open' || (i.status === 'answered' && i.meta?.autoApplied)),
    [visibleItems]
  );
  const detailsPagerIndex = detailsItem ? panelItems.findIndex(i => i.id === detailsItem.id) + 1 : 0;
  // §3b.6(v): Details is displayed only while the panel is open. Minimized
  // keeps the remembered value (Expand returns to it); closed resets it.
  const shownView: RightPaneView = surface === 'open' ? rightView : 'doc';
  const detailsOpen = shownView === 'details' && detailsItem !== null;
  // Closed → forget the item and the view (§3b.6(v)). Losing the item while
  // open → fall back to Document; the view can never point at nothing.
  useEffect(() => {
    if (surface !== 'closed') return;
    setRightView('doc');
    setDetailsItem(null);
  }, [surface]);
  useEffect(() => {
    if (!detailsItem) setRightView('doc');
  }, [detailsItem]);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    chatEndRef.current?.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth' });
  }, [entries, status, checkpoint]);

  // Voice recorder
  const { recording, startRecording, stopRecording, error: voiceError } = useVoiceRecorder();

  // --- PromptBar dictate ↔ recorder bridge ---
  // PromptBar's dictate button starts a dictation by calling onDictate and
  // keeps its listening UI up while the returned promise is pending. The
  // promise resolves when the recorder stops by itself (Alt release, mic
  // error); a second dictate click reaches onDictate again (stop path) and
  // ends the recorder, with the transcript delivered via injectedDraft.
  const dictateActiveRef = useRef(false);
  const dictateSawRecordingRef = useRef(false);
  const dictateResolverRef = useRef<((value: string | undefined) => void) | null>(null);

  const clearDictation = useCallback(() => {
    dictateActiveRef.current = false;
    dictateSawRecordingRef.current = false;
    const resolve = dictateResolverRef.current;
    dictateResolverRef.current = null;
    resolve?.(undefined);
  }, []);

  const handleDictate = useCallback(async (): Promise<string | undefined> => {
    if (recording) {
      // PromptBar stop click: end the recorder here; the transcript arrives
      // via the injectedDraft channel (the stop path drops returned values).
      dictateActiveRef.current = false;
      dictateResolverRef.current = null;
      const text = await stopRecording();
      if (text) appendVoiceInjection(text);
      return undefined;
    }
    if (busy || checkpoint !== null) return undefined;
    dictateActiveRef.current = true;
    dictateSawRecordingRef.current = false;
    startRecording();
    return new Promise<string | undefined>(resolve => {
      dictateResolverRef.current = resolve;
    });
  }, [recording, busy, checkpoint, startRecording, stopRecording, appendVoiceInjection]);

  useEffect(() => {
    if (recording) {
      dictateSawRecordingRef.current = true;
      return;
    }
    // Recorder stopped outside the dictate flow (Alt release, mic error,
    // unmount of the recorder) — release PromptBar's listening UI.
    if (dictateActiveRef.current && (dictateSawRecordingRef.current || voiceError)) {
      clearDictation();
    }
  }, [recording, voiceError, clearDictation]);

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
          if (text) appendVoiceInjection(text);
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
  }, [busy, checkpoint, surface, recording, startRecording, stopRecording, appendVoiceInjection]);

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

  /** PromptBar onSend → existing turn pipeline (detail extras ignored for now). */
  const handlePromptSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || checkpoint !== null) return;
    await sendTurn(trimmed, { activePhase: selectedPhase });
    await refreshDoc();
    await onProjectChanged();
  };

  // --- Repository docs (reference/) for the PromptBar source picker ---
  // Fetched once per project (refetch on project change). Failures leave the
  // 'Attach from repository…' submenu without rows — reference docs are
  // optional picker content.
  const [repoDocs, setRepoDocs] = useState<LibraryFileEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .fetchLibrary()
      .then(res => {
        if (!cancelled) setRepoDocs(res.references);
      })
      .catch(() => {
        // Picker content only — safe to stay empty.
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id]);
  // Top-level picker rows: 'Quality example' only. Repository docs live
  // exclusively in PromptBar's '__repo_attach' submenu (fed via the repoDocs
  // prop) — listing them here as direct inject rows doubled every doc row
  // in the picker list.
  const promptSources = useMemo<PromptBarSource[]>(
    () => [
      { key: 'example', name: 'Quality example', description: 'Upload for the selected phase', attach: true }
    ],
    []
  );

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
  // Revised-doc diff view (plan 2026-10-31): toggle + lazily-fetched
  // approved-vs-current snapshot. Fetched once per phase, on first toggle.
  const [diffOpen, setDiffOpen] = useState(false);
  const [docDiff, setDocDiff] = useState<DocDiffData | null>(null);
  const [diffUnavailable, setDiffUnavailable] = useState(false);
  useEffect(() => {
    setDiffOpen(false);
    setDocDiff(null);
    setDiffUnavailable(false);
  }, [selectedPhase]);
  // §3c.5 fold ladder — the doc header folds against ITS OWN width (a
  // ResizeObserver on the pane section), never the viewport. The full action
  // cluster needs ~1090 px, so folding is the normal state, not an edge case.
  // `POSITIVE_INFINITY` = "not measured yet": nothing folds on first paint.
  const docPaneRef = useRef<HTMLElement>(null);
  const [docPaneWidth, setDocPaneWidth] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const el = docPaneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setDocPaneWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Fold order (§3c.5 table): actions leave at <=759, the pane-rail buttons at
  // <=629, the selector's status words at <=519, the switch labels at <=429.
  const foldDocActions = docPaneWidth <= 759;
  // Details mode keeps the rail inline, so its `⋯` never exists (§3c.5 last
  // bullet): nothing is folded into it there.
  const foldDocRail = docPaneWidth <= 629 && !detailsOpen;
  const foldDocStatus = docPaneWidth <= 519;
  const iconOnlySwitch = docPaneWidth <= 429;

  // §5.A cover semantics (Workstream C) — the DOC is not inert while the user
  // answers questions: it is what they read. It IS inert (never display:none)
  // while the Details overlay covers it (§3b.6(i)): its controls leave the tab
  // order, its scrollTop and anchor ring survive. The FEED gets inert +
  // aria-hidden in the panel's place so tab order cannot wander underneath the
  // panel overlay. The doc element keeps docContentRef for the
  // scroll/highlight logic only.
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

  // §3b.3.5 — the Details overlay covers the doc tree; inert keeps its controls
  // out of the tab order without touching the DOM subtree.
  useEffect(() => {
    const el = docContentRef.current;
    if (!el) return;
    if (detailsOpen) {
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
    }
  }, [detailsOpen]);

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
  // Mini-TOC: H2 titles from the rendered doc (matches Markdown.tsx slug ids);
  // rendered as ONE 36 px strip in the doc pane when 3+ sections exist (§3d.1).
  const docToc = useMemo(
    () =>
      (doc?.content.match(/^##\s+(.+)$/gm) ?? []).map(h => h.replace(/^##\s+/, '').trim()),
    [doc]
  );
  // Mini-TOC active-section tracking (design brief §6): IntersectionObserver
  // over the rendered H2 anchors; the last section whose band crosses the top
  // quarter of the doc scroll container wins. Re-armed per doc / mode switch.
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  useEffect(() => {
    if (docToc.length < 3 || diffOpen || editing) return;
    const targets = docToc
      .map(t => document.getElementById(slugifyHeading(t)))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveTocId(entry.target.id);
        }
      },
      { root: docContentRef.current, rootMargin: '0px 0px -65% 0px', threshold: 0 }
    );
    targets.forEach(t => observer.observe(t));
    return () => observer.disconnect();
  }, [docToc, doc, diffOpen, editing]);

  // §3d.1 — strip refs + the `Sections` popover (the complete list on demand).
  const tocTrackRef = useRef<HTMLUListElement>(null);
  const tocMenuRef = useRef<HTMLDivElement>(null);
  const tocTriggerRef = useRef<HTMLButtonElement>(null);
  const [tocMenuOpen, setTocMenuOpen] = useState(false);
  const [tocMenuTop, setTocMenuTop] = useState(0);

  // §3d.1 — keep the active pill inside the strip. Re-centres on active change
  // AND on resize: a drag never changes `activeTocId`, so the id alone leaves
  // the active pill scrolled out of view after the pane is widened.
  useEffect(() => {
    const track = tocTrackRef.current;
    if (!track) return;
    const centreActive = () => {
      if (!activeTocId) return;
      // Never yank a link the user is on (native focus scrolling owns that).
      if (track.contains(document.activeElement)) return;
      const active = track.querySelector<HTMLElement>('[aria-current="true"]');
      if (!active) return;
      const target = active.offsetLeft - track.clientWidth / 2 + active.offsetWidth / 2;
      const max = track.scrollWidth - track.clientWidth;
      if (typeof track.scrollTo !== 'function') return;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      track.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: reduced ? 'auto' : 'smooth' });
    };
    centreActive();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(centreActive);
    ro.observe(track);
    return () => ro.disconnect();
  }, [activeTocId, docToc]);

  // §3d.1 — Esc closes the popover and returns focus to the trigger; an
  // outside pointerdown closes it. No focus trap: a list of links, not a modal.
  useEffect(() => {
    if (!tocMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setTocMenuOpen(false);
      tocTriggerRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (tocMenuRef.current?.contains(target) || tocTriggerRef.current?.contains(target)) return;
      setTocMenuOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [tocMenuOpen]);

  /** Toggle the `Sections` popover, measuring its top off the trigger once. */
  const toggleTocMenu = (): void => {
    if (!tocMenuOpen) {
      const trigger = tocTriggerRef.current;
      const pane = docPaneRef.current;
      if (trigger && pane) {
        setTocMenuTop(trigger.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + 6);
      }
    }
    setTocMenuOpen(open => !open);
  };

  /** Strip keyboard: ←/→ scroll the single row (links keep native Tab order). */
  const handleTocTrackKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.currentTarget.scrollLeft += e.key === 'ArrowRight' ? 120 : -120;
  };

  /** Mini-TOC click: motion-safe smooth scroll + focus the section card. */
  const handleTocClick = (e: ReactMouseEvent<HTMLAnchorElement>, slug: string): void => {
    e.preventDefault();
    const heading = document.getElementById(slug);
    if (!heading) return;
    const reduced =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
    heading.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    const card = heading.closest('section');
    if (card instanceof HTMLElement) card.focus({ preventScroll: true });
  };

  /** Req-chip click-through (brief §4.6): flash the block containing the ID
      via the existing anchor machinery (reuse, no new highlight style). */
  const handleDocChipClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const chip = (e.target as HTMLElement).closest('.sf-req-chip');
    if (!(chip instanceof HTMLElement) || !docContentRef.current) return;
    applyAnchorHighlight(docContentRef.current, chip.textContent?.trim() ?? '');
  };

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
  const handleFocusDocument = async (item: PortalItem, force = false): Promise<void> => {
    // §3b.6(iv) — with the Details overlay up the document is inert: navigating
    // it would be invisible work and a wasted fetch. `Open document` in the
    // record flips the view first and then runs this same path (force).
    if (detailsOpen && !force) return;
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

  /**
   * §3b.6(vi) — flip the right pane and announce once through the existing live
   * region; focus does not move (cross-pane stealing would break the composer
   * order). No new shortcut, no localStorage.
   */
  function changeRightView(next: RightPaneView): void {
    setRightView(next);
    if (next === 'details' && detailsItem) {
      const reqId = extractRequirementIds(`${detailsItem.title}\n${detailsItem.detail ?? ''}`)[0];
      setAnnouncement(`Right pane: details${reqId ? ` for ${reqId}` : ''}.`);
    }
  }

  /**
   * Details' `Open document` (§3b.6(iv)): navigate via the existing
   * handleFocusDocument path AND flip back to Document in the same action, so
   * the anchor flash happens on a visible, non-inert doc.
   */
  function openDetailsDocument(): void {
    const target = detailsItem;
    setRightView('doc');
    if (target) void handleFocusDocument(target, true);
  }

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
  const selectedDocStatus = selectedPhaseInfo
    ? autopilotStatus?.docStatus[selectedPhaseInfo.id]
    : undefined;

  /** Toggles the diff pane; lazily fetches the approved snapshot once. */
  const toggleDiff = useCallback(async () => {
    if (diffOpen) {
      setDiffOpen(false);
      return;
    }
    setDiffOpen(true);
    if (docDiff || diffUnavailable || !selectedPhase) return;
    try {
      const d = await api.fetchDocDiff(selectedPhase);
      if (d.approvedAvailable && d.approved !== null) {
        setDocDiff(d);
      } else {
        setDiffUnavailable(true); // no archived approved snapshot to diff against
      }
    } catch {
      setDiffUnavailable(true);
    }
  }, [diffOpen, docDiff, diffUnavailable, selectedPhase]);

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

  /** The selector pill's words (null when no phase). §3c.5: the same words
      feed the selector's title/aria-label and the `⋯` menu's status row once
      the pill folds at <=519 px. */
  const docStatusWords = (phase?: RoadmapPhase): string | null => {
    if (!phase) return null;
    // Design §6 — autopilot completed the doc and open questions are flagged:
    // show the review state so the user can jump in to approve (option click
    // selects the doc; the existing onSelect flow is the review entry point).
    if (docNeedsApproval({
      docStatus: autopilotStatus?.docStatus[phase.id],
      openQuestions: phase.openQuestions
    })) {
      return 'Completed — needs approval';
    }
    if (phase.status === 'COMPLETED') return 'Completed';
    if (phase.status === 'IN_PROGRESS' || phase.status === 'PENDING_REVIEW') return 'In Work';
    return 'Not Drafted';
  };

  const renderStatusPill = (phase?: RoadmapPhase) => {
    const words = docStatusWords(phase);
    if (!words) return null;
    if (words === 'Completed — needs approval') {
      return (
        <span className="rounded bg-violet-950/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-300 border border-violet-800 shrink-0 inline-flex items-center gap-1">
          <Eye className="h-3 w-3" aria-hidden />
          {words}
        </span>
      );
    }
    if (words === 'Completed') {
      return (
        <span className="rounded bg-[#2e1065] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#e8edf5] border border-[#8b5cf6] shrink-0">
          {words}
        </span>
      );
    }
    if (words === 'In Work') {
      return (
        <span className="rounded bg-violet-950/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-300 border border-violet-800 shrink-0">
          {words}
        </span>
      );
    }
    return (
      <span className="rounded bg-[#11151d] px-2 py-0.5 font-mono text-[10px] font-medium text-[#a8b3c4] border border-[#3b4658] shrink-0">
        {words}
      </span>
    );
  };

  const lastActivityIdx = entries.reduce((last, e, i) => (e.activity ? i : last), -1);
  const latestActivityText = lastActivityIdx >= 0 ? entries[lastActivityIdx].text : '';

  // §3c.5 — the folded rows keep the inline buttons' labels, icons, disabled
  // states and handlers. Nothing is omitted, only relocated; a disabled action
  // renders as a disabled row.
  const docStatusLine = docStatusWords(selectedPhaseInfo);
  const foldedDocActions: DocMenuAction[] = [];
  if (!detailsOpen && foldDocActions) {
    foldedDocActions.push({
      key: 'attach',
      label: 'Attach a quality example',
      Icon: Paperclip,
      onSelect: () => fileInputRef.current?.click(),
      disabled: uploadingExample || busy
    });
    foldedDocActions.push({
      key: 'refresh',
      label: 'Refresh document',
      Icon: RefreshCw,
      onSelect: () => void refreshDoc()
    });
    if (doc && !editing && selectedDocStatus === 'revised') {
      foldedDocActions.push({ key: 'diff', label: 'Diff', Icon: GitCompare, onSelect: () => void toggleDiff() });
    }
    if (doc && !editing && doc.status !== 'approved' && selectedPhaseInfo?.docExists) {
      foldedDocActions.push({
        key: 'approve',
        label: 'Approve phase',
        Icon: BadgeCheck,
        onSelect: () => void approvePhase(),
        disabled: approving
      });
    }
  }
  const foldedRailActions: DocMenuAction[] = [];
  if (foldDocRail) {
    foldedRailActions.push({
      key: 'collapse',
      label: 'Collapse document pane',
      Icon: PanelRightClose,
      onSelect: () => setDocCollapsed(true)
    });
    if (zenPane === 'right') {
      foldedRailActions.push({ key: 'zen', label: 'Exit focus', Icon: Minimize2, onSelect: () => setZenPane(null) });
    } else {
      foldedRailActions.push({ key: 'zen', label: 'Focus document pane', Icon: Maximize2, onSelect: () => setZenPane('right') });
    }
  }
  // §3c.5 — at <=519 px the pill's words move to the selector's title/aria-label.
  const docSelectorName = selectedPhaseInfo ? selectedPhaseInfo.name : 'Select Document';
  const docSelectorLabel = docStatusLine ? `${docSelectorName} — ${docStatusLine}` : docSelectorName;
  let docSelNameWidth = 'max-w-[180px] sm:max-w-[240px]';
  if (foldDocRail) docSelNameWidth = 'max-w-[4.5rem]';
  if (foldDocStatus) docSelNameWidth = 'max-w-[9rem]';

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
            {/* LatticeLoader (React Bits) — agents-working indicator above the
                composer; hidden while autopilot runs (the rocket button carries
                the loader for autopilot turns). */}
            {!autopilotStatus?.running && (agentsWorking || loaderFlash) && (
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
              {/* Autopilot start/stop (composer variant, 56x56 rocket) — outside/left of PromptBar, bottom-aligned with the row */}
              <StartAutopilotButton
                size="composer"
                running={!!autopilotStatus?.running}
                onStart={async () => { await api.autopilotStart(); }}
                onStop={async () => { await api.autopilotStop(); }}
              />
              {/* PromptBar (React Bits) — owns the composer: textarea, attach
                  menu, dictate toggle and the send↔stop morphing button. */}
              <PromptBar
                className="min-w-0 flex-1"
                width="100%"
                radius={14}
                background="#11151d"
                menuBackground="#0d1017"
                color="#e8edf5"
                sparkColor="#ff2a3c"
                busy={busy}
                placeholder={
                  checkpoint
                    ? 'Resolve the pending checkpoint above first…'
                    : project
                      ? `Tell the ${project.name} agent what to do next… (Enter to send)`
                      : 'Message the agent… (Enter to send, Shift+Enter for newline)'
                }
                sources={promptSources}
                repoDocs={repoDocs}
                onUploadNavigate={() => onNavigate?.('vault', 'library')}
                commands={[]}
                models={[]}
                efforts={[]}
                onSend={text => void handlePromptSend(text)}
                onStop={() => void abortTurn()}
                onAttach={() => {
                  fileInputRef.current?.click();
                }}
                onDictate={handleDictate}
                injectedDraft={voiceInjection}
              />
            </div>
          </div>
        </footer>
        {/* §8.8 — persistent live region owned by DevelopmentView; works with the panel closed */}
        <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
        {/* §5.A — the panel covers the feed inside the LEFT pane; the doc is never covered. */}
        {surface !== 'closed' && (
          <QuestionPanel
            surface={surface}
            items={panelItems}
            answerStates={answerStates}
            onSubmit={handleQueueAnswer}
            onConfirmProposal={async (id, editedText) => {
              try {
                await api.confirmProposal(id, editedText);
                await refreshDoc();
              } catch (err) {
                appendEntry({ role: 'system', text: `Couldn't apply the research proposal — ${(err as Error).message}.` });
                throw err;
              }
            }}
            onRejectProposal={async (id) => {
              try {
                await api.rejectProposal(id);
              } catch (err) {
                appendEntry({ role: 'system', text: `Couldn't reject the research proposal — ${(err as Error).message}.` });
                throw err;
              }
            }}
            onUndoAuto={async (id) => {
              try {
                await api.undoAutoApplied(id);
                await refreshDoc();
              } catch (err) {
                appendEntry({ role: 'system', text: `Couldn't undo the auto-applied answer — ${(err as Error).message}.` });
                throw err;
              }
            }}
            onResearchAll={async () => {
              await api.researchAll();
              await refreshDoc();
            }}
            onThreadMessage={async (id, text) => {
              await api.postThreadMessage(id, text);
            }}
            onConcludeThread={async (id) => {
              // The server appends the kind:'proposal' row; the 3s portal poll
              // carries it back to the panel, same refresh path as a thread turn.
              await api.concludeThread(id);
            }}
            onConfirmThreadProposal={async (id, proposalTs, editedText) => {
              try {
                await api.confirmThreadProposal(id, proposalTs, editedText);
                await refreshDoc();
              } catch (err) {
                appendEntry({ role: 'system', text: `Couldn't record the concluded answer — ${(err as Error).message}.` });
                throw err;
              }
            }}
            onRejectThreadProposal={async (id, proposalTs) => {
              await api.rejectThreadProposal(id, proposalTs);
            }}
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
            onActiveItemChange={(item) => setDetailsItem(item && item.type === 'question' ? item : null)}
            onOpenDetails={() => changeRightView('details')}
          />
        )}
      </section>

      {/* §5.I — pane divider (md+ since §3b.3.8: Details needs a right-pane home
          at 900 px; below md the single chat pane stays full-width).
          Rendered directly in the pane row: drag math measures parentElement,
          so a wrapper div (8px wide) would desync it from the real row. */}
      <PaneSplitter
        className="hidden md:flex"
        leftPct={leftPct}
        onChange={setLeftPct}
        onCommit={persistSplit}
        minPct={minPct}
        maxPct={maxPct}
      />

      {/* --------------------------- Document pane ---------------------------- */}
      <section
        ref={docPaneRef}
        aria-label="Document workspace"
        style={rightStyle}
        className={`docPane relative hidden min-h-0 min-w-0 flex-col md:flex ${rightIsRail ? 'overflow-hidden' : ''}`}
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

        {/* §3c.5 — `min-w-0` on the header and its flex children: the fold
            ladder keeps the row narrower than the pane, so nothing paints past
            the edge. No `overflow-hidden` here — the selector listbox and the
            `⋯` panel hang below the row and must not be clipped. */}
        <header className="flex h-12 min-w-0 items-center gap-2 border-b border-[#2a3342] bg-[#0d1017]/70 px-3">
          {detailsOpen && detailsItem ? (
            /* §3b.6(ii) — read-only identity line. The document actions below
               describe a body that is not on screen, so they are not rendered. */
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-[var(--sf-text-2)]">
              <List className="h-4 w-4 shrink-0 text-[#6e7d92]" aria-hidden />
              <span className="truncate">
                Details · {detailsPagerIndex} of {panelItems.length}
                {detailsItem.docPath ? ` · ${basename(detailsItem.docPath)}` : ''}
              </span>
            </div>
          ) : (
            <>
              <FileText className="h-4 w-4 shrink-0 text-[#6e7d92]" aria-hidden />

              {/* Custom Document Selector Popover. §3c.5: the name narrows at
                  <=629 px; at <=519 px the status pill folds and its words move
                  into `title`/`aria-label` (never lost, just not inline). */}
              <div ref={dropdownRef} className="relative min-w-0">
                <button
                  type="button"
                  onClick={() => setDocDropdownOpen(v => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={docDropdownOpen}
                  aria-label={foldDocStatus ? `Select document — ${docSelectorLabel}` : undefined}
                  title={foldDocStatus ? docSelectorLabel : undefined}
                  className="flex min-h-[40px] max-w-full items-center gap-2.5 rounded-lg border border-[#3b4658] bg-[#05070c] px-3 text-sm font-medium text-[#e8edf5] hover:bg-[#0d1017] transition-colors cursor-pointer"
                >
                  <span className={`truncate ${docSelNameWidth}`}>{docSelectorName}</span>
                  {!foldDocStatus && renderStatusPill(selectedPhaseInfo)}
                  <ChevronDown className={`h-4 w-4 shrink-0 text-[#a8b3c4] transition-transform ${docDropdownOpen ? 'rotate-180' : ''}`} />
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
            </>
          )}

          {/* §3b.3.4 / §3b.6(vi) — Document | Details tablist, after the
              selector and before the action cluster. */}
          <RightPaneViewSwitch
            value={shownView}
            onChange={changeRightView}
            disabled={!detailsItem}
            iconOnly={iconOnlySwitch}
          />

          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
            {/* §3b.6(ii) — the document controls are hidden (not disabled) in
                Details mode; collapse/zen stay. */}
            {!detailsOpen && (
              <>
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
                {/* §3c.5 rows 1-2 — Attach and Refresh leave the inline row at
                    <=759 px and reappear as `⋯` rows (same labels, handlers). */}
                {!foldDocActions && (
                  <>
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
                    {/* Autopilot start/stop live solely in the chat composer's rocket
                        button; the doc header keeps no autopilot control. */}
                    <button
                      onClick={() => void refreshDoc()}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
                      aria-label="Refresh document"
                      title="Refresh document"
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden />
                    </button>
                  </>
                )}
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
                {!foldDocActions && doc && !editing && doc.status !== 'approved' && selectedPhaseInfo?.docExists && (
                  <button
                    onClick={() => void approvePhase()}
                    disabled={approving}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#8b5cf6] px-3 text-xs font-semibold text-[#c4b5fd] transition hover:bg-[#2e1065] disabled:opacity-40"
                  >
                    {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <BadgeCheck className="h-3.5 w-3.5" aria-hidden />}
                    Approve phase
                  </button>
                )}
                {!foldDocActions && doc && !editing && selectedDocStatus === 'revised' && (
                  <button
                    onClick={() => void toggleDiff()}
                    aria-label="Toggle diff view"
                    title="Toggle diff view"
                    className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#3b4658] px-3 text-xs font-medium text-[#a8b3c4] transition hover:bg-[#11151d]"
                  >
                    Diff
                  </button>
                )}
              </>
            )}
            {/* §3c.5 — `⋯` is never folded; it exists only while something is
                folded into it (so Details mode, which hides the doc actions and
                keeps the rail inline, has no `⋯`). */}
            {(foldedDocActions.length > 0 || foldedRailActions.length > 0) && (
              <DocActionsMenu
                actions={foldedDocActions}
                railActions={foldedRailActions}
                statusLine={foldDocStatus ? docStatusLine : null}
              />
            )}
            {/* §3c.5 rows 5 — the pane-rail buttons fold last, at <=629 px. */}
            {!foldDocRail && (
              <>
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
              </>
            )}
          </div>
        </header>

        {/* Upload outcome (picked/failed) — the live region stays mounted so
            screen readers announce notice changes reliably. */}
        <span aria-live="polite">
          {uploadNotice && (
            <p className={`border-b px-4 py-1.5 text-xs ${uploadNotice.startsWith('✔') ? 'border-[#8b5cf6]/60 bg-[#2e1065]/40 text-[#e8edf5]' : 'border-rose-800/60 bg-rose-950/40 text-rose-300'}`}>
              {uploadNotice}
            </p>
          )}
        </span>

        {docNotice && (
          <p className="border-b border-[#8b5cf6]/60 bg-[#2e1065]/40 px-4 py-1.5 text-xs text-[#e8edf5]" role="status">
            {docNotice}
          </p>
        )}

        {/* Revised-doc banner (plan 2026-10-31) — shows on docStatus 'revised'
            regardless of rail state; never collides with the uploadNotice
            live region above. Wording switches when no snapshot archived. */}
        {selectedDocStatus === 'revised' && (
          <p className="border-b border-rose-800/60 bg-rose-950/40 px-4 py-1.5 text-xs text-rose-300" role="status">
            {diffUnavailable ? 'Revised (original version not archived)' : 'Revised — changes since approval'}
          </p>
        )}

        {/* §5.B — drag/drop now lives on the doc body wrapper (the strip is folded).
            §3b.3.5 — this is the Document tabpanel: the tree stays MOUNTED at all
            times (overlay + inert, never display:none) so scrollTop, the anchor
            ring, diff state and the unsaved draft survive a view switch. */}
        <div
          role="tabpanel"
          id="pane-doc"
          aria-labelledby="tab-doc"
          className="relative min-h-0 min-w-0 flex-1"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFileUpload(file);
          }}
        >
          <div ref={docContentRef} onClick={handleDocChipClick} className="h-full overflow-y-auto">
          {editing ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              spellCheck={false}
              aria-label="Document editor"
              className="h-full w-full resize-none bg-[#05070c] p-4 font-mono text-[13px] leading-relaxed text-[#e8edf5] focus:outline-none"
            />
          ) : doc ? (
            <div className="doc-body">
              <p className="mb-3 font-mono text-[11px] text-[#6e7d92]">{doc.path}</p>
              {/* §3d.1 — ONE 36 px section strip: single row, never wraps, the
                  active pill auto-centred, `Sections` as the complete list.
                  Anchors target the H2 ids emitted by Markdown. */}
              {docToc.length >= 3 && !diffOpen && !editing && (
                <nav aria-label="Document sections" className="doc-tocbar">
                  <ul
                    ref={tocTrackRef}
                    tabIndex={0}
                    aria-label="Section strip"
                    onKeyDown={handleTocTrackKeyDown}
                    className="doc-tocbar__track"
                  >
                    {docToc.map((title, i) => {
                      const slug = slugifyHeading(title);
                      const active = activeTocId === slug;
                      return (
                        <li key={`${i}-${title}`}>
                          <a
                            href={`#${slug}`}
                            aria-current={active ? 'true' : undefined}
                            onClick={e => handleTocClick(e, slug)}
                          >
                            {title}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    type="button"
                    ref={tocTriggerRef}
                    className="doc-tocbar__all"
                    aria-expanded={tocMenuOpen}
                    aria-controls="doc-toc-menu"
                    aria-haspopup="true"
                    onClick={toggleTocMenu}
                  >
                    Sections <ChevronDown className="h-3 w-3" aria-hidden />
                  </button>
                </nav>
              )}
              {/* §3d.2 — the single measure owner: min(100%, 88ch) on `.doc-flow`. */}
              <div className="doc-flow">
                {/* Diff pane replaces the rendered doc while toggled on; the
                    content equality check drops the pane when the doc was
                    refreshed after the snapshot was fetched (stale guard). */}
                {diffOpen && docDiff && doc.content === docDiff.current ? (
                  <DocDiff approved={docDiff.approved!} current={docDiff.current} />
                ) : (
                  <Markdown content={doc.content} variant="document" />
                )}
              </div>
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

          {/* §3b.3.5 — the Details overlay. Keyed by item so its two local
              disclosures never leak across questions. */}
          {detailsOpen && detailsItem && (
            <div
              role="tabpanel"
              id="pane-details"
              aria-labelledby="tab-details"
              className="absolute inset-0 z-10 overflow-y-auto bg-[var(--sf-void)]"
            >
              <QuestionDetails
                key={detailsItem.id}
                item={detailsItem}
                pagerIndex={detailsPagerIndex}
                total={panelItems.length}
                selectedDocName={selectedDocName}
                onOpenDocument={openDetailsDocument}
              />
            </div>
          )}
        </div>

        {/* §3d.1 — the `Sections` popover lives OUTSIDE the doc scroller so it
            cannot be clipped and adds no scroll height. It is a child of the
            pane (already `relative`, and the pane is the containing block for
            absolute descendants — never `fixed`), so `tocMenuTop` measured from
            the pane's top lands directly under the trigger. */}
        {tocMenuOpen && docToc.length >= 3 && !diffOpen && !editing && (
          <div
            id="doc-toc-menu"
            ref={tocMenuRef}
            role="group"
            aria-label="All document sections"
            className="doc-tocmenu"
            style={{ top: tocMenuTop }}
          >
            {docToc.map((title, i) => {
              const slug = slugifyHeading(title);
              const active = activeTocId === slug;
              return (
                <a
                  key={`${i}-${title}`}
                  href={`#${slug}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={e => {
                    handleTocClick(e, slug);
                    setTocMenuOpen(false);
                  }}
                >
                  {title}
                </a>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
