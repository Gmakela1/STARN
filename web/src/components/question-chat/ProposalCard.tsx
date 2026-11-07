// Shared proposal card: one component for the research-gate proposal and for a
// draft concluded from the conversation (design 2026-11-03 §4.4). Behaviour is
// the extracted research-proposal behaviour from QuestionPanel — identical
// labels in both variants (Use proposal / Edit / Reject, then Use edited answer
// / Cancel), 44 px targets, no confidence percentage invented for conclusions.
import { useEffect, useId, useState } from 'react';
import { ListChecks } from 'lucide-react';
import type { ResearchSource } from '../../types/api';

export interface ProposalCardProps {
  /** 'research' = critic-gated research proposal; 'conclusion' = from the chat. */
  variant: 'research' | 'conclusion';
  /** Card heading. Defaults per variant. */
  title?: string;
  /** The proposed answer text (edit draft starts from this). */
  text: string;
  /** Right-aligned muted meta, e.g. "Based on 4 messages". */
  meta?: string;
  sources?: ResearchSource[];
  rationale?: string;
  /** Parent-owned edit state (Esc cancels the edit first — §5). */
  editing: boolean;
  busy: boolean;
  error?: string;
  onUse: () => void;
  onEdit: () => void;
  onReject: () => void;
  /** Called with the edited text when the user confirms the edit. */
  onSaveEdit: (text: string) => void;
  onCancelEdit: () => void;
}

const DEFAULT_TITLE: Record<ProposalCardProps['variant'], string> = {
  research: 'Research proposal',
  conclusion: 'Proposed answer — from this conversation'
};

const BTN = 'min-h-[44px] rounded-lg px-2.5 text-[11px] font-semibold transition focus:ring-2 focus:ring-[#ff2a3c]/60 disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_PRIMARY = `${BTN} border border-rose-700/40 bg-[#d61f2c] text-white hover:bg-[#e11d3f]`;
const BTN_QUIET = `${BTN} border border-[#3b4658] bg-[#0d1017] font-medium text-[#a8b3c4] hover:bg-[#11151d]`;

/**
 * Proposal card for both variants. Inputs/outputs: see `ProposalCardProps`.
 * The edit textarea is local state, re-seeded from `text` each time `editing`
 * turns true. Throws: never.
 */
export default function ProposalCard({
  variant,
  title,
  text,
  meta,
  sources = [],
  rationale,
  editing,
  busy,
  error,
  onUse,
  onEdit,
  onReject,
  onSaveEdit,
  onCancelEdit
}: ProposalCardProps) {
  const [draft, setDraft] = useState(text);
  const editId = useId();

  useEffect(() => {
    if (editing) setDraft(text);
  }, [editing, text]);

  return (
    <div role="group" aria-label="Proposed answer" className="qchat-proposal">
      <div className="flex items-center gap-1.5">
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden />
        <p className="text-[11px] font-semibold text-violet-300">{title ?? DEFAULT_TITLE[variant]}</p>
        {meta && (
          <span className="ml-auto shrink-0 text-[11px] text-[var(--sf-text-mut)]">{meta}</span>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--sf-text)]">{text}</p>
      {sources.length > 0 && (
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          {sources.map((s, i) => (
            <li key={i} className="text-[11px] text-[var(--sf-text-2)]">
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-[var(--sf-text)]"
                >
                  {s.title || s.url}
                </a>
              ) : (
                s.title
              )}
            </li>
          ))}
        </ul>
      )}
      {rationale && <p className="mt-1 text-[11px] text-[var(--sf-text-mut)]">{rationale}</p>}
      {error && (
        <p
          role="alert"
          className="mt-1 rounded-md border border-rose-800/60 bg-rose-950/40 px-2.5 py-1 text-xs text-rose-300"
        >
          {error}
        </p>
      )}
      {editing ? (
        <div className="mt-1.5 space-y-1">
          <label htmlFor={editId} className="text-[11px] font-semibold text-[var(--sf-text-2)]">
            Edit proposal
          </label>
          <textarea
            id={editId}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="min-h-[72px] w-full resize-y rounded-lg border border-[var(--sf-border-strong)] bg-[var(--sf-void)] px-2.5 py-2 text-xs text-[var(--sf-text)] focus:border-[#ff2a3c] focus:outline-none focus:ring-2 focus:ring-[#ff2a3c]/40"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSaveEdit(draft)}
              disabled={busy}
              className={BTN_PRIMARY}
            >
              Use edited answer
            </button>
            <button type="button" onClick={onCancelEdit} className={BTN_QUIET}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button type="button" onClick={onUse} disabled={busy} className={BTN_PRIMARY}>
            Use proposal
          </button>
          <button type="button" onClick={onEdit} className={BTN_QUIET}>
            Edit
          </button>
          <button type="button" onClick={onReject} disabled={busy} className={BTN_QUIET}>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
