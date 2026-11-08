// The conversation log (design 2026-11-03 §3c.1–§3c.3): the only scroller in
// the left pane, filling all height the context header and composer leave. A
// role=log list of ask / specialist / recorded / research / proposal rows inside ONE
// width-capped reading column (`.qchat-col`), plus the "Jump to latest" pill.
// New rows follow the reader only when they are already at the bottom; a
// reader who scrolled up into history is never yanked by a poll (§3c.3).
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, Check, Clock3, Loader2, Lock, Search, TriangleAlert } from 'lucide-react';
import ProposalCard from './ProposalCard';
import type { PortalThreadMessage } from '../../types/api';

/** Recorded-answer phase chip (§4.3): words + tone, never colour alone. */
export interface ChatRecordedState {
  label: string;
  tone: 'queued' | 'applying' | 'applied' | 'failed';
}

export interface ChatLogProps {
  /** Item id — the element id is `qc-log-{id}`; a change is a question switch. */
  id: string;
  /** Cleaned question title; used verbatim in the aria-label. */
  title: string;
  messages: PortalThreadMessage[];
  /** A send is in flight. */
  busy: boolean;
  /** Which send: only 'ask' renders the "Specialist is replying…" row. */
  busyKind?: 'ask' | 'answer';
  /** Ask failure copy (S6). The fixed sentence is always shown. */
  error?: string;
  onRetry?: () => void;
  /** Pending concluded draft (§4.4); rendered as the last row. */
  proposal?: PortalThreadMessage['proposal'] | null;
  editingProposal: boolean;
  proposalError?: string;
  onUseProposal: () => void;
  onEditProposal: () => void;
  onRejectProposal: () => void;
  onSaveProposalEdit: (text: string) => void;
  onCancelProposalEdit: () => void;
  /** Live phase chip for recorded rows, from `answerStates[id]` (§4.3). */
  recordedState?: ChatRecordedState;
}

/** Fixed S6 copy — the user's message survives a failed Ask. */
const ERROR_TEXT = "Couldn't get a reply. Your message is saved.";

/** Within this many px of the bottom the reader still counts as "at latest". */
const STICK_PX = 24;

const CHIP_ICON: Record<ChatRecordedState['tone'], LucideIcon> = {
  queued: Clock3,
  applying: Loader2,
  applied: Check,
  failed: TriangleAlert
};

const CHIP_CLS: Record<ChatRecordedState['tone'], string> = {
  queued: 'border-violet-700/50 bg-violet-950/40 text-violet-300',
  applying: 'border-[#ff2a3c]/45 bg-[#1a0208] text-[#ffb3bd]',
  applied: 'border-[#8b5cf6]/50 bg-[#2e1065]/40 text-[#e8edf5]',
  failed: 'border-rose-700/50 bg-rose-950/40 text-rose-300'
};

/** One recorded (committed) answer card: crimson rule, Lock, words, chip. */
function RecordedRow({
  text,
  state
}: {
  text: string;
  state?: ChatRecordedState;
}) {
  const Icon = state ? CHIP_ICON[state.tone] : null;
  return (
    <div className="qchat-recorded">
      <p className="qchat-recorded-label">
        <Lock className="h-3 w-3" aria-hidden />
        Recorded answer
      </p>
      <p className="mt-0.5 whitespace-pre-line text-[13px] text-[var(--sf-text)]">{text}</p>
      {state && Icon && (
        <span
          className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${CHIP_CLS[state.tone]}`}
        >
          <Icon
            className={`h-3 w-3 ${state.tone === 'applying' ? 'motion-safe:animate-spin' : ''}`}
            aria-hidden
          />
          {state.label}
        </span>
      )}
    </div>
  );
}

/**
 * Researcher delegation row (spec §9): violet left rule, the `Researcher`
 * label, the confidence band as a WORD (never colour alone), the question that
 * was asked, and its sources — each title linked when the source has a `url`.
 * Inputs: `message` — a `kind === 'research'` row; `research` may be absent on
 * legacy rows, which still render the question.
 * Outputs: one row, at least 44 px tall, marked `data-kind="research"`.
 * Throws: never.
 */
function ResearchRow({ message }: { message: PortalThreadMessage }) {
  const research = message.research;
  const sources = research?.sources ?? [];
  return (
    <div
      data-kind="research"
      className="min-h-[44px] border-l-2 border-[var(--sf-review)] pl-2.5"
    >
      <p className="flex items-center gap-1.5">
        <Search className="h-3 w-3 shrink-0 text-violet-300" aria-hidden />
        <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-violet-200">
          Researcher
        </span>
        {research && (
          <span className="rounded-full border border-[var(--sf-review)]/55 bg-[var(--sf-review-fill)]/50 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.07em] text-violet-200">
            {research.band}
          </span>
        )}
      </p>
      <p className="mt-0.5 whitespace-pre-line text-[12px] italic text-[var(--sf-text-mut)]">
        {message.text}
      </p>
      {sources.length > 0 && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--sf-text-2)]">
          {sources.map((s, i) => (
            <span key={`${s.title}-${i}`}>
              {i > 0 && ', '}
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-[var(--sf-text)]"
                >
                  {s.title}
                </a>
              ) : (
                s.title
              )}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * Conversation log. Inputs/outputs: see `ChatLogProps`.
 * Throws: never. Scroll contract (§3c.3): instant jump to the latest row on
 * mount and on question switch; on row growth it follows only when the reader
 * is within 24 px of the bottom, otherwise the view does not move and the
 * "Jump to latest" pill appears.
 */
export default function ChatLog({
  id,
  title,
  messages,
  busy,
  busyKind,
  error,
  onRetry,
  proposal,
  editingProposal,
  proposalError,
  onUseProposal,
  onEditProposal,
  onRejectProposal,
  onSaveProposalEdit,
  onCancelProposalEdit,
  recordedState
}: ChatLogProps) {
  const logRef = useRef<HTMLDivElement>(null);
  /** Was the log at the bottom before this change? Decides whether to follow. */
  const stickRef = useRef(true);
  /** The mount/id effect owns the first position; growth must not re-scroll it. */
  const firstRunRef = useRef(true);
  const rowsRef = useRef(messages.length);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);

  const pending = proposal?.status === 'pending' ? proposal : null;
  // Scalar so a re-created proposal object cannot re-trigger the follow effect.
  const pendingText = pending?.text ?? '';

  function isAtBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
  }

  function scrollToBottom(smooth: boolean): void {
    const el = logRef.current;
    if (!el) return;
    const top = el.scrollHeight;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      el.scrollTop = top;
    }
  }

  // Mount and question switch: a chat opens at its latest message, instantly —
  // never smooth, so switching questions cannot animate through history.
  useEffect(() => {
    stickRef.current = true;
    firstRunRef.current = true;
    setAtBottom(true);
    setUnseen(0);
    scrollToBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- position, not data
  }, [id]);

  // Row growth (new row, replying row, pending proposal): follow only when the
  // reader is already at the bottom; otherwise nothing moves (§3c.3).
  useEffect(() => {
    const grew = Math.max(0, messages.length - rowsRef.current);
    rowsRef.current = messages.length;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    if (!stickRef.current) {
      if (grew > 0) setUnseen(n => n + grew);
      return;
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    scrollToBottom(!reduced);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollToBottom is stable
  }, [messages.length, busy, error, pendingText]);

  /** Scroll handler: the only place that decides "the reader is at the bottom". */
  function onScroll(): void {
    const el = logRef.current;
    if (!el) return;
    const bottom = isAtBottom(el);
    stickRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  }

  /** Pill click: one explicit jump. Focus does not move (§3c.3). */
  function jumpToLatest(): void {
    stickRef.current = true;
    setAtBottom(true);
    setUnseen(0);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    scrollToBottom(!reduced);
  }

  return (
    <div className="qchat-logwrap">
      <div
        ref={logRef}
        id={`qc-log-${id}`}
        role="log"
        aria-relevant="additions"
        aria-label={`Conversation about ${title}`}
        onScroll={onScroll}
        className="qchat-log"
      >
        <div className="qchat-col">
          {messages.length === 0 && !busy && !error && !pending && (
            <p className="text-center text-[12px] leading-relaxed text-[var(--sf-text-mut)]">
              <span className="block font-semibold">No conversation yet.</span>
              <span className="block">Ask the specialist below — nothing is recorded.</span>
            </p>
          )}

          {messages.map((m, i) => {
            const key = `${m.ts}-${i}`;
            if (m.kind === 'proposal') {
              // Superseded drafts collapse to one muted line; accepted/rejected
              // drafts leave the log entirely (§4.4).
              if (m.proposal?.status === 'superseded') {
                return (
                  <p key={key} className="text-[11px] text-[var(--sf-text-mut)]">
                    Superseded proposal
                  </p>
                );
              }
              return null;
            }
            if (m.kind === 'recorded') {
              return <RecordedRow key={key} text={m.text} state={recordedState} />;
            }
            if (m.kind === 'research') {
              // Never the plain specialist row — the question is not a reply (§9).
              return <ResearchRow key={key} message={m} />;
            }
            if (m.role === 'user') {
              // Ask rows never carry a "Recorded" marker (§8 DO-NOT 5).
              return (
                <div key={key} className="qchat-ask">
                  <span className="sr-only">You asked: </span>
                  {m.text}
                </div>
              );
            }
            return (
              <div key={key}>
                <p className="qchat-specialist-label">Specialist</p>
                <p className="qchat-specialist-body whitespace-pre-line">{m.text}</p>
              </div>
            );
          })}

          {busy && busyKind === 'ask' && (
            <p
              role="status"
              className="flex items-center gap-1.5 text-[12px] text-[var(--sf-text-2)]"
            >
              <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
              Specialist is replying…
            </p>
          )}

          {error && (
            <div role="alert" className="qchat-alert">
              <span>{ERROR_TEXT}</span>
              {error !== ERROR_TEXT && <span className="text-rose-200/80">{error}</span>}
              {onRetry && (
                <button type="button" onClick={onRetry} className="qchat-retry">
                  Retry
                </button>
              )}
            </div>
          )}

          {pending && (
            <ProposalCard
              variant="conclusion"
              text={pending.text}
              meta={`Based on ${pending.basedOn} messages`}
              editing={editingProposal}
              busy={busy}
              error={proposalError}
              onUse={onUseProposal}
              onEdit={onEditProposal}
              onReject={onRejectProposal}
              onSaveEdit={onSaveProposalEdit}
              onCancelEdit={onCancelProposalEdit}
            />
          )}
        </div>
      </div>

      {/* Rendered after the log so Tab reaches it before the composer; floats
          over the log's bottom padding, never over message text (§3c.3). */}
      {!atBottom && (
        <button type="button" onClick={jumpToLatest} className="qchat-jump">
          <ArrowDown className="h-3 w-3" aria-hidden />
          Jump to latest
          {unseen > 0 && <span className="qchat-jump-count">{unseen}</span>}
        </button>
      )}
    </div>
  );
}
