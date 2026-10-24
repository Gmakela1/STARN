import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, MessageSquare, X } from 'lucide-react';
import { PortalItem } from '../types/api';
import { renderDetail } from '../lib/portalDetail';

export interface AnswerDialogProps {
  item: PortalItem;
  onSubmit: (id: string, text: string) => Promise<void>;
  onClose: () => void;
}

/**
 * The only answer surface (§2.2) — bigger window than the old inline two-row
 * box, one code path for queue feedback, submit errors, and focus management.
 */
export default function AnswerDialog({ item, onSubmit, onClose }: AnswerDialogProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // §2.2.2.2 — initial focus into the textarea.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // §2.2.2.5 — body scroll lock while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // §2.2.2.3 — Escape closes (guard IME composition; focus restore is the caller's job).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const doSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(item.id, text.trim());
      onClose();
    } catch (err) {
      // Keep the modal open — the error row explains what happened.
      setSubmitError((err as Error).message || 'Could not send your answer.');
      setSubmitting(false);
    }
  };

  const r = renderDetail(item.detail ?? '');
  const detailId = `q-${item.id}-detail`;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-backdrop-in items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm motion-reduce:animate-none"
      onMouseDown={(e) => {
        // §2.2.2.6 — dirty-guard: backdrop only closes when the textarea is empty.
        if (e.target === e.currentTarget && !text.trim()) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`q-${item.id}-title`}
        aria-describedby={item.detail ? detailId : undefined}
        className="flex max-h-[85vh] w-[min(640px,calc(100vw-2rem))] animate-dialog-in flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl motion-reduce:animate-none"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
              <h2 id={`q-${item.id}-title`} className="truncate text-sm font-bold text-slate-100">
                {item.title}
              </h2>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {item.docPath && (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                  {item.docPath.split('/').pop()}
                </span>
              )}
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                asked while {item.section ?? 'this phase'}
              </span>
              {item.severity === 'blocking' && (
                <span className="rounded border border-rose-700 bg-rose-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                  BLOCKING
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close question"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div id={detailId} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            {r.bullets.length === 0 && !r.wasTruncated && r.overflow === 0 && (
              <p className="text-xs leading-relaxed text-slate-300">{item.detail}</p>
            )}
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
            {(r.overflow > 0 || r.wasTruncated) && !showFull && (
              <button
                onClick={() => setShowFull(true)}
                className="mt-1.5 rounded text-[11px] font-medium text-sky-400 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                Show full question
              </button>
            )}
            {showFull && (
              <p className="mt-1.5 rounded-md border border-slate-800 bg-slate-950/60 p-2.5 text-xs leading-relaxed text-slate-400">
                {item.detail}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`q-${item.id}-answer`} className="text-xs font-semibold text-slate-300">
              Your answer
            </label>
            <textarea
              id={`q-${item.id}-answer`}
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter (or IME composition) inserts a newline.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (text.trim() && !submitting) void doSubmit();
                }
              }}
              placeholder="Give the engineer a concrete direction — a spec value, a preference, a constraint… (Enter to send, Shift+Enter for newline)"
              disabled={submitting}
              className="min-h-[120px] w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/30 disabled:opacity-50"
            />
            <p className="text-[11px] text-slate-500" id={`q-${item.id}-hint`}>
              Usually 1–3 sentences is enough.
            </p>
          </div>

          {submitError && (
            <p role="alert" className="flex items-center gap-1.5 rounded-md border border-rose-800 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {submitError}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-800 p-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          >
            Cancel
          </button>
          <button
            onClick={() => void doSubmit()}
            disabled={!text.trim() || submitting}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-sky-400/50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sending…
              </>
            ) : (
              'Send answer'
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}