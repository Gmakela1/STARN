// Conversation label row (design 2026-11-03 §3.2 S1/S3, §4.5): one truncated
// "Conversation about {title}" line — never a Q-number — which becomes ONE
// 44 px aria-expanded toggle once the thread has history, plus the
// "Conclude from chat" action that exists only while it can actually run.
import { ChevronDown, ChevronUp, ListChecks, Loader2, MessageSquare } from 'lucide-react';
import { cleanQuestionTitle } from '../../lib/portalGrouping';
import type { PortalThreadMessage } from '../../types/api';

export interface ChatHeaderProps {
  /** Raw question title; cleaned here for display (no Q-number, §1). */
  title: string;
  /** Thread rows. Proposal rows never count towards the pill (§4.6). */
  messages: PortalThreadMessage[];
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Caller's gate: ≥1 specialist reply, no pending proposal, nothing busy. */
  canConclude: boolean;
  /** The server is drafting the conclusion. */
  concluding: boolean;
  onConclude: () => void;
  /** A concluded draft is waiting for Use/Edit/Reject. */
  proposalPending: boolean;
  /** Item id — the toggle's aria-controls target is `qc-log-{id}`. */
  id: string;
}

/**
 * Counts the rows a reader would call "messages": user asks, specialist
 * replies and recorded answers. Proposal rows are drafts, not messages.
 */
function messageCount(messages: PortalThreadMessage[]): number {
  return messages.filter(m => m.kind !== 'proposal').length;
}

/**
 * Label row for the conversation region. Inputs/outputs: see
 * `ChatHeaderProps`. Throws: never.
 */
export default function ChatHeader({
  title,
  messages,
  expanded,
  onToggleExpanded,
  canConclude,
  concluding,
  onConclude,
  proposalPending,
  id
}: ChatHeaderProps) {
  const label = `Conversation about ${cleanQuestionTitle(title)}`;
  const count = messageCount(messages);

  // Empty thread: plain text, 24 px, no controls (§3.2 S1).
  if (messages.length === 0) {
    return (
      <div className="qchat-label">
        <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
        <p className="min-w-0 truncate" title={label}>
          Conversation about <b>{cleanQuestionTitle(title)}</b>
        </p>
      </div>
    );
  }

  return (
    <div className="qchat-label qchat-label--history">
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-controls={`qc-log-${id}`}
        title={label}
        className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          Conversation about <b>{cleanQuestionTitle(title)}</b>
        </span>
        <span className="qchat-count shrink-0" aria-hidden>
          {count}
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        <span className="sr-only">
          {count} messages in conversation
          {proposalPending ? ', proposed answer waiting' : ''}
        </span>
      </button>
      {canConclude && !proposalPending && (
        <button
          type="button"
          onClick={onConclude}
          aria-busy={concluding}
          disabled={concluding}
          className="qchat-conclude inline-flex shrink-0 items-center gap-1.5"
        >
          {concluding ? (
            <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
          ) : (
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
          )}
          {concluding ? 'Drafting…' : 'Conclude from chat'}
        </button>
      )}
    </div>
  );
}
