// One question's whole conversation region (design 2026-11-03 §4.1, §4.7):
// <section aria-label="Conversation about {title}"> = ChatHeader + optional
// ChatLog + optional `banner` slot + ChatComposer. This file owns no state —
// `expanded` (session-only, keyed by item in the parent), the draft and the
// composer mode all live in the parent. The only thing it does on its own is
// auto-expand the log when a row arrives (send, specialist reply, concluded
// proposal).
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import ChatHeader from './ChatHeader';
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
  /** Session-only, parent-owned (§4.7). */
  expanded: boolean;
  onToggleExpanded: () => void;

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
  /** Extra classes on the root section (the panel passes `flex-1`). */
  className?: string;
}

/**
 * Composes the conversation region. Inputs/outputs: see `QuestionChatProps`.
 * Throws: never. Auto-expand (§4.7) fires only for a *new* row, an Ask going
 * in flight, or a newly arrived pending proposal — never for existing history,
 * so switching to a question with a thread stays collapsed.
 */
export default function QuestionChat({
  id,
  title,
  messages,
  expanded,
  onToggleExpanded,
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
  const seen = useRef({
    rows: messages.length,
    busy,
    pending: pendingProposal !== null
  });

  useEffect(() => {
    const prev = seen.current;
    const grew = messages.length > prev.rows;
    const sendStarted = busy && !prev.busy;
    const proposalArrived = pendingProposal !== null && !prev.pending;
    seen.current = { rows: messages.length, busy, pending: pendingProposal !== null };
    if (!expanded && (grew || sendStarted || proposalArrived)) onToggleExpanded();
  }, [messages.length, busy, pendingProposal, expanded, onToggleExpanded]);

  return (
    <section
      aria-label={`Conversation about ${cleanTitle}`}
      className={className ? `qchat-wrap ${className}` : 'qchat-wrap'}
    >
      <div className="qchat">
        <ChatHeader
          id={id}
          title={cleanTitle}
          messages={messages}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          canConclude={canConclude}
          concluding={concluding}
          onConclude={onConclude}
          proposalPending={pendingProposal !== null}
        />
        {expanded && (
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
        )}
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
        />
      </div>
    </section>
  );
}
