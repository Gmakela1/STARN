import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  RotateCcw,
  TriangleAlert,
  X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AnswerState, PortalItem } from '../types/api';
import { renderDetail } from '../lib/portalDetail';
import RunStateCluster from './RunStateCluster';
import type { RunState } from '../lib/runState';

export interface QuestionPanelProps {
  surface: 'closed' | 'open' | 'minimized';
  items: PortalItem[];
  answerStates: Record<string, AnswerState>;
  onSubmit: (id: string, text: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onResume: (docPath: string) => Promise<void>;
  onEditDoc: (docPath: string) => void;
  onMinimize: () => void;
  onExpand: () => void;
  onClose: () => void;
  /** Basename of the currently selected doc; gates the header "Open document" affordance (D5). */
  selectedDocName?: string;
  /** D5: close the panel, select the phase for docPath, and refresh the doc. */
  onOpenDocument?: (docPath: string) => void;
  /** Workstream C: parent-owned doc navigation + highlight (chip click / open / deep-link). */
  onFocusDocument?: (item: PortalItem) => void;
  /** Design BC-5: state-based return path to the queue until URL routing lands. */
  onBackToQueue?: () => void;
  /** Compact run-state echo in the panel header (§5.A); renders only when provided. */
  runState?: RunState;
  phaseName?: string;
  /** Parent-driven deep-link focus (design §5.E); token prevents re-adoption. */
  focusRequest?: { id: string; token: number } | null;
}

/** §1.4.1 — per-phase chip visuals, keyed off the AnswerPhase union (moved from QuestionBar). */
const stateChip: Record<AnswerState['phase'], { icon: LucideIcon; label: string; cls: string; live?: boolean }> = {
  queued: { icon: Clock3, label: 'Queued — applies after this phase', cls: 'border-amber-700/50 bg-amber-950/40 text-amber-300' },
  applying: { icon: Loader2, label: 'Applying…', cls: 'border-cyan-700/50 bg-cyan-950/40 text-cyan-300', live: true },
  applied: { icon: Check, label: 'Applied', cls: 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' },
  failed: { icon: TriangleAlert, label: "Couldn't apply", cls: 'border-rose-700/50 bg-rose-950/40 text-rose-300' }
};

/** Length of the "Resolved ✓" dwell after an answer is applied (§1.6.3). */
const DWELL_MS = 8000;

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
  onMinimize,
  onExpand,
  onClose,
  selectedDocName,
  onOpenDocument,
  onFocusDocument,
  onBackToQueue,
  runState,
  phaseName,
  focusRequest
}: QuestionPanelProps) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showFull, setShowFull] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
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
  // composer drafts, expander, and the dwell snapshot when it returns to the
  // document (close vs minimize, §8.2).
  useEffect(() => {
    if (surface !== 'closed') return;
    setActiveId(items[0]?.id ?? '');
    setDrafts({});
    setShowFull(null);
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
    return () => timers.forEach(clearTimeout);
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
    setDrafts(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSubmitError(null);
    try {
      await onSubmit(id, trimmed);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't send your answer.");
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
        className="absolute inset-x-0 bottom-0 z-30 flex h-[44px] items-center gap-2 border-t border-slate-800 bg-slate-900/95 px-3"
        role="region"
        aria-label="Questions from AI"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
        <span className="shrink-0 text-[11px] font-medium text-amber-300">
          Questions from AI ({items.length})
        </span>
        {stripItem && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{stripItem.title}</span>
        )}
        <button
          ref={expandRef}
          type="button"
          onClick={onExpand}
          aria-label="Expand questions"
          title="Expand questions"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus:ring-2 focus:ring-sky-500/40"
        >
          <Maximize2 className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close questions"
          title="Close questions and return to document"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus:ring-2 focus:ring-sky-500/40"
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
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-800/60 bg-emerald-950/40">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-200">All questions resolved</p>
          <p className="mt-1 text-xs text-slate-500">No pending questions from the current run.</p>
        </div>
        <button
          ref={returnDocRef}
          type="button"
          onClick={onClose}
          className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-300 transition hover:bg-slate-800 focus:ring-2 focus:ring-sky-500/40"
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
      cardTone = 'border-l-slate-600 bg-slate-900/40';
      labelText = 'Resolved ✓';
      labelClass = 'text-slate-400';
      iconClass = 'text-emerald-400';
      LabelIcon = Check;
    }

    const detailView = (() => {
      if (!item.detail) return null;
      const r = renderDetail(item.detail);
      const isOpen = showFull === item.id;
      if (r.bullets.length === 0 && !r.wasTruncated && r.overflow === 0) {
        return <p className="text-xs leading-relaxed text-slate-300">{item.detail}</p>;
      }
      return (
        <>
          {r.bullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-3.5 text-xs leading-relaxed text-slate-300">
              {r.bullets.map((b, i) => (
                <li key={i} className="pl-0.5">
                  {b}
                  {i === r.bullets.length - 1 && r.overflow > 0 ? ` +${r.overflow} more` : ''}
                </li>
              ))}
            </ul>
          )}
          {r.bullets.length === 0 && r.wasTruncated && (
            <p className="line-clamp-2 text-xs leading-relaxed text-slate-300">{item.detail}</p>
          )}
          {(r.overflow > 0 || r.wasTruncated) && !isOpen && (
            <button
              type="button"
              onClick={() => setShowFull(prev => (prev === item.id ? null : item.id))}
              className="mt-1 rounded text-[11px] font-medium text-sky-400 hover:text-sky-300 focus:ring-2 focus:ring-sky-500/40"
            >
              Show full question
            </button>
          )}
          {isOpen && (
            <p className="mt-1.5 rounded-md border border-slate-800 bg-slate-950/60 p-2.5 text-xs leading-relaxed text-slate-400">
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
              <span className="max-w-[120px] truncate text-[11px] font-mono text-slate-500">
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
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 transition hover:text-slate-300 focus:ring-2 focus:ring-sky-500/40"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>

        <p className="mt-1.5 line-clamp-3 text-sm font-bold text-slate-200" title={item.title}>
          {item.title}
        </p>

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
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-rose-700 bg-rose-950/60 px-3 text-xs font-medium text-rose-200 transition hover:bg-rose-900/60 focus:ring-2 focus:ring-sky-500/40"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Resolve & Resume
            </button>
            <button
              type="button"
              onClick={() => {
                if (item.docPath) onEditDoc(item.docPath);
              }}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-300 transition hover:bg-slate-800 focus:ring-2 focus:ring-sky-500/40"
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
          <label htmlFor="question-panel-composer" className="text-xs font-semibold text-slate-300">
            Your answer
          </label>
          {dwellActive ? (
            <div
              role="status"
              className="flex min-h-[96px] items-center gap-2 rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-3 py-2.5 text-sm font-medium text-emerald-300"
            >
              <Check className="h-4 w-4" aria-hidden /> Resolved ✓
            </div>
          ) : (
            <textarea
              id="question-panel-composer"
              ref={composerRef}
              value={drafts[item.id] ?? ''}
              onChange={e => setDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSubmit(item.id, drafts[item.id] ?? '');
                }
              }}
              disabled={composingDisabled}
              placeholder="Type your answer to the AI…"
              className="min-h-[96px] w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/30 disabled:opacity-50"
            />
          )}
          {!dwellActive && (
            <p className="text-xs text-slate-500">Usually 1–3 sentences is enough.</p>
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
      className="absolute inset-0 z-20 flex flex-col bg-slate-950 animate-panel-in"
    >
      <header className="shrink-0 border-b border-slate-800 bg-slate-900/90 px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          <span className="text-sm font-bold text-slate-100">Questions from AI</span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold tabular-nums text-cyan-300">
            {items.length}
          </span>
          {item?.docPath && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              {item.docPath.split('/').pop()}
            </span>
          )}
          {item?.section && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
              asked while {item.section}
            </span>
          )}
          {item?.severity === 'blocking' && (
            <span className="rounded border border-rose-700 bg-rose-950/60 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
              BLOCKING
            </span>
          )}
          {items.length >= 2 && (
            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
              {pagerIndex} of {items.length}
            </span>
          )}
          {runState && <RunStateCluster runState={runState} phase={phaseName} />}
          {onBackToQueue && (
            <button
              type="button"
              onClick={onBackToQueue}
              aria-label="Back to Open Actions"
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-sky-400 transition hover:text-sky-300 focus:ring-2 focus:ring-sky-500/40"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden />
              Back to Open Actions
            </button>
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
                className="cursor-pointer rounded px-1.5 py-1 text-xs text-sky-400 transition hover:text-sky-300 focus:ring-2 focus:ring-sky-500/40"
              >
                Open document
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                // §8.2: minimize with nothing to show collapses to closed.
                if (items.length === 0) onClose();
                else onMinimize();
              }}
              aria-label="Minimize questions"
              title="Minimize questions (keeps your draft)"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus:ring-2 focus:ring-sky-500/40"
            >
              <Minimize2 className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close questions"
              title="Close questions and return to document"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus:ring-2 focus:ring-sky-500/40"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {items.length >= 2 && (
        <div className="flex overflow-x-auto gap-1.5 border-b border-slate-800 px-3 py-1.5">
          {items.map(navItem => {
            const isActive = navItem.id === activeId;
            const dotClass =
              navItem.severity === 'blocking' || navItem.type === 'parked' ? 'bg-rose-400' : 'bg-amber-400';
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
                    ? 'border-sky-800/60 bg-sky-950/70 text-sky-200'
                    : 'border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
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
        <footer className="shrink-0 border-t border-slate-800 bg-slate-900/60 p-3">{composer}</footer>
      )}
    </div>
  );
}