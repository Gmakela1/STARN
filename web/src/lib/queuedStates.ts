import type { AnswerState, PortalItem } from '../types/api';

/**
 * Board #53B — derives queued answer-chip state from portal item meta.
 *
 * The SSE answer frames (answer_queued/applying/…) are point-in-time and are
 * never backfilled after a reconnect or page reload, so a queued answer would
 * otherwise lose its chip until the next live frame arrives. The server's
 * portal list payload instead marks items with a pending answer-queue entry
 * (`meta.answerQueued`, in-memory queue bookkeeping), and this helper turns
 * those items into chip states. Only items WITHOUT an existing live state are
 * seeded — a live frame (applied/failed) must never be downgraded back to
 * queued.
 */
export function deriveQueuedAnswerStates(
  items: PortalItem[],
  existing: Record<string, AnswerState> = {}
): Record<string, AnswerState> {
  const next: Record<string, AnswerState> = { ...existing };
  for (const item of items) {
    if (item.meta?.answerQueued === true && !next[item.id]) {
      next[item.id] = { phase: 'queued' };
    }
  }
  return next;
}
