import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, RotateCcw, X, AlertTriangle, MessageSquare } from 'lucide-react';
import { PortalItem } from '../types/api';

export interface QuestionBarProps {
  items: PortalItem[];
  onSubmit: (id: string, answer: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onResume?: (docId?: string) => void;
  onEditDoc?: (docId?: string) => void;
  checkpointVisible: boolean;
}

/** Visual weight rule (S11): when checkpoint visible, badge only, subdued. */
export default function QuestionBar({
  items,
  onSubmit,
  onDismiss,
  onResume,
  onEditDoc,
  checkpointVisible
}: QuestionBarProps) {
  const openItems = items.filter(i => i.status === 'open' || i.status === 'answered');
  const [expanded, setExpanded] = useState(false);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [arriveKey, setArriveKey] = useState(0);
  const prevCountRef = useRef(openItems.length);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // S3: arrival animation on count increase
  useEffect(() => {
    if (openItems.length > prevCountRef.current) {
      setArriveKey(k => k + 1);
    }
    prevCountRef.current = openItems.length;
  }, [openItems.length]);

  // S2: when checkpoint visible, single badge only
  if (checkpointVisible) {
    if (openItems.length === 0) return null;
    return (
      <div className="flex h-8 items-center gap-2 border-t border-slate-800 bg-slate-900/60 px-3 opacity-60">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
        <span className="text-[11px] font-medium text-amber-300">
          {openItems.length} pending
        </span>
      </div>
    );
  }

  if (openItems.length === 0) return null;

  const pending = openItems.filter(i => i.status === 'open');
  const answered = openItems.filter(i => i.status === 'answered');
  const count = pending.length;

  const handleSubmit = async (id: string) => {
    if (!answerText.trim()) return;
    setAnsweringId(id);
    try {
      await onSubmit(id, answerText.trim());
      setAnswerText('');
      // S5: mark resolved after 8s dwell
      setResolvedIds(prev => new Set(prev).add(id));
      setTimeout(() => {
        setResolvedIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 8000);
    } finally {
      setAnsweringId(null);
    }
  };

  const renderCollapsed = () => (
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

  const renderCard = (item: PortalItem) => {
    const isParked = item.type === 'parked';
    const isPending = item.status === 'open';
    const isResolving = resolvedIds.has(item.id);
    const borderColor = isParked
      ? 'border-l-rose-500 bg-rose-950/20'
      : isResolving
        ? 'border-l-slate-600 bg-slate-900/40'
        : 'border-l-amber-500 bg-amber-950/10';

    return (
      <div
        key={item.id}
        className={`rounded-lg border-l-2 p-3 ${borderColor} ${
          isResolving ? 'animate-answered-collapse opacity-50' : ''
        }`}
        style={{ animationDelay: isResolving ? '0ms' : undefined }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
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
              <span className="text-[11px] font-mono text-slate-500 truncate max-w-[120px]">
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

        <p className="mt-1.5 text-sm font-medium text-slate-200">{item.title}</p>

        {item.detail && (
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.detail}</p>
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
          <div className="mt-2 flex gap-2">
            <textarea
              ref={inputRef}
              value={answeringId === item.id ? answerText : ''}
              onChange={e => {
                if (answeringId !== item.id) setAnsweringId(item.id);
                setAnswerText(e.target.value);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit(item.id);
                }
              }}
              rows={2}
              placeholder="Type your answer… (Enter to submit)"
              disabled={answeringId === item.id}
              className="min-h-[36px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => void handleSubmit(item.id)}
              disabled={!answerText.trim() || answeringId === item.id}
              className="flex min-h-[36px] w-[36px] items-center justify-center rounded-lg bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {answeringId === item.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
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

  if (!expanded) return renderCollapsed();

  return (
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
