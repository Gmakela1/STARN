import { PortalItem } from '../workspace/types.js';

/**
 * Flat SSE frames for the question-portal answer queue. Each kind is a member
 * of the core AutopilotEvent union, so the server session routes them through
 * its event bus into the `event: autopilot` stream as `{ status: ev }`.
 *
 * I/O-agnostic core leaf: no http, no server/session imports.
 */
export type AnswerFrameEvent =
  | { kind: 'answer_queued'; itemId: string; title: string }
  | { kind: 'answer_applying'; itemId: string }
  | { kind: 'answer_applied'; itemId: string; item: PortalItem; affectedDocs: string[] }
  | { kind: 'answer_failed'; itemId: string; error: string };

/** Result of one queued answer application. `ok: false` never halts the drain. */
export type AnswerApplyResult =
  | { ok: true; item: PortalItem; affectedDocs: string[] }
  | { ok: false; error: string };

export interface AnswerQueueDeps {
  /** Applies one answer. Should not throw (a rejection is folded into `ok: false`). */
  apply: (itemId: string, answer: string) => Promise<AnswerApplyResult>;
  /** Receives answer-frame events around each apply (applying → applied/failed). */
  onFrame: (ev: AnswerFrameEvent) => void;
  /** Queue capacity. Defaults to 50. */
  maxSize?: number;
}

export const ANSWER_QUEUE_FULL_MESSAGE = 'Answer queue is full (50). Try again when the current turn finishes.';

const DEFAULT_MAX_SIZE = 50;

/**
 * FIFO queue of portal answers that arrive while a turn is in progress. They
 * apply one at a time (serial, never overlapping). A failed apply surfaces as
 * an `answer_failed` frame and never halts the drain. Duplicate itemIds are
 * not appended: the pending entry's answer is replaced so the same question
 * is never applied twice. Concurrent `drain()` calls are safe — the first
 * wins, later triggers return immediately.
 */
export class AnswerQueue {
  private readonly maxSize: number;
  private readonly apply: AnswerQueueDeps['apply'];
  private readonly onFrame: AnswerQueueDeps['onFrame'];
  private pending: Array<{ itemId: string; answer: string }> = [];
  private draining = false;

  constructor(deps: AnswerQueueDeps) {
    this.apply = deps.apply;
    this.onFrame = deps.onFrame;
    this.maxSize = deps.maxSize ?? DEFAULT_MAX_SIZE;
  }

  /**
   * Enqueues an answer, returning `{ queued: true, replaced: boolean }`.
   * A pending entry for the same itemId has its answer replaced instead of
   * being appended. Throws ANSWER_QUEUE_FULL_MESSAGE when the queue is full.
   */
  enqueue(itemId: string, answer: string): { queued: boolean; replaced: boolean } {
    const existing = this.pending.find(e => e.itemId === itemId);
    if (existing) {
      existing.answer = answer;
      return { queued: true, replaced: true };
    }
    if (this.pending.length >= this.maxSize) {
      throw new Error(ANSWER_QUEUE_FULL_MESSAGE);
    }
    this.pending.push({ itemId, answer });
    return { queued: true, replaced: false };
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  /**
   * Drains the queue serially (FIFO, one apply at a time). Re-entrancy
   * guarded: concurrent drain() calls are safe — the first wins and a
   * concurrent trigger returns immediately instead of overlapping applies.
   * A failed (or throwing) apply never halts the drain.
   */
  async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const next = this.pending.shift();
        if (!next) {
          break;
        }
        this.onFrame({ kind: 'answer_applying', itemId: next.itemId });
        let result: AnswerApplyResult;
        try {
          const applied = await this.apply(next.itemId, next.answer);
          result = applied ?? { ok: false, error: 'Answer apply returned no result' };
        } catch (err: any) {
          result = { ok: false, error: err?.message ?? String(err) };
        }
        if (result.ok) {
          this.onFrame({
            kind: 'answer_applied',
            itemId: next.itemId,
            item: result.item,
            affectedDocs: result.affectedDocs
          });
        } else {
          this.onFrame({ kind: 'answer_failed', itemId: next.itemId, error: result.error });
        }
      }
    } finally {
      this.draining = false;
    }
  }
}