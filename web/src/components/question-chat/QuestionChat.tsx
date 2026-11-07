// One question's whole conversation region (design 2026-11-03 §3c.1):
// <section aria-label="Conversation about {title}"> = ChatLog + optional
// `banner` slot + ChatComposer. The left pane IS a chat window: the log fills
// all remaining height between the pinned context header above and the pinned
// composer below, and there is no collapse toggle (§3c, §3c.8.1).
// This file owns no state — the draft, the composer mode and the pending
// proposal all live in the parent.
import type { ReactNode } from 'react';
import ChatLog from './ChatLog';
import type { ChatRecordedState } from './ChatLog';
import ChatComposer from './ChatComposer';
import type { ComposerLocked, ComposerMode } from './ChatComposer';
import { cleanQuestionTitle } from '../../lib/portalGrouping';
import type { PortalThreadMessage } from '../../types/api';

export interface QuestionChatProps {
  /** Item id — keys the log element and keeps threads siloed (§4.7). */
  id: string;
  /** Raw question title; cleaned once here for every label. */
  title: string;
  /** `item.meta.thread` — the parent's rows, oldest first. */
  messages: PortalThreadMessage[];

  // ---- thread send state -------------------------------------------------
  /** An Ask or an answer is in flight. */
  busy: boolean;
  /** Which send is in flight; 'ask' shows the replying row. */
  busyKind?: 'ask' | 'answer';
  /** Ask failure copy (S6); the log renders the fixed sentence + Retry. */
  threadError?: string;
  onRetryThread?: () => void;

  // ---- conclude ----------------------------------------------------------
  /** Parent gate: ≥1 specialist reply, no pending proposal, nothing busy. */
  canConclude: boolean;
  concluding: boolean;
  onConclude: () => void;

  // ---- concluded proposal (§4.4) ----------------------------------------
  /** The pending draft; the parent maps `item.meta.thread` proposal rows here. */
  proposal?: PortalThreadMessage['proposal'] | null;
  editingProposal: boolean;
  proposalError?: string;
  onUseProposal: () => void;
  onEditProposal: () => void;
  onRejectProposal: () => void;
  onSaveProposalEdit: (text: string) => void;
  onCancelProposalEdit: () => void;

  /** Phase chip for recorded rows, from `answerStates[id]` (§4.3). */
  recordedState?: ChatRecordedState;

  // ---- composer ----------------------------------------------------------
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  /** The single per-item draft (parent's `drafts[id]`). */
  draft: string;
  onDraftChange: (text: string) => void;
  onAsk: () => void;
  onAnswer: () => void;
  /** Composer unavailable (e.g. answer queued/applying elsewhere). */
  disabled?: boolean;
  /** Replaces the composer with one locked row (S9/S10). */
  locked?: ComposerLocked;
  recording: boolean;
  onMicDown: () => void;
  onMicUp: () => void;
  /** Answer-send failure (R5): Retry-as-answer card in the composer. */
  answerError?: string;
  placeholder?: string;
  /**
   * Slot between the log and the composer (design §3b.3.7): the recorded /
   * resolved status banner, the answer state chip and the research proposal
   * card. `shrink-0` — the log is the only band that gives up height.
   */
  banner?: ReactNode;
  /** Extra classes on the root section (the panel passes `flex-1 min-h-0`). */
  className?: string;
}

/**
 * Composes the conversation region. Inputs/outputs: see `QuestionChatProps`.
 * Throws: never. No expansion state: the conversation is always rendered and
 * the log is the only scrollable band (§3c.10.1).
 */
export default function QuestionChat({
  id,
  title,
  messages,
  busy,
  busyKind,
  threadError,
  onRetryThread,
  canConclude,
  concluding,
  onConclude,
  proposal,
  editingProposal,
  proposalError,
  onUseProposal,
  onEditProposal,
  onRejectProposal,
  onSaveProposalEdit,
  onCancelProposalEdit,
  recordedState,
  mode,
  onModeChange,
  draft,
  onDraftChange,
  onAsk,
  onAnswer,
  disabled,
  locked,
  recording,
  onMicDown,
  onMicUp,
  answerError,
  placeholder,
  banner,
  className
}: QuestionChatProps) {
  const cleanTitle = cleanQuestionTitle(title);
  const pendingProposal = proposal?.status === 'pending' ? proposal : null;

  return (
    <section
      aria-label={`Conversation about ${cleanTitle}`}
      className={className ? `qchat-wrap ${className}` : 'qchat-wrap'}
    >
      <div className="qchat">
        <ChatLog
          id={id}
          title={cleanTitle}
          messages={messages}
          busy={busy}
          busyKind={busyKind}
          error={threadError}
          onRetry={onRetryThread}
          proposal={pendingProposal}
          editingProposal={editingProposal}
          proposalError={proposalError}
          onUseProposal={onUseProposal}
          onEditProposal={onEditProposal}
          onRejectProposal={onRejectProposal}
          onSaveProposalEdit={onSaveProposalEdit}
          onCancelProposalEdit={onCancelProposalEdit}
          recordedState={recordedState}
        />
        {banner && <div className="shrink-0">{banner}</div>}
        <ChatComposer
          value={draft}
          onChange={onDraftChange}
          mode={mode}
          onModeChange={onModeChange}
          onAsk={onAsk}
          onAnswer={onAnswer}
          busy={busy}
          disabled={disabled ?? false}
          locked={locked}
          recording={recording}
          onMicDown={onMicDown}
          onMicUp={onMicUp}
          answerError={answerError}
          placeholder={placeholder}
          canConclude={canConclude}
          concluding={concluding}
          onConclude={onConclude}
          proposalPending={pendingProposal !== null}
        />
      </div>
    </section>
  );
}
