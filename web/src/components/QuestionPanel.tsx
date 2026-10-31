import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  Maximize2,
  MessageSquare,
  RotateCcw,
  TriangleAlert,
  X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AnswerState, PortalItem } from '../types/api';
import { renderDetail } from '../lib/portalDetail';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
// React Bits (reactbits.dev) component — see web/src/components/reactbits.
import VoicePill from './reactbits/VoicePill/VoicePill';

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
 * index), per-item composer drafts, the show-full expander, retry text, and the
 * minimized dock strip. The parent holds `surface` and `items`; the panel holds
 * everything the 3s poll must not disturb (D6, D8).
 */
export default function QuestionPanel({
  surface,
  items,
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
  focusRequest
}: QuestionPanelProps) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? '');
  // Board #53A — drafts seed from the module store so close/reopen, unmount,
  // and page reload all restore the typed-but-unsubmitted answer.
  const [drafts, setDrafts] = useState<Record<string, string>>({ ...draftStore });
  const [showFull, setShowFull] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<Record<string, string>>({});
  /** Per-item expansion of the follow-up answer-history disclosure (§3 board #52). */
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Item id with a submit in flight — gates the Send button (never Enter). */
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  /**
   * Snapshot of just-applied items so the 8s "Resolved ✓" dwell keeps rendering
   * after the item leaves the open pool (the open-only poll carries it away).
   */
  const [recentlyResolved, setRecentlyResolved] = useState<Record<string, { item: PortalItem; until: number }>>({});

  const dwellTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dwellHandledRef = useRef<Set<string>>(new Set());
  const itemsByIdRef = useRef<Map<string, PortalItem>>(new Map());
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const parkedActionRef = useRef<HTMLButtonElement>(null);
  const returnDocRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const prevSurfaceRef = useRef(surface);
  const surfaceRef = useRef(surface);
  const activeIdRef = useRef(activeId);
  const draftsRef = useRef(drafts);
  const onCloseRef = useRef(onClose);
  const onFocusDocumentRef = useRef(onFocusDocument);
  const recordingRef = useRef(false);
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
    setShowFull(null);
    setSubmitError(null);
    setRecentlyResolved({});
    setRetryText({});
    setShowHistory({});
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
        composerRef.current?.focus();
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
      composerRef.current?.focus();
    }
    onFocusDocumentRef.current?.(item);
  }, [focusRequest, items]);

  const showEmptyState =
    surface === 'open' && items.length === 0 && Object.keys(recentlyResolved).length === 0;
  useEffect(() => {
    if (showEmptyState) returnDocRef.current?.focus();
  }, [showEmptyState]);

  // Voice input (§2): same treatment as the doc composer — a mic button plus
  // Alt-hold-to-talk; transcribed text appends into the active answer draft.
  const { recording, startRecording, stopRecording, error: voiceError } = useVoiceRecorder();
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  // VoicePill (React Bits) is the click affordance for the answer composer.
  // It is self-managed (no controlled listening prop) and never transcribes,
  // so useVoiceRecorder stays the single recorder: the pill's onStart/onStop
  // proxy it, transcripts flow into the item draft exactly as before, and
  // `reactive='simulated'` guarantees no second getUserMedia path. Alt-hold
  // listeners below are unchanged; while a recording is pill-initiated the
  // pill itself is the indicator (live waveform), otherwise the compact
  // text indicator renders for Alt-initiated recordings.
  const pillRecordingRef = useRef(false);
  useEffect(() => {
    if (!recording) pillRecordingRef.current = false;
  }, [recording]);

  // Mic-denial seam: the pill's internal listening state is self-managed, so
  // when the recorder reports an error out-of-band (e.g. getUserMedia denied
  // after onStart), the pill would stay "pressed" with a fake waveform.
  // Bumping a remount key on error forces a fresh idle pill, and the pill is
  // disabled while the error is showing (the next startRecording attempt —
  // e.g. Alt-hold — clears the error and re-enables it).
  const [voiceAttempt, setVoiceAttempt] = useState(0);
  useEffect(() => {
    if (voiceError) setVoiceAttempt(n => n + 1);
  }, [voiceError]);

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
    // keep dictating or press Enter immediately. The pill (or whatever held
    // focus) steals focus on click, so restore once per append — deferred one
    // task so a user who already moved focus elsewhere (before the timer
    // fires) is not yanked back.
    focusAtAppendRef.current = document.activeElement;
    if (caretTimerRef.current) clearTimeout(caretTimerRef.current);
    caretTimerRef.current = setTimeout(() => {
      caretTimerRef.current = null;
      const ta = composerRef.current;
      const stolen = document.activeElement !== focusAtAppendRef.current;
      focusAtAppendRef.current = null;
      if (!ta || stolen) return;
      const end = ta.value.length;
      ta.focus();
      ta.setSelectionRange(end, end);
    }, 0);
  }, []);

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
      const draft = draftsRef.current[id]?.trim() ?? '';
      if (draft.length > 0) {
        dropDraft(id);
        setDrafts(prev => {
          if (!prev[id]) return prev;
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
      setSubmittingId(null);
    }
  };

  /** Failed answers replay the last submitted text; otherwise focus the composer. */
  const retry = (id: string) => {
    const text = retryText[id];
    if (text) {
      void handleSubmit(id, text);
    } else {
      composerRef.current?.focus();
    }
  };

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
          <span className="min-w-0 flex-1 truncate text-[11px] text-[#a8b3c4]">{stripItem.title}</span>
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
  let composer: ReactNode = null;

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

    let cardTone = 'border-l-amber-500 bg-amber-950/10';
    let labelText = 'AI needs input';
    let labelClass = 'text-amber-200';
    let iconClass = 'text-amber-400';
    let LabelIcon = MessageSquare;
    if (isParked) {
      cardTone = 'border-l-rose-500 bg-rose-950/20';
      labelText = 'Critic blocked';
      labelClass = 'text-rose-200';
      iconClass = 'text-rose-400';
      LabelIcon = TriangleAlert;
    } else if (dwellActive) {
      cardTone = 'border-l-[#3b4658] bg-[#0d1017]/70';
      labelText = 'Resolved ✓';
      labelClass = 'text-[#a8b3c4]';
      iconClass = 'text-[#c4b5fd]';
      LabelIcon = Check;
    }

    const detailView = (() => {
      if (!item.detail) return null;
      const r = renderDetail(item.detail);
      const isOpen = showFull === item.id;
      if (r.bullets.length === 0 && !r.wasTruncated && r.overflow === 0) {
        return <p className="text-xs leading-relaxed text-[#a8b3c4]">{item.detail}</p>;
      }
      return (
        <>
          {r.bullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-3.5 text-xs leading-relaxed text-[#a8b3c4]">
              {r.bullets.map((b, i) => (
                <li key={i} className="pl-0.5">
                  {b}
                  {i === r.bullets.length - 1 && r.overflow > 0 ? ` +${r.overflow} more` : ''}
                </li>
              ))}
            </ul>
          )}
          {r.bullets.length === 0 && r.wasTruncated && (
            <p className="line-clamp-2 text-xs leading-relaxed text-[#a8b3c4]">{item.detail}</p>
          )}
          {(r.overflow > 0 || r.wasTruncated) && !isOpen && (
            <button
              type="button"
              onClick={() => setShowFull(prev => (prev === item.id ? null : item.id))}
              className="mt-1 rounded text-[11px] font-medium text-violet-400 hover:text-violet-300 focus:ring-2 focus:ring-[#ff2a3c]/60"
            >
              Show full question
            </button>
          )}
          {isOpen && (
            <p className="mt-1.5 rounded-md border border-[#2a3342] bg-[#05070c]/60 p-2.5 text-xs leading-relaxed text-[#a8b3c4]">
              {item.detail}
            </p>
          )}
        </>
      );
    })();

    body = (
      <div className={`rounded-lg border-l-2 p-3 ${cardTone}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <LabelIcon className={`h-4 w-4 shrink-0 ${iconClass}`} aria-hidden />
            <span className={`text-xs font-bold ${labelClass}`}>{labelText}</span>
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

        <p className="mt-1.5 text-sm font-bold text-[#e8edf5]" title={item.title}>
          {item.title}
        </p>

        {/* §3 board #52 — item returned as a follow-up after an applied answer.
            The chip is a disclosure toggle; expanding lists the prior answers
            (text + date, oldest first) in a scrollable list. */}
        {item.meta?.answerHistory && item.meta.answerHistory.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setShowHistory(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
              aria-expanded={showHistory[item.id] === true}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-amber-500/40 bg-amber-950/40 px-2.5 text-[11px] font-medium text-amber-300 transition hover:bg-amber-900/40 focus:ring-2 focus:ring-amber-500/40"
            >
              <RotateCcw className="h-3 w-3" aria-hidden /> Follow-up
            </button>
            {showHistory[item.id] && (
              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[#2a3342] bg-[#0d1017]/70 p-2">
                {item.meta.answerHistory.map((entry, i) => (
                  <li key={`${entry.at}-${i}`} className="text-[11px] text-[#a8b3c4]">
                    <time dateTime={entry.at} className="text-[#6e7d92]">{entry.at.slice(0, 10)}</time>{' '}
                    <span className="text-[#e8edf5]">{entry.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {detailView && <div className="mt-1.5">{detailView}</div>}

        {isParked && item.gaps && item.gaps.length > 0 && (
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

        {answerStates[item.id] && (
          <div className="mt-2 flex flex-wrap items-center gap-2">{renderStateChip(item.id)}</div>
        )}

        {isParked && (
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
        )}
      </div>
    );

    if (!isParked) {
      const composingDisabled =
        answerStates[item.id]?.phase === 'queued' || answerStates[item.id]?.phase === 'applying';
      composer = (
        <div className="space-y-1.5">
          <label htmlFor="question-panel-composer" className="text-xs font-semibold text-[#a8b3c4]">
            Your answer
          </label>
          {dwellActive ? (
            <div
              role="status"
              className="flex min-h-[96px] items-center gap-2 rounded-lg border border-[#8b5cf6]/60 bg-[#2e1065]/40 px-3 py-2.5 text-sm font-medium text-[#e8edf5]"
            >
              <Check className="h-4 w-4" aria-hidden /> Resolved ✓
            </div>
          ) : (
            <>
              {/* Recording indicator (Alt-initiated only — pill-initiated
                  recordings show the live VoicePill instead) + voice errors */}
              {recording && !pillRecordingRef.current && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-md bg-rose-950/40 px-3 py-1.5 text-xs text-rose-300"
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-rose-500 motion-safe:animate-pulse" aria-hidden />
                  🎤 Recording… (release Alt to send)
                </div>
              )}
              {voiceError && (
                <p role="status" aria-live="polite" className="rounded-md bg-rose-950/40 px-3 py-1.5 text-xs text-rose-300">
                  {voiceError}
                </p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  id="question-panel-composer"
                  ref={composerRef}
                  value={drafts[item.id] ?? ''}
                  onChange={e => {
                    writeDraft(item.id, e.target.value);
                    setDrafts(prev => ({ ...prev, [item.id]: e.target.value }));
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void handleSubmit(item.id, drafts[item.id] ?? '');
                    }
                  }}
                  disabled={composingDisabled}
                  placeholder="Type your answer to the AI…"
                  className="min-h-[96px] min-w-0 flex-1 resize-y rounded-lg border border-[#3b4658] bg-[#05070c] px-3 py-2.5 text-sm text-[#e8edf5] placeholder:text-[#6e7d92] focus:border-[#ff2a3c] focus:outline-none focus:ring-2 focus:ring-[#ff2a3c]/40 disabled:opacity-50"
                />
                {/* VoicePill (React Bits): click toggle for recording — the
                    recorder stays in useVoiceRecorder; 44px hit target via
                    the pill's reach + waveform expansion. */}
                <VoicePill
                  key={`voice-attempt-${voiceAttempt}`}
                  ariaLabel="Record answer"
                  mode="toggle"
                  reactive="simulated"
                  accentColor="#ff2a3c"
                  background="#11151d"
                  disabled={composingDisabled || voiceError !== null}
                  onStart={() => {
                    pillRecordingRef.current = true;
                    if (!recordingRef.current) startRecording();
                  }}
                  onStop={() => {
                    void stopRecording().then(text => {
                      if (text) appendVoiceText(item.id, text);
                    });
                  }}
                />
                {/* Send: same submit path as Enter, far right of the action
                    row. Disabled while the trimmed draft is empty, while that
                    item's submit is in flight, or while composing is gated
                    (queued/applying) — matching the Enter path's guards. */}
                <button
                  type="button"
                  onClick={() => {
                    void handleSubmit(item.id, drafts[item.id] ?? '');
                  }}
                  disabled={
                    composingDisabled ||
                    submittingId === item.id ||
                    !(drafts[item.id] ?? '').trim()
                  }
                  aria-label="Send answer"
                  title="Send answer — or press Enter"
                  className="flex min-h-[44px] shrink-0 items-center gap-1.5 self-end rounded-lg border border-rose-700/40 bg-[#d61f2c] px-3 text-xs font-semibold text-white transition hover:bg-[#e11d3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3c]/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send
                </button>
              </div>
            </>
          )}
          {!dwellActive && (
            <p className="text-xs text-[#6e7d92]">Usually 1–3 sentences is enough.</p>
          )}
          {!dwellActive && submitError && (
            <p role="alert" className="mt-1.5 rounded-md border border-rose-800/60 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-300">
              {submitError}
            </p>
          )}
        </div>
      );
    }
  }

  const activeIndex = items.findIndex(i => i.id === activeId);
  const pagerIndex = activeIndex >= 0 ? activeIndex + 1 : 1;

  return (
    <div
      id="question-panel"
      role="region"
      aria-label="Questions from AI"
      className="absolute inset-0 z-20 flex flex-col bg-[#05070c] animate-panel-in"
    >
      <header className="shrink-0 border-b border-[#2a3342] bg-[#0d1017]/90 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <MessageSquare className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          <span className="text-sm font-bold text-[#e8edf5]">Questions from AI</span>
          <span className="rounded-full bg-[#11151d] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[#ffb3bd]">
            {items.length}
          </span>
          {item?.docPath && (
            <span className="rounded bg-[#11151d] px-1.5 py-0.5 font-mono text-[10px] text-[#a8b3c4]">
              {item.docPath.split('/').pop()}
            </span>
          )}
          {item?.section && (
            <span className="rounded bg-[#11151d] px-1.5 py-0.5 text-[10px] font-medium text-[#a8b3c4]">
              asked while {item.section}
            </span>
          )}
          {item?.severity === 'blocking' && (
            <span className="rounded border border-rose-700 bg-rose-950/60 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
              BLOCKING
            </span>
          )}
          {items.length >= 2 && (
            <span className="text-[11px] font-mono text-[#6e7d92] tabular-nums">
              {pagerIndex} of {items.length}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
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
        <div className="flex overflow-x-auto gap-1.5 border-b border-[#2a3342] px-3 py-1.5">
          {items.map(navItem => {
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
            return (
              <button
                key={navItem.id}
                type="button"
                onClick={() => {
                  setActiveId(navItem.id);
                  onFocusDocument?.(navItem);
                }}
                aria-current={isActive ? 'true' : undefined}
                className={`flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'border-violet-800/60 bg-violet-950/70 text-violet-200'
                    : 'border-[#2a3342] bg-[#0d1017] text-[#a8b3c4] hover:bg-[#11151d] hover:text-[#e8edf5]'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
                <span className="max-w-[140px] truncate">{navItem.title}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{body}</div>

      {composer && (
        <footer className="shrink-0 border-t border-[#2a3342] bg-[#0d1017]/70 p-3">{composer}</footer>
      )}
    </div>
  );
}