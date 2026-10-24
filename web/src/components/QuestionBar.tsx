import { useEffect, useRef, useState } from 'react';
import { Check, Clock3, Loader2, RotateCcw, X, AlertTriangle, MessageSquare, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { AnswerState, PortalItem } from '../types/api';
import { renderDetail } from '../lib/portalDetail';
import AnswerDialog from './AnswerDialog';

export interface QuestionBarProps {
  items: PortalItem[];
  onSubmit: (id: string, answer: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onResume?: (docId?: string) => void;
  onEditDoc?: (docId?: string) => void;
  checkpointVisible: boolean;
  answerStates?: Record<string, AnswerState>;
}

/** §1.4.1 — per-phase chip visuals, keyed off the AnswerPhase union. */
const stateChip: Record<AnswerState['phase'], { icon: LucideIcon; label: string; cls: string; live?: boolean }> = {
  queued:   { icon: Clock3,          label: 'Queued — applies after this phase', cls: 'border-amber-700/50 bg-amber-950/40 text-amber-300' },
  applying: { icon: Loader2,         label: 'Applying…',                        cls: 'border-cyan-700/50 bg-cyan-950/40 text-cyan-300', live: true },
  applied:  { icon: Check,           label: 'Applied',                           cls: 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' },
  failed:   { icon: TriangleAlert,   label: "Couldn't apply",                    cls: 'border-rose-700/50 bg-rose-950/40 text-rose-300' },
};

/** Visual weight rule (S11): when checkpoint visible, badge only, subdued. */
export default function QuestionBar({
  items,
  onSubmit,
  onDismiss,
  onResume,
  onEditDoc,
  checkpointVisible,
  answerStates
}: QuestionBarProps) {
  const openItems = items.filter(i => i.status === 'open' || i.status === 'answered');
  const [expanded, setExpanded] = useState(false);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [answerTarget, setAnswerTarget] = useState<PortalItem | null>(null);
  const [submittedText, setSubmittedText] = useState<Record<string, string>>({});
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [arriveKey, setArriveKey] = useState(0);
  const prevCountRef = useRef(openItems.length);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const prevStatesRef = useRef<Record<string, AnswerState>>({});
  const mountedRef = useRef(false);
  const dwellHandledRef = useRef<Set<string>>(new Set());
  const dwellTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // §1.4.2 — queue counter = queued + applying (failed stays in the pending count).
  const queuedCount = Object.values(answerStates ?? {}).filter(
    s => s.phase === 'queued' || s.phase === 'applying'
  ).length;

  // S3: arrival animation on count increase
  useEffect(() => {
    if (openItems.length > prevCountRef.current) {
      setArriveKey(k => k + 1);
    }
    prevCountRef.current = openItems.length;
  }, [openItems.length]);

  // §1.5 — live-region announcements on per-item phase transitions only.
  // First mount seeds the baseline (pre-existing states are not announced);
  // batch transitions accumulate in order instead of overwriting.
  useEffect(() => {
    const current = answerStates ?? {};
    if (!mountedRef.current) {
      mountedRef.current = true;
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
          case 'failed': phrases.push(`Couldn't apply your answer.${st.error ? ` ${st.error}` : ''}`); break;
        }
      }
    }
    if (phrases.length > 0) setAnnouncement(phrases.join(' '));
    prevStatesRef.current = current;
  }, [answerStates]);

  // §1.6.3 — "Resolved ✓" dwell keyed off the phase map, so both the immediate
  // 200 path and the SSE answer_applied path show it. Applied also releases the
  // retry text (submittedText). One-shot per item while the dwell is active.
  useEffect(() => {
    const current = answerStates ?? {};
    for (const id of Array.from(dwellHandledRef.current)) {
      if (current[id]?.phase !== 'applied') dwellHandledRef.current.delete(id);
    }
    for (const [id, st] of Object.entries(current)) {
      if (st.phase !== 'applied' || dwellHandledRef.current.has(id)) continue;
      dwellHandledRef.current.add(id);
      setResolvedIds(prev => new Set(prev).add(id));
      setSubmittedText(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      const timer = setTimeout(() => {
        dwellTimersRef.current = dwellTimersRef.current.filter(t => t !== timer);
        setResolvedIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 8000);
      dwellTimersRef.current.push(timer);
    }
  }, [answerStates]);

  // Clear any in-flight dwell timers on unmount.
  useEffect(() => {
    const timers = dwellTimersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // §1.6.3 — submit wrapper: capture the text for retry. The "Resolved ✓" dwell
  // is driven by the phase-map effect above (immediate-200 and SSE paths alike).
  const handleSubmit = async (id: string, text: string) => {
    if (!text.trim()) return;
    setSubmittedText(prev => ({ ...prev, [id]: text }));
    setResolvedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await onSubmit(id, text.trim());
  };

  // §1.4.1 — failed answers replay the last submitted text; no text → reopen the dialog.
  const retry = (id: string) => {
    const text = submittedText[id];
    if (text) {
      void handleSubmit(id, text);
    } else {
      const item = items.find(i => i.id === id);
      if (item) setAnswerTarget(item);
    }
  };

  const closeDialog = () => {
    setAnswerTarget(null);
    triggerRef.current?.focus();
  };

  const renderStateChip = (item: PortalItem) => {
    const st = answerStates?.[item.id];
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
            onClick={() => void retry(item.id)}
            className="inline-flex min-h-[24px] items-center gap-1 rounded-full border border-rose-600/60 bg-rose-950/60 px-2 text-[11px] font-semibold text-rose-200 hover:bg-rose-900/70 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> Retry
          </button>
        )}
      </>
    );
  };

  let body: ReactNode = null;

  // S2: when checkpoint visible, single badge only
  if (checkpointVisible) {
    if (openItems.length > 0) {
      body = (
        <div className="flex h-8 items-center gap-2 border-t border-slate-800 bg-slate-900/60 px-3 opacity-60">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
          <span className="text-[11px] font-medium text-amber-300">
            {openItems.length} pending{queuedCount > 0 ? ` · ${queuedCount} queued` : ''}
          </span>
        </div>
      );
    }
  } else if (openItems.length === 0) {
    body = null;
  } else if (!expanded) {
    const pending = openItems.filter(i => i.status === 'open');
    const answered = openItems.filter(i => i.status === 'answered');
    const count = pending.length;
    body = (
      <div
        className={`flex cursor-pointer items-center gap-2 border-l-2 border-amber-500 bg-slate-900/80 px-3 py-1.5 transition-all hover:bg-slate-800/80 ${
          arriveKey > 0 ? 'animate-question-arrive' : ''
        }`}
        onClick={() => setExpanded(true)}
        role="button"
        tabIndex={0}
        aria-expanded={false}
        onKeyDown={e => { if (e.key === 'Enter') setExpanded(true); }}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20">
          <MessageSquare className="h-3 w-3 text-amber-400" aria-hidden />
        </span>
        <span className="text-xs font-medium text-amber-200">
          Needs Input
        </span>
        {queuedCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
            <Clock3 className="h-3 w-3" aria-hidden />
            {queuedCount} queued
          </span>
        )}
        {count > 0 && (
          <span
            key={arriveKey}
            className="ml-auto rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold tabular-nums text-cyan-300"
          >
            {count}
          </span>
        )}
        {answered.length > 0 && (
          <span className="text-[11px] text-slate-400">
            · {answered.length} resolved
          </span>
        )}
      </div>
    );
  } else {
    const pending = openItems.filter(i => i.status === 'open');
    const answered = openItems.filter(i => i.status === 'answered');
    const count = pending.length;

    const renderCard = (item: PortalItem) => {
      const isParked = item.type === 'parked';
      const isPending = item.status === 'open';
      const isResolving = resolvedIds.has(item.id);
      const borderColor = isParked
        ? 'border-l-rose-500 bg-rose-950/20'
        : isResolving
          ? 'border-l-slate-600 bg-slate-900/40'
          : 'border-l-amber-500 bg-amber-950/10';

      const detailView = (() => {
        if (!item.detail) return null;
        const r = renderDetail(item.detail);
        const isOpen = openDetail === item.id;
        if (r.bullets.length === 0 && !r.wasTruncated && r.overflow === 0) {
          return <p className="text-xs leading-relaxed text-slate-300">{item.detail}</p>;
        }
        return (
          <>
            {r.bullets.length > 0 && (
              <ul className="list-disc space-y-1 pl-3.5 text-xs leading-relaxed text-slate-300">
                {r.bullets.map((b, i) => (
                  <li key={i} className="pl-0.5">
                    {b}{i === r.bullets.length - 1 && r.overflow > 0 ? ` +${r.overflow} more` : ''}
                  </li>
                ))}
              </ul>
            )}
            {r.bullets.length === 0 && r.wasTruncated && (
              <p className="line-clamp-2 text-xs leading-relaxed text-slate-300">{item.detail}</p>
            )}
            {(r.overflow > 0 || r.wasTruncated) && !isOpen && (
              <button
                onClick={() => setOpenDetail(id => (id === item.id ? null : item.id))}
                className="mt-1 rounded text-[11px] font-medium text-sky-400 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                Show full question
              </button>
            )}
            {isOpen && (
              <p className="mt-1.5 rounded-md border border-slate-800 bg-slate-950/60 p-2.5 text-xs leading-relaxed text-slate-400">{item.detail}</p>
            )}
          </>
        );
      })();

      return (
        <div
          key={item.id}
          className={`rounded-lg border-l-2 p-3 ${borderColor} ${
            isResolving ? 'animate-answered-collapse opacity-50' : ''
          }`}
          style={{ animationDelay: isResolving ? '0ms' : undefined }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {isParked ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" aria-hidden />
              ) : isResolving ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
              ) : (
                <MessageSquare className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
              )}
              <span className={`text-xs font-bold ${isParked ? 'text-rose-200' : isResolving ? 'text-slate-400' : 'text-amber-200'}`}>
                {isParked ? 'Critic blocked' : isResolving ? 'Resolved ✓' : 'AI needs input'}
              </span>
              {item.docPath && (
                <span className="max-w-[120px] truncate text-[11px] font-mono text-slate-500">
                  {item.docPath.split('/').pop()}
                </span>
              )}
            </div>
            <button
              onClick={() => void onDismiss(item.id)}
              className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:text-slate-300"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>

          <p className="mt-1.5 text-sm font-bold text-slate-200">{item.title}</p>

          {detailView && (
            <div className="mt-1.5">{detailView}</div>
          )}

          {isParked && item.gaps && item.gaps.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[11px] font-semibold text-rose-300">Missing requirements:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {item.gaps.map((gap, i) => (
                  <li key={i} className="text-[11px] text-rose-200/70">{gap}</li>
                ))}
              </ul>
            </div>
          )}

          {isParked && (
            <div className="mt-2 flex flex-wrap gap-2">
              {onResume && (
                <button
                  onClick={() => onResume(item.docPath)}
                  className="flex min-h-[32px] items-center gap-1 rounded-lg border border-rose-700 bg-rose-950/60 px-2.5 text-[11px] font-medium text-rose-200 hover:bg-rose-900/60"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden />
                  Resolve & Resume
                </button>
              )}
              {onEditDoc && (
                <button
                  onClick={() => onEditDoc(item.docPath)}
                  className="flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800"
                >
                  Edit Manually
                </button>
              )}
            </div>
          )}

          {!isParked && isPending && !isResolving && (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={e => {
                  triggerRef.current = e.currentTarget;
                  setAnswerTarget(item);
                }}
                className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400/50"
              >
                <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Answer
              </button>
              {renderStateChip(item)}
            </div>
          )}

          {!isParked && isResolving && (
            <div className="mt-2 flex items-center gap-2">
              <RotateCcw className="h-3 w-3 text-slate-500" aria-hidden />
              <span className="text-[11px] text-slate-500">Undo</span>
            </div>
          )}
        </div>
      );
    };

    body = (
      <div className="border-t border-slate-800 bg-slate-900/80" role="region" aria-label="Questions from AI">
        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
          <button
            onClick={() => setExpanded(false)}
            className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
            Questions from AI
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">{count}</span>
          </button>
          <span className="text-[11px] text-slate-500">Ctrl+.</span>
        </div>
        <div className="max-h-[200px] space-y-2 overflow-y-auto p-3">
          {pending.map(renderCard)}
          {answered.map(renderCard)}
        </div>
      </div>
    );
  }

  return (
    <>
      {body}
      <span aria-live="polite" className="sr-only">{announcement}</span>
      {answerTarget && (
        <AnswerDialog
          item={answerTarget}
          onSubmit={handleSubmit}
          onClose={closeDialog}
        />
      )}
    </>
  );
}