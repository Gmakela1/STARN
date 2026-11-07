// The conversation log (design 2026-11-03 §3.2 S4–S8, §4.3, §4.4): a
// role=log list of ask / specialist / recorded / proposal rows, then the
// in-flight status row, the error alert and the pending conclusion card.
// Scrolls to the newest row, or to the card top when the card is taller than
// the log; smooth only when reduced motion is not requested (§4.7).
import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, Clock3, Loader2, Lock, TriangleAlert } from 'lucide-react';
import ProposalCard from './ProposalCard';
import type { PortalThreadMessage } from '../../types/api';

/** Recorded-answer phase chip (§4.3): words + tone, never colour alone. */
export interface ChatRecordedState {
  label: string;
  tone: 'queued' | 'applying' | 'applied' | 'failed';
}

export interface ChatLogProps {
  /** Item id — the element id is `qc-log-{id}` (ChatHeader's aria-controls). */
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
 * Scrollable conversation log. Inputs/outputs: see `ChatLogProps`.
 * Throws: never.
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
  const pending = proposal?.status === 'pending' ? proposal : null;

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
    const card = el.querySelector<HTMLElement>('[role="group"][aria-label="Proposed answer"]');
    const cardTop =
      card && card.offsetHeight > el.clientHeight ? card.offsetTop - el.offsetTop : null;
    const top = cardTop ?? el.scrollHeight;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior });
    else el.scrollTop = top;
  }, [messages.length, busy, error, proposal]);

  return (
    <div
      ref={logRef}
      id={`qc-log-${id}`}
      role="log"
      aria-relevant="additions"
      aria-label={`Conversation about ${title}`}
      className={`qchat-log ${pending ? 'is-proposal' : ''}`}
    >
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
        <p role="status" className="flex items-center gap-1.5 text-[12px] text-[var(--sf-text-2)]">
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
  );
}
