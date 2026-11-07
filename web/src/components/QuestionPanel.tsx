import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquare,
  RotateCcw,
  TriangleAlert,
  X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AnswerState, PortalItem } from '../types/api';
import { cleanQuestionTitle, groupPortalItemsByTopic } from '../lib/portalGrouping';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import QuestionChat from './question-chat/QuestionChat';
import QuestionContextHeader from './question-chat/QuestionContextHeader';
import type { ComposerMode } from './question-chat/ChatComposer';
import ProposalCard from './question-chat/ProposalCard';

export interface QuestionPanelProps {
  surface: 'closed' | 'open' | 'minimized';
  items: PortalItem[];
  answerStates: Record<string, AnswerState>;
  onSubmit: (id: string, text: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onResume: (docPath: string) => Promise<void>;
  onEditDoc: (docPath: string) => void;
  onExpand: () => void;
  onClose: () => void;
  /** Basename of the currently selected doc; gates the header "Open document" affordance (D5). */
  selectedDocName?: string;
  /** D5: close the panel, select the phase for docPath, and refresh the doc. */
  onOpenDocument?: (docPath: string) => void;
  /** Workstream C: parent-owned doc navigation + highlight (chip click / open / deep-link). */
  onFocusDocument?: (item: PortalItem) => void;
  /** Parent-driven deep-link focus (design §5.E); token prevents re-adoption. */
  focusRequest?: { id: string; token: number } | null;
  /** Research gate — confirm a proposal (editedText overrides the proposal text). */
  onConfirmProposal?: (id: string, editedText?: string) => Promise<void>;
  /** Research gate — reject a proposal (item stays a plain open question). */
  onRejectProposal?: (id: string) => Promise<void>;
  /** Research gate — undo an auto-applied answer (pre-incorporation window). */
  onUndoAuto?: (id: string) => Promise<void>;
  /** Research-all backfill — run the gate machinery over every eligible legacy open question. */
  onResearchAll?: () => Promise<void>;
  /** T-C answer-thread — one advisory specialist Q&A turn on an open question. */
  onThreadMessage?: (id: string, text: string) => Promise<void>;
  /** Conclude-from-chat — the server drafts one answer from the conversation. */
  onConcludeThread?: (id: string) => Promise<void>;
  /** Conclude-from-chat — accept the drafted answer (editedText overrides it). */
  onConfirmThreadProposal?: (id: string, proposalTs: number, editedText?: string) => Promise<void>;
  /** Conclude-from-chat — reject the drafted answer. */
  onRejectThreadProposal?: (id: string, proposalTs: number) => Promise<void>;
  /**
   * State lift (design §3b.3.3): the adopted active item, emitted once per
   * change so the parent can key the right-pane Details view.
   */
  onActiveItemChange?: (item: PortalItem | null) => void;
  /** Context header "Details" (§3b.4) — the parent flips the right pane. */
  onOpenDetails?: (item: PortalItem) => void;
}

/** §1.4.1 — per-phase chip visuals, keyed off the AnswerPhase union (moved from QuestionBar). */
const stateChip: Record<AnswerState['phase'], { icon: LucideIcon; label: string; cls: string; live?: boolean }> = {
  queued: { icon: Clock3, label: 'Queued — applies after this phase', cls: 'border-violet-700/50 bg-violet-950/40 text-violet-300' },
  applying: { icon: Loader2, label: 'Applying…', cls: 'border-[#ff2a3c]/45 bg-[#1a0208] text-[#ffb3bd]', live: true },
  applied: { icon: Check, label: 'Applied', cls: 'border-[#8b5cf6]/50 bg-[#2e1065]/40 text-[#e8edf5]' },
  failed: { icon: TriangleAlert, label: "Couldn't apply", cls: 'border-rose-700/50 bg-rose-950/40 text-rose-300' }
};

/** Length of the "Resolved ✓" dwell after an answer is applied (§1.6.3). */
const DWELL_MS = 8000;

// Board #53A — typed-but-unsubmitted answer drafts must survive close/reopen,
// panel unmount (project switch), and page reloads. A module-level store holds
// drafts per item id; when localStorage is available (it can throw in private
// mode, so every access is guarded) it mirrors the store, capped to the newest
// 20 drafts of 4KB each.
const DRAFTS_STORAGE_KEY = 'starn.questionDrafts.v1';
const DRAFT_STORE_CAP = 20;
const DRAFT_MAX_LENGTH = 4096;

let draftStore: Record<string, string> = (() => {
  try {
    const raw = window.localStorage.getItem(DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([id, text]) => typeof id === 'string' && typeof text === 'string'
    ) as Array<[string, string]>;
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
})();

function persistDraftStore(): void {
  try {
    const entries = Object.entries(draftStore).slice(-DRAFT_STORE_CAP);
    const trimmed: Record<string, string> = {};
    for (const [id, text] of entries) {
      trimmed[id] = text.length > DRAFT_MAX_LENGTH ? text.slice(0, DRAFT_MAX_LENGTH) : text;
    }
    draftStore = trimmed;
    window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage unavailable (private mode, quota) — the module store still holds
    // the drafts for this page session.
  }
}

function writeDraft(id: string, text: string): void {
  if (!id) return;
  // Board #57 — the 4KB cap is enforced at write time, not only in the persist
  // sweep: the store keeps a bounded prefix, so a reload always resurrects at
  // most 4KB per draft. The composer textarea keeps the user's full text live;
  // only the persisted/rehydrated draft is truncated.
  const capped = text.length > DRAFT_MAX_LENGTH ? text.slice(0, DRAFT_MAX_LENGTH) : text;
  draftStore = { ...draftStore, [id]: capped };
  persistDraftStore();
}

function dropDraft(id: string): void {
  if (!(id in draftStore)) return;
  const next = { ...draftStore };
  delete next[id];
  draftStore = next;
  persistDraftStore();
}

/** Test seam: clears the module draft store and its persisted mirror. */
export function resetQuestionDraftsForTests(): void {
  draftStore = {};
  try {
    window.localStorage.removeItem(DRAFTS_STORAGE_KEY);
  } catch {
    // Ignore — nothing to clear.
  }
}

/** Most recently resolved item still in dwell — used when the open pool is empty. */
function latestResolvedItem(resolved: Record<string, { item: PortalItem; until: number }>): PortalItem | null {
  let latest: { item: PortalItem; until: number } | null = null;
  for (const entry of Object.values(resolved)) {
    if (!latest || entry.until > latest.until) latest = entry;
  }
  return latest?.item ?? null;
}

/**
 * Right-pane question overlay (§8.4). Owns active-item selection (by id, never
 * index), per-item composer drafts, retry text, and the minimized dock strip.
 * The parent holds `surface` and `items`; the panel holds everything the 3s
 * poll must not disturb (D6, D8). The memo body, sources, the original-detail
 * disclosure and the answer history live in the right pane (QuestionDetails);
 * the left pane is chips → context header → conversation (design §3b.3.1).
 */
export default function QuestionPanel({
  surface,
  items: rawItems,
  answerStates,
  onSubmit,
  onDismiss,
  onResume,
  onEditDoc,
  onExpand,
  onClose,
  selectedDocName,
  onOpenDocument,
  onFocusDocument,
  focusRequest,
  onConfirmProposal,
  onRejectProposal,
  onUndoAuto,
  onResearchAll,
  onThreadMessage,
  onConcludeThread,
  onConfirmThreadProposal,
  onRejectThreadProposal,
  onActiveItemChange,
  onOpenDetails
}: QuestionPanelProps) {
  // F3 guard: the core intake rejects empty-title questions; legacy persisted
  // data may still hold some. Never render them (bare nav buttons / blank
  // title blob) — drop them from the whole panel consistently.
  // Memoized on the prop identity: a fresh array per render would re-fire every
  // effect that depends on `items` (infinite render loop).
  const items = useMemo(() => rawItems.filter(i => cleanQuestionTitle(i.title).length > 0), [rawItems]);
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? '');
  // Board #53A — drafts seed from the module store so close/reopen, unmount,
  // and page reload all restore the typed-but-unsubmitted answer.
  const [drafts, setDrafts] = useState<Record<string, string>>({ ...draftStore });
  const [retryText, setRetryText] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Item id with a submit in flight — gates the Send button (never Enter). */
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  /** Research gate — inline proposal edit (one item at a time). */
  const [proposalEdit, setProposalEdit] = useState<{ id: string; text: string } | null>(null);
  /** Research gate — item id with a proposal/undo action in flight. */
  const [gateActionId, setGateActionId] = useState<string | null>(null);
  /** Research gate — last proposal/undo action error per item id. */
  const [gateActionError, setGateActionError] = useState<Record<string, string>>({});
  /** Research-all backfill — one run in flight at a time (client state; per-item researching chips come from data). */
  const [researchAllBusy, setResearchAllBusy] = useState(false);
  const [researchAllError, setResearchAllError] = useState<string | null>(null);
  /** T-C answer-thread — in-flight flag and last error (the draft is `drafts`). */
  const [threadBusyId, setThreadBusyId] = useState<string | null>(null);
  const [threadErrors, setThreadErrors] = useState<Record<string, string>>({});
  /**
   * Composer mode per item (design §2b.4). Session-only, never persisted: an
   * absent key means 'advisory' (R1). Reset on mount, panel reopen, question
   * switch and after every send.
   */
  const [modes, setModes] = useState<Record<string, ComposerMode>>({});
  /** Chips strip overflow affordance (§3c.4): which edges hide content. */
  const [chipEdge, setChipEdge] = useState<'none' | 'start' | 'middle' | 'end'>('none');
  const chipStripRef = useRef<HTMLDivElement>(null);
  /** Conclude-from-chat — item id with a conclusion being drafted. */
  const [concludingId, setConcludingId] = useState<string | null>(null);
  /** Conclude-from-chat — inline edit of the pending drafted answer. */
  const [threadProposalEdit, setThreadProposalEdit] = useState<{ id: string; text: string } | null>(null);
  /** Conclude-from-chat proposal actions — one in flight per item, per-item error. */
  const [threadActionId, setThreadActionId] = useState<string | null>(null);
  const [threadActionError, setThreadActionError] = useState<Record<string, string>>({});
  /**
   * Snapshot of just-applied items so the 8s "Resolved ✓" dwell keeps rendering
   * after the item leaves the open pool (the open-only poll carries it away).
   */
  const [recentlyResolved, setRecentlyResolved] = useState<Record<string, { item: PortalItem; until: number }>>({});

  const dwellTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dwellHandledRef = useRef<Set<string>>(new Set());
  const itemsByIdRef = useRef<Map<string, PortalItem>>(new Map());
  /** Panel root — the chat composer's textarea is found inside it (focus + caret). */
  const panelRef = useRef<HTMLDivElement>(null);
  const parkedActionRef = useRef<HTMLButtonElement>(null);
  const returnDocRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const prevSurfaceRef = useRef(surface);
  const surfaceRef = useRef(surface);
  const activeIdRef = useRef(activeId);
  const draftsRef = useRef(drafts);
  const onCloseRef = useRef(onClose);
  const onFocusDocumentRef = useRef(onFocusDocument);
  const onActiveItemChangeRef = useRef(onActiveItemChange);
  const recordingRef = useRef(false);
  const proposalEditRef = useRef(proposalEdit);
  const threadProposalEditRef = useRef(threadProposalEdit);
  /** Pending caret-restore timer from the latest voice append (design §2). */
  const caretTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Element that held focus when the latest voice append landed. */
  const focusAtAppendRef = useRef<Element | null>(null);
  const consumedFocusRef = useRef<{ token: number } | null>(null);

  // Sync refs for the single window-level Escape listener so it never needs to
  // re-register when surface/draft/active-id change.
  useEffect(() => { surfaceRef.current = surface; }, [surface]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { onFocusDocumentRef.current = onFocusDocument; }, [onFocusDocument]);
  useEffect(() => { onActiveItemChangeRef.current = onActiveItemChange; }, [onActiveItemChange]);
  useEffect(() => { proposalEditRef.current = proposalEdit; }, [proposalEdit]);
  useEffect(() => { threadProposalEditRef.current = threadProposalEdit; }, [threadProposalEdit]);

  // §3c.4 — the chips strip is one 45 px horizontal scroller. One `chipEdge`
  // value drives both the edge fade and the chevron buttons, so a side with no
  // hidden content never shows a fade or a control.
  const measureChipStrip = useCallback((): void => {
    const el = chipStripRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) {
      setChipEdge('none');
      return;
    }
    const left = el.scrollLeft || 0;
    const atStart = left <= 2;
    const atEnd = left + el.clientWidth >= el.scrollWidth - 2;
    setChipEdge(atStart ? 'start' : atEnd ? 'end' : 'middle');
  }, []);

  useEffect(() => {
    measureChipStrip();
    const el = chipStripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureChipStrip);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureChipStrip, items.length]);

  // §3c.4 — the active chip is always reachable: move the strip by the minimum
  // distance and never scroll the page or the pane (`block:'nearest'`).
  useEffect(() => {
    const chip = chipStripRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    chip?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  /** Chevron click: one page-ish nudge along the strip (§3c.4). */
  const nudgeChips = useCallback((direction: -1 | 1): void => {
    const el = chipStripRef.current;
    if (!el) return;
    const delta = direction * Math.max(120, Math.round(el.clientWidth * 0.8));
    if (typeof el.scrollBy === 'function') el.scrollBy({ left: delta, behavior: 'smooth' });
    else el.scrollLeft += delta;
  }, []);

  /** The single per-question textarea, owned by QuestionChat's composer. */
  const composerEl = useCallback(
    (): HTMLTextAreaElement | null =>
      panelRef.current?.querySelector<HTMLTextAreaElement>('textarea.qchat-textarea') ?? null,
    []
  );

  // §2b.4 R1 — the mode is advisory on mount, on panel reopen, on every
  // question switch and after every send. Keeping only non-advisory entries
  // makes the reset a delete and keeps the mode out of storage (R2).
  useEffect(() => {
    setModes(prev => (Object.keys(prev).length === 0 ? prev : {}));
  }, [activeId, surface]);

  /** R1/R3 — return one item's composer to advisory. */
  const resetMode = useCallback((id: string): void => {
    setModes(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Last-known item map. The snapshot effect needs the item even in the frame
  // where the poll drops it in the same batch as the applied state arrives.
  useEffect(() => {
    const next = new Map(itemsByIdRef.current);
    for (const item of items) next.set(item.id, item);
    itemsByIdRef.current = next;
  }, [items]);

  // Close = reset: the panel stays mounted but the spec resets selection,
  // expander, and the dwell snapshot when it returns to the document (close vs
  // minimize, §8.2). Board #53A — composer drafts are NOT wiped on close; they
  // live in the module draft store (survives unmount and reload) and are
  // cleared only on successful submit.
  useEffect(() => {
    if (surface !== 'closed') return;
    setActiveId(items[0]?.id ?? '');
    setSubmitError(null);
    setRecentlyResolved({});
    setRetryText({});
  }, [surface, items]);

  // §1.6.3 — "Resolved ✓" dwell keyed off the paid answer state: one snapshot
  // per applied item, released by an 8s timer. Applied also releases the retry
  // text (nothing left to replay).
  useEffect(() => {
    if (surface !== 'open') return;
    const current = answerStates;
    for (const id of Array.from(dwellHandledRef.current)) {
      if (current[id]?.phase !== 'applied') dwellHandledRef.current.delete(id);
    }
    for (const [id, st] of Object.entries(current)) {
      if (st.phase !== 'applied' || dwellHandledRef.current.has(id)) continue;
      const item = itemsByIdRef.current.get(id);
      if (!item) continue;
      dwellHandledRef.current.add(id);
      setRetryText(prev => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setRecentlyResolved(prev => {
        if (prev[id]) return prev;
        return { ...prev, [id]: { item, until: Date.now() + DWELL_MS } };
      });
      const timer = setTimeout(() => {
        dwellTimersRef.current = dwellTimersRef.current.filter(t => t !== timer);
        setRecentlyResolved(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, DWELL_MS);
      dwellTimersRef.current.push(timer);
    }
  }, [answerStates, items, surface]);

  // End any in-flight dwell timers on unmount (project-switch remount safety).
  useEffect(() => {
    const timers = dwellTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      if (caretTimerRef.current) clearTimeout(caretTimerRef.current);
    };
  }, []);

  // Advance-on-vanish (D6): the active item left the open pool on its own —
  // select the successor in list order, or the predecessor when it was last
  // (spec: "wrapping to the previous if it was last"). Vanished drafts stay
  // in the map so they return if the item reappears.
  const prevItemsRef = useRef<string[]>([]);
  useEffect(() => {
    if (items.length === 0) {
      prevItemsRef.current = [];
      return;
    }
    const ids = items.map(i => i.id);
    if (!ids.includes(activeId)) {
      const prevIds = prevItemsRef.current;
      const vanished = prevIds.find(id => !ids.includes(id)) ?? activeId;
      const idx = prevIds.indexOf(vanished);
      const candidate =
        idx >= 0 && idx < prevIds.length - 1 ? prevIds[idx + 1] : idx > 0 ? prevIds[idx - 1] : undefined;
      setActiveId(candidate && ids.includes(candidate) ? candidate : items[0].id);
    }
    prevItemsRef.current = ids;
  }, [items, activeId]);

  // §3b.3.3 state lift: one emission per active-item change (no new state) so
  // the parent can point the right pane at the question on screen. The id
  // guard keeps a poll-driven new `items` array from re-emitting.
  const emittedActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (emittedActiveIdRef.current === activeId) return;
    emittedActiveIdRef.current = activeId;
    onActiveItemChangeRef.current?.(items.find(i => i.id === activeId) ?? null);
  }, [activeId, items]);

  // Focus integrity (§8.8): open → composer (question) or first action button
  // (parked); minimize → Expand. Close → the parent's badge gets focus.
  // Workstream C: opening onto an item also emits onFocusDocument so the parent
  // scrolls + highlights the doc (§5.C trigger b). A pending deep-link
  // focusRequest owns that emission instead (its adoption effect below runs in
  // the same commit), so the doc navigates to the requested item exactly once.
  useEffect(() => {
    const prev = prevSurfaceRef.current;
    prevSurfaceRef.current = surface;
    if (surface === 'open' && prev !== 'open') {
      const item = items.find(i => i.id === activeId) ?? items[0];
      if (!item) return;
      if (item.type === 'parked') {
        parkedActionRef.current?.focus();
      } else {
        composerEl()?.focus();
      }
      if (!focusRequest) onFocusDocumentRef.current?.(item);
    } else if (surface === 'minimized' && prev !== 'minimized') {
      expandRef.current?.focus();
    }
  }, [surface, items, activeId, focusRequest]);

  // Parent-driven deep-link focus (§5.E): adopt the requested item once per
  // token, focus per the existing open behavior, and emit onFocusDocument so
  // the parent runs the doc navigation/highlight exactly once.
  useEffect(() => {
    if (!focusRequest) return;
    if (consumedFocusRef.current?.token === focusRequest.token) return;
    const item = items.find(i => i.id === focusRequest.id);
    if (!item) return;
    consumedFocusRef.current = { token: focusRequest.token };
    setActiveId(item.id);
    if (item.type === 'parked') {
      parkedActionRef.current?.focus();
    } else {
      composerEl()?.focus();
    }
    onFocusDocumentRef.current?.(item);
  }, [focusRequest, items, composerEl]);

  const showEmptyState =
    surface === 'open' && items.length === 0 && Object.keys(recentlyResolved).length === 0;
  useEffect(() => {
    if (showEmptyState) returnDocRef.current?.focus();
  }, [showEmptyState]);

  // Voice input (§2): same treatment as the doc composer — a mic button plus
  // Alt-hold-to-talk; transcribed text appends into the active answer draft.
  const { recording, startRecording, stopRecording, error: voiceError } = useVoiceRecorder();
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  /**
   * Voice is live only while the panel is open on an answerable item
   * (not parked, not queued/applying, not in the resolved dwell).
   * DevelopmentView suppresses its own Alt listener while this panel is open,
   * so exactly one window-level owner exists.
   */
  const voiceItemId = surface === 'open' ? activeId : null;
  const voiceItem = voiceItemId !== null ? items.find(i => i.id === voiceItemId) ?? null : null;
  const voicePhase = voiceItem ? answerStates[voiceItem.id]?.phase : undefined;
  const voiceActive =
    voiceItem !== null &&
    voiceItem.type !== 'parked' &&
    voiceItem.status === 'open' &&
    voicePhase !== 'queued' &&
    voicePhase !== 'applying' &&
    voicePhase !== 'applied' &&
    recentlyResolved[voiceItem.id] === undefined;

  const appendVoiceText = useCallback((id: string, text: string) => {
    const combined = (draftsRef.current[id] ?? '') + text;
    writeDraft(id, combined);
    setDrafts(prev => ({ ...prev, [id]: combined }));
    // Caret retention (design §2): a transcript append must leave the caret at
    // the end of the appended text and the composer focused, so the user can
    // keep dictating or press Enter immediately. The mic button (or whatever
    // held focus) steals focus on click, so restore once per append — deferred
    // one task so a user who already moved focus elsewhere (before the timer
    // fires) is not yanked back.
    focusAtAppendRef.current = document.activeElement;
    if (caretTimerRef.current) clearTimeout(caretTimerRef.current);
    caretTimerRef.current = setTimeout(() => {
      caretTimerRef.current = null;
      const ta = composerEl();
      const stolen = document.activeElement !== focusAtAppendRef.current;
      focusAtAppendRef.current = null;
      if (!ta || stolen) return;
      const end = ta.value.length;
      ta.focus();
      ta.setSelectionRange(end, end);
    }, 0);
  }, [composerEl]);

  // Alt-hold-to-record key listener (same shape as the doc composer's).
  useEffect(() => {
    if (!voiceActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // e.ctrlKey bails for AltGr layouts, which synthesize Ctrl+Alt.
      if (e.key === 'Alt' && !e.repeat && !e.ctrlKey) {
        startRecording();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && !e.ctrlKey) {
        void stopRecording().then(text => {
          const id = activeIdRef.current;
          if (text && id) appendVoiceText(id, text);
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      // Leaving the answerable state (panel closed or minimized, item parked/
      // queued/applied) must not orphan a hot MediaRecorder: stop it and flush
      // the transcript into the item's draft. Board #53A — the append lands as
      // a microtask and goes through the same draft store, so it survives a
      // close that happens before the transcript resolves.
      if (recordingRef.current) {
        const id = activeIdRef.current;
        void stopRecording().then(text => {
          if (text && id) appendVoiceText(id, text);
        });
      }
    };
  }, [voiceActive, startRecording, stopRecording, appendVoiceText]);

  // Escape has exactly one window-level owner (spec §8.8): a non-empty draft
  // clears first, a second Escape closes; an empty composer (or a parked item,
  // which never has a draft) closes directly.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (surfaceRef.current !== 'open') return;
      const id = activeIdRef.current;
      // Order (design §5): 1) cancel an open proposal edit → 2) clear a
      // non-empty draft (which also returns the composer to advisory, R3) →
      // 3) close the panel.
      if (threadProposalEditRef.current?.id === id) {
        setThreadProposalEdit(null);
        return;
      }
      if (proposalEditRef.current?.id === id) {
        setProposalEdit(null);
        return;
      }
      const draft = draftsRef.current[id]?.trim() ?? '';
      if (draft.length > 0) {
        dropDraft(id);
        setDrafts(prev => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setModes(prev => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubmitError(null);
        return;
      }
      onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = async (id: string, text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const phase = answerStates[id]?.phase;
    if (phase === 'queued' || phase === 'applying') return;
    setRetryText(prev => ({ ...prev, [id]: trimmed }));
    setSubmitError(null);
    setSubmittingId(id);
    try {
      await onSubmit(id, trimmed);
      // Board #53A — the draft is wiped only on a successful submit; a failure
      // keeps the text in the composer (retryText still replays it).
      dropDraft(id);
      setDrafts(prev => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't send your answer.");
    } finally {
      // Only clear the in-flight flag if it still refers to this answer; a
      // newer submit may have claimed it in the meantime.
      setSubmittingId(prev => (prev === id ? null : prev));
    }
  };

  /** Failed answers replay the last submitted text; otherwise focus the composer. */
  const retry = (id: string) => {
    const text = retryText[id];
    if (text) {
      void handleSubmit(id, text);
    } else {
      composerEl()?.focus();
    }
  };

  /** Shared proposal/undo action wrapper: per-item in-flight flag + error catch. */
  const runGateAction = async (id: string, action: () => Promise<void>): Promise<void> => {
    setGateActionId(id);
    setGateActionError(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await action();
      setProposalEdit(prev => (prev?.id === id ? null : prev));
    } catch (err) {
      setGateActionError(prev => ({ ...prev, [id]: err instanceof Error ? err.message : 'Action failed.' }));
    } finally {
      setGateActionId(prev => (prev === id ? null : prev));
    }
  };
  const confirmProposal = (id: string, editedText?: string): Promise<void> =>
    runGateAction(id, () => (onConfirmProposal ? onConfirmProposal(id, editedText) : Promise.resolve()));
  const rejectProposal = (id: string): Promise<void> =>
    runGateAction(id, () => (onRejectProposal ? onRejectProposal(id) : Promise.resolve()));
  const undoAuto = (id: string): Promise<void> =>
    runGateAction(id, () => (onUndoAuto ? onUndoAuto(id) : Promise.resolve()));

  /** Research-all backfill kickoff: single in-flight run, parent owns the data refresh. */
  const researchAll = async (): Promise<void> => {
    if (!onResearchAll || researchAllBusy) return;
    setResearchAllBusy(true);
    setResearchAllError(null);
    try {
      await onResearchAll();
    } catch (err) {
      setResearchAllError(err instanceof Error ? err.message : "Couldn't start research.");
    } finally {
      setResearchAllBusy(false);
    }
  };

  /** The ASK action: one advisory question per item; the reply lands via the poll. */
  const handleThreadSubmit = async (id: string, text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || !onThreadMessage) return;
    if (threadBusyId !== null) return;
    resetMode(id);
    setThreadErrors(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setThreadBusyId(id);
    try {
      await onThreadMessage(id, trimmed);
      // Success clears the one per-item draft (the persisted mirror too); a
      // failure keeps it so the log's Retry can replay it (S6).
      dropDraft(id);
      setDrafts(prev => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setThreadErrors(prev => ({ ...prev, [id]: err instanceof Error ? err.message : "Couldn't get a reply." }));
    } finally {
      setThreadBusyId(prev => (prev === id ? null : prev));
    }
  };

  /** The ANSWER action: same submit path as before, then back to advisory (R1). */
  const handleAnswer = async (id: string, text: string): Promise<void> => {
    resetMode(id);
    await handleSubmit(id, text);
  };

  /** Conclude-from-chat: the server drafts the answer and appends a proposal row. */
  const handleConclude = async (id: string): Promise<void> => {
    if (!onConcludeThread || concludingId !== null) return;
    setThreadErrors(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setConcludingId(id);
    try {
      await onConcludeThread(id);
    } catch (err) {
      setThreadErrors(prev => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Couldn't conclude — try again."
      }));
    } finally {
      setConcludingId(prev => (prev === id ? null : prev));
    }
  };

  /** Concluded-proposal actions: per-item in-flight flag + error catch. */
  const runThreadAction = async (id: string, action: () => Promise<void>): Promise<void> => {
    setThreadActionId(id);
    setThreadActionError(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await action();
      setThreadProposalEdit(prev => (prev?.id === id ? null : prev));
    } catch (err) {
      setThreadActionError(prev => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Action failed.'
      }));
    } finally {
      setThreadActionId(prev => (prev === id ? null : prev));
    }
  };
  const confirmThreadProposal = (id: string, proposalTs: number, editedText?: string): Promise<void> =>
    runThreadAction(id, () =>
      onConfirmThreadProposal
        ? onConfirmThreadProposal(id, proposalTs, editedText)
        : Promise.resolve()
    );
  const rejectThreadProposal = (id: string, proposalTs: number): Promise<void> =>
    runThreadAction(id, () =>
      onRejectThreadProposal ? onRejectThreadProposal(id, proposalTs) : Promise.resolve()
    );

  const renderStateChip = (id: string): ReactNode => {
    const st = answerStates[id];
    if (!st) return null;
    const chip = stateChip[st.phase];
    return (
      <>
        <span className={`inline-flex min-h-[24px] items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${chip.cls}`}>
          <chip.icon className={`h-3 w-3 ${chip.live ? 'animate-spin' : ''}`} aria-hidden />
          {chip.label}
        </span>
        {st.phase === 'failed' && (
          <button
            type="button"
            onClick={() => retry(id)}
            className="inline-flex min-h-[24px] items-center gap-1 rounded-full border border-rose-600/60 bg-rose-950/60 px-2 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-900/70 focus:ring-2 focus:ring-rose-500/40"
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> Retry
          </button>
        )}
      </>
    );
  };

  if (surface === 'closed') return null;

  // §8.2 — minimized dock strip. Absolute within the parent's relative content
  // wrapper (never fixed to the window); the panel tree stays mounted so all
  // drafts and selection are preserved behind the doc.
  if (surface === 'minimized') {
    const stripItem = items.find(i => i.id === activeId) ?? null;
    return (
      <div
        className="absolute inset-x-0 bottom-0 z-30 flex h-[44px] items-center gap-2 border-t border-[#2a3342] bg-[#0d1017]/95 px-3"
        role="region"
        aria-label="Questions from AI"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
        <span className="shrink-0 text-[11px] font-medium text-amber-300">
          Questions from AI ({items.length})
        </span>
        {stripItem && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-[#a8b3c4]">{cleanQuestionTitle(stripItem.title)}</span>
        )}
        <button
          ref={expandRef}
          type="button"
          onClick={onExpand}
          aria-label="Expand questions"
          title="Expand questions"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
        >
          <Maximize2 className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close questions"
          title="Close questions and return to document"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  // surface === 'open' — the full overlay. When every item has just been
  // applied, the open-only poll has dropped them: show the newest dwell
  // snapshot so the "Resolved ✓" state stays visible until it expires.
  const fallbackItem = items.length > 0 ? items[0] : latestResolvedItem(recentlyResolved);
  const item =
    items.find(i => i.id === activeId) ?? recentlyResolved[activeId]?.item ?? fallbackItem ?? null;

  let body: ReactNode = null;
  /**
   * Recorded/resolved banner, answer state chip and the research proposal —
   * the conversation's `banner` slot (§3b.3.7). Rendered by QuestionChat when
   * there is a conversation, otherwise straight below the chips.
   */
  let banner: ReactNode = null;
  /** The one per-question conversation region (replaces the two old boxes). */
  let conversation: ReactNode = null;

  if (!item) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#8b5cf6]/60 bg-[#2e1065]/40">
          <CheckCircle2 className="h-8 w-8 text-[#e8edf5]" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-medium text-[#e8edf5]">All questions resolved</p>
          <p className="mt-1 text-xs text-[#6e7d92]">No pending questions from the current run.</p>
        </div>
        <button
          ref={returnDocRef}
          type="button"
          onClick={onClose}
          className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#3b4658] bg-[#0d1017] px-3 text-xs font-medium text-[#a8b3c4] transition hover:bg-[#11151d] focus:ring-2 focus:ring-[#ff2a3c]/60"
        >
          Return to document
        </button>
      </div>
    );
  } else {
    const isParked = item.type === 'parked';
    const dwellActive =
      answerStates[item.id]?.phase === 'applied' || recentlyResolved[item.id] !== undefined;
    // Research gate states: auto-applied (answered + snapshot) / proposed / researching.
    const auto = item.status === 'answered' ? item.meta?.autoApplied : undefined;
    const autoAppliedActive = auto !== undefined;
    const proposal = item.status === 'open' ? item.meta?.proposedAnswer : undefined;
    const researching = item.status === 'open' && item.meta?.researching === true;
    // Answer-thread state (§4.5–§4.7): one log, one draft, one mode per item.
    const thread = item.meta?.thread ?? [];
    const pendingProposalRow = [...thread]
      .reverse()
      .find(m => m.kind === 'proposal' && m.proposal?.status === 'pending');
    const pendingProposal = pendingProposalRow?.proposal ?? null;
    const specialistReplied = thread.some(m => m.role === 'specialist');
    const threadBusy = threadBusyId === item.id;
    const answerBusy = submittingId === item.id;
    const canConclude =
      onConcludeThread !== undefined &&
      item.type === 'question' &&
      item.status === 'open' &&
      specialistReplied &&
      pendingProposal === null &&
      threadBusyId === null;
    const answerPhase = answerStates[item.id]?.phase;
    const recordedState =
      answerPhase !== undefined
        ? { label: stateChip[answerPhase].label, tone: answerPhase }
        : undefined;

    // Parked items have no conversation, no context header and no Details view
    // (§3b.3.6): the critic's gaps and the two manual actions stay in the left
    // pane. Everything memo-shaped (sections, sources, original detail, answer
    // history) lives in the right pane now.
    if (isParked) {
      body = (
        <div className="rounded-lg border-l-2 border-l-rose-500 bg-rose-950/20 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <TriangleAlert className="h-4 w-4 shrink-0 text-rose-400" aria-hidden />
              <span className="text-xs font-bold text-rose-200">Critic blocked</span>
              {item.docPath && (
                <span className="max-w-[120px] truncate text-[11px] font-mono text-[#6e7d92]">
                  {item.docPath.split('/').pop()}
                </span>
              )}
            </div>
            {items.some(i => i.id === item.id) && (
              <button
                type="button"
                onClick={() => {
                  // Local-first: the parent drops the id from its dismissed set
                  // before the server call, so a server error can't resurrect it.
                  void onDismiss(item.id).catch(() => {});
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#6e7d92] transition hover:text-[#a8b3c4] focus:ring-2 focus:ring-[#ff2a3c]/60"
                aria-label="Dismiss"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>

          <p className="mt-1.5 text-sm font-bold text-[#e8edf5]" title={cleanQuestionTitle(item.title)}>
            {cleanQuestionTitle(item.title)}
          </p>

          {item.gaps && item.gaps.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[11px] font-semibold text-rose-300">Missing requirements:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {item.gaps.slice(0, 8).map((gap, i) => (
                  <li key={i} className="text-[11px] text-rose-200/70">
                    {gap}
                  </li>
                ))}
                {item.gaps.length > 8 && (
                  <li className="text-[11px] text-rose-200/50">+{item.gaps.length - 8} more gaps</li>
                )}
              </ul>
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              ref={parkedActionRef}
              type="button"
              onClick={() => {
                if (item.docPath) void onResume(item.docPath);
              }}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-rose-700 bg-rose-950/60 px-3 text-xs font-medium text-rose-200 transition hover:bg-rose-900/60 focus:ring-2 focus:ring-[#ff2a3c]/60"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Resolve & Resume
            </button>
            <button
              type="button"
              onClick={() => {
                if (item.docPath) onEditDoc(item.docPath);
              }}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#3b4658] bg-[#0d1017] px-3 text-xs font-medium text-[#a8b3c4] transition hover:bg-[#11151d] focus:ring-2 focus:ring-[#ff2a3c]/60"
            >
              Edit Manually
            </button>
          </div>
        </div>
      );
    }

    // Recorded / resolved banner (unchanged behaviour) + the research proposal
    // card. Both ride the conversation's `banner` slot (§3b.3.7).
    const statusBanner = isParked
      ? null
      : autoAppliedActive && auto ? (
          <div
            role="status"
            className="rounded-lg border border-[#8b5cf6]/60 bg-[#2e1065]/40 px-3 py-2.5 text-sm font-medium text-[#e8edf5]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Check className="h-4 w-4" aria-hidden />
              <span>
                Auto-applied from research ({Math.round(auto.confidence * 100)}% confidence) — pending incorporation
              </span>
              {!auto.incorporated && (
                <button
                  type="button"
                  onClick={() => undoAuto(item.id)}
                  disabled={gateActionId === item.id}
                  aria-label="Undo auto-applied answer"
                  className="min-h-[32px] rounded-lg border border-[#3b4658] bg-[#0d1017] px-2.5 text-[11px] font-semibold text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60 disabled:opacity-40"
                >
                  Undo
                </button>
              )}
            </div>
            {gateActionError[item.id] && (
              <p role="alert" className="mt-1 rounded-md border border-rose-800/60 bg-rose-950/40 px-2.5 py-1 text-xs text-rose-300">
                {gateActionError[item.id]}
              </p>
            )}
          </div>
        ) : dwellActive ? (
          <div
            role="status"
            className="flex min-h-[96px] items-center gap-2 rounded-lg border border-[#8b5cf6]/60 bg-[#2e1065]/40 px-3 py-2.5 text-sm font-medium text-[#e8edf5]"
          >
            <Check className="h-4 w-4" aria-hidden /> Resolved ✓
          </div>
        ) : voiceError ? (
          <p role="status" aria-live="polite" className="rounded-md bg-rose-950/40 px-3 py-1.5 text-xs text-rose-300">
            {voiceError}
          </p>
        ) : null;

    const researchProposalCard = proposal ? (
      <ProposalCard
        variant="research"
        title={`Research proposal — ${Math.round(proposal.confidence * 100)}% confidence`}
        text={proposal.answer}
        sources={proposal.sources}
        rationale={proposal.rationale}
        editing={proposalEdit?.id === item.id}
        busy={gateActionId === item.id}
        error={gateActionError[item.id]}
        onUse={() => {
          void confirmProposal(item.id);
        }}
        onEdit={() => setProposalEdit({ id: item.id, text: proposal.answer })}
        onReject={() => {
          void rejectProposal(item.id);
        }}
        onSaveEdit={text => {
          void confirmProposal(item.id, text);
        }}
        onCancelEdit={() => setProposalEdit(null)}
      />
    ) : null;

    // Answer state chip (§3b.3.6 — stays left): the last row of the banner.
    const stateChipRow = answerStates[item.id] ? (
      <div className="flex flex-wrap items-center gap-2">{renderStateChip(item.id)}</div>
    ) : null;

    if (researching || statusBanner || stateChipRow || researchProposalCard) {
      banner = (
        <div className="space-y-2 border-t border-[#2a3342] bg-[#0d1017]/70 p-3">
          {researching && (
            <span className="inline-flex min-h-[24px] items-center gap-1.5 rounded-full border border-violet-700/50 bg-violet-950/40 px-2.5 py-0.5 text-[11px] font-medium text-violet-300">
              <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden /> Researching…
            </span>
          )}
          {statusBanner}
          {stateChipRow}
          {researchProposalCard}
        </div>
      );
    }

    // §4.1/§4.7 — ONE conversation region per question replaces the old
    // answer composer + advisory chat boxes. `key={item.id}` siloes the log,
    // the expansion flag, the draft and the mode; no text crosses items.
    // Open questions always get the conversation (the Answer verb must exist
    // even when the parent wired no Ask handler — S11 legacy path).
    conversation =
      item.type === 'question' &&
      item.status === 'open' &&
      !dwellActive &&
      !autoAppliedActive ? (
        <QuestionChat
          key={item.id}
          className="flex-1 min-h-0"
          banner={banner ?? undefined}
          id={item.id}
          title={item.title}
          messages={thread}
          busy={threadBusy || answerBusy || threadActionId === item.id}
          busyKind={threadBusy ? 'ask' : undefined}
          threadError={threadErrors[item.id]}
          onRetryThread={() => {
            void handleThreadSubmit(item.id, drafts[item.id] ?? '');
          }}
          canConclude={canConclude}
          concluding={concludingId === item.id}
          onConclude={() => {
            void handleConclude(item.id);
          }}
          proposal={pendingProposal}
          editingProposal={threadProposalEdit?.id === item.id}
          proposalError={threadActionError[item.id]}
          onUseProposal={() => {
            if (pendingProposalRow) void confirmThreadProposal(item.id, pendingProposalRow.ts);
          }}
          onEditProposal={() => {
            if (pendingProposal) setThreadProposalEdit({ id: item.id, text: pendingProposal.text });
          }}
          onRejectProposal={() => {
            if (pendingProposalRow) void rejectThreadProposal(item.id, pendingProposalRow.ts);
          }}
          onSaveProposalEdit={text => {
            if (pendingProposalRow) void confirmThreadProposal(item.id, pendingProposalRow.ts, text);
          }}
          onCancelProposalEdit={() => setThreadProposalEdit(null)}
          recordedState={recordedState}
          mode={modes[item.id] ?? 'advisory'}
          onModeChange={mode => setModes(prev => ({ ...prev, [item.id]: mode }))}
          draft={drafts[item.id] ?? ''}
          onDraftChange={text => {
            writeDraft(item.id, text);
            setDrafts(prev => ({ ...prev, [item.id]: text }));
          }}
          onAsk={() => {
            void handleThreadSubmit(item.id, drafts[item.id] ?? '');
          }}
          onAnswer={() => {
            void handleAnswer(item.id, drafts[item.id] ?? '');
          }}
          locked={
            answerPhase === 'queued' || answerPhase === 'applying'
              ? { kind: 'queued', text: 'Answer recorded — applies after this phase' }
              : undefined
          }
          recording={recording}
          onMicDown={startRecording}
          onMicUp={() => {
            void stopRecording().then(text => {
              if (text) appendVoiceText(item.id, text);
            });
          }}
          answerError={submitError ?? undefined}
          placeholder={
            thread.length > 0
              ? 'Reply, or write your answer — the agent reads this conversation'
              : 'Ask the specialist, or write your answer…'
          }
        />
      ) : null;
  }

  const activeIndex = items.findIndex(i => i.id === activeId);
  const pagerIndex = activeIndex >= 0 ? activeIndex + 1 : 1;

  return (
    <div
      ref={panelRef}
      id="question-panel"
      role="region"
      aria-label="Questions from AI"
      className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-[#05070c] animate-panel-in"
    >
      <header className="@container shrink-0 border-b border-[#2a3342] bg-[#0d1017]/90 px-3 py-2">
        {/* §3b.6(iii) — one 60 px row at 900 px: no wrap; the Research button
            drops to its icon under a 560 px container. */}
        <div className="flex flex-nowrap items-center gap-x-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          <span className="text-sm font-bold text-[#e8edf5]">Questions from AI</span>
          <span className="rounded-full bg-[#11151d] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[#ffb3bd]">
            {items.length}
          </span>
          {/* The doc chip and the "N of M" pager moved into the context header
              (§3b.4) so this row stays a single 60 px line at 900 px. */}
          {item?.section && (
            <span className="max-w-[140px] shrink-0 truncate rounded bg-[#11151d] px-1.5 py-0.5 text-[10px] font-medium text-[#a8b3c4]">
              asked while {item.section}
            </span>
          )}
          {item?.severity === 'blocking' && (
            <span className="rounded border border-rose-700 bg-rose-950/60 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
              BLOCKING
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onResearchAll && items.some(i => i.type === 'question') && (
              <>
                {researchAllError && (
                  <p role="alert" className="max-w-[180px] truncate text-[11px] text-rose-300" title={researchAllError}>
                    {researchAllError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => { void researchAll(); }}
                  disabled={researchAllBusy}
                  aria-label="Research open questions"
                  title="Research open questions"
                  className="flex min-h-[32px] items-center gap-1.5 rounded-lg border border-[#8b5cf6]/60 bg-[#2e1065]/40 px-2.5 text-[11px] font-semibold text-violet-200 transition hover:bg-[#3b1d7a]/50 focus:ring-2 focus:ring-[#ff2a3c]/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Loader2 className={`h-3.5 w-3.5 ${researchAllBusy ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
                  <span className="@max-[560px]:hidden">Research open questions</span>
                </button>
              </>
            )}
            {item?.docPath &&
              onOpenDocument &&
              item.docPath.split('/').pop() !== selectedDocName && (
              <button
                type="button"
                onClick={() => {
                  const p = item?.docPath;
                  if (p) onOpenDocument(p);
                }}
                className="cursor-pointer rounded px-1.5 py-1 text-xs text-violet-400 transition hover:text-violet-300 focus:ring-2 focus:ring-[#ff2a3c]/60"
              >
                Open document
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close questions"
              title="Close questions and return to document"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[#a8b3c4] transition hover:bg-[#11151d] hover:text-[#e8edf5] focus:ring-2 focus:ring-[#ff2a3c]/60"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {items.length >= 2 && (
        /* §3c.4 — one 45 px horizontal scroller: 1 px border + py-1.5 (6+6) +
           h-8 chips. The strip is the only horizontal scroller; the fade and
           the chevrons appear only on a side that actually hides content. */
        <div className="chips-wrap shrink-0" data-edge={chipEdge}>
          <div
            ref={chipStripRef}
            role="group"
            aria-label="Open questions"
            tabIndex={0}
            onScroll={measureChipStrip}
            className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
          {/* P5 — ICD-system topic grouping (portalGrouping lib): text headers
              with counts; no color-only distinction, no emoji. Unknown or
              missing meta.topic lands in the "Other" section. */}
          {groupPortalItemsByTopic(items).map(group => (
            <div key={group.topic} className="flex shrink-0 items-center gap-1.5">
              <div
                role="heading"
                aria-level={3}
                className="shrink-0 whitespace-nowrap px-1 text-[10px] font-semibold uppercase tracking-wide text-[#6e7d92]"
              >
                {group.label} ({group.items.length})
              </div>
              {group.items.map(navItem => {
            const isActive = navItem.id === activeId;
            // §3 — lifecycle dot: rose for parked/blocking, sky while an answer
            // is queued/applying for that item, amber for plain pending. The
            // chip text always carries the title, so color is never the only
            // signal.
            const queuedPhase = answerStates[navItem.id]?.phase;
            let dotClass = 'bg-amber-400';
            if (navItem.type === 'parked' || navItem.severity === 'blocking') {
              dotClass = 'bg-rose-400';
            } else if (queuedPhase === 'queued' || queuedPhase === 'applying') {
              dotClass = 'bg-violet-400';
            }
            // §4.6 — trailing conversation pill: count = user + specialist +
            // recorded rows (proposal rows are drafts, not messages). A
            // pending proposal swaps the icon to ListChecks (shape + hue).
            const chipThread = navItem.meta?.thread ?? [];
            const chipCount = chipThread.filter(m => m.kind !== 'proposal').length;
            const chipProposal = chipThread.some(
              m => m.kind === 'proposal' && m.proposal?.status === 'pending'
            );
            const ChipIcon = chipProposal ? ListChecks : MessageSquare;
            return (
              <button
                key={navItem.id}
                type="button"
                onClick={() => {
                  setActiveId(navItem.id);
                  onFocusDocument?.(navItem);
                }}
                aria-current={isActive ? 'true' : undefined}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'border-violet-800/60 bg-violet-950/70 text-violet-200'
                    : 'border-[#2a3342] bg-[#0d1017] text-[#a8b3c4] hover:bg-[#11151d] hover:text-[#e8edf5]'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
                <span className={chipCount > 0 ? 'max-w-[112px] truncate' : 'max-w-[140px] truncate'}>
                  {cleanQuestionTitle(navItem.title)}
                </span>
                {chipCount > 0 && (
                  <>
                    <span className={`qchat-chip ${chipProposal ? 'is-proposal' : ''}`} aria-hidden>
                      <ChipIcon className="h-[10px] w-[10px]" aria-hidden />
                      {chipCount}
                    </span>
                    <span className="sr-only">
                      {chipCount} messages in conversation
                      {chipProposal ? ', proposed answer waiting' : ''}
                    </span>
                  </>
                )}
              </button>
            );
          })}
            </div>
          ))}
          </div>
          {chipEdge !== 'none' && chipEdge !== 'start' && (
            <button
              type="button"
              aria-label="Scroll questions left"
              onClick={() => nudgeChips(-1)}
              className="chips-next is-left"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          {chipEdge !== 'none' && chipEdge !== 'end' && (
            <button
              type="button"
              aria-label="Scroll questions right"
              onClick={() => nudgeChips(1)}
              className="chips-next is-right"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      {body && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{body}</div>
      )}

      {/* Left pane for a question: chips → context header → conversation
          (§3b.3.1). Parked items have neither header nor conversation. */}
      {item && item.type !== 'parked' && (
        <QuestionContextHeader
          item={item}
          pagerIndex={pagerIndex}
          total={items.length}
          selectedDocName={selectedDocName}
          onOpenDetails={() => {
            if (item) onOpenDetails?.(item);
          }}
        />
      )}

      {conversation}
      {/* No conversation (resolved dwell, auto-applied, parked): the banner
          still renders, just outside a log that does not exist. */}
      {!conversation && banner && <div className="shrink-0">{banner}</div>}
    </div>
  );
}