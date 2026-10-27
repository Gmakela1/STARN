import { describe, it, expect, vi } from 'vitest';
import { AnswerQueue, AnswerFrameEvent } from '../src/core/answer-queue.js';
import type { PortalItem } from '../src/workspace/types.js';

function answeredItem(id: string): PortalItem {
  return {
    id,
    type: 'question',
    severity: 'normal',
    docPath: 'docs/CONOPS.md',
    title: 'Unused title',
    source: 'autopilot',
    status: 'answered',
    answer: '48V nominal',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z'
  };
}

describe('AnswerQueue', () => {
  it('drains enqueued answers in FIFO order and empties the queue', async () => {
    const order: string[] = [];
    const queue = new AnswerQueue({
      apply: async itemId => {
        order.push(itemId);
        return { ok: true, item: answeredItem(itemId), affectedDocs: [] };
      },
      onFrame: () => {}
    });

    queue.enqueue('a', 'A');
    queue.enqueue('b', 'B');
    queue.enqueue('c', 'C');
    expect(queue.pendingCount).toBe(3);

    await queue.drain();

    expect(order).toEqual(['a', 'b', 'c']);
    expect(queue.pendingCount).toBe(0);
  });

  it('applies answers strictly one at a time (applies never overlap)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const queue = new AnswerQueue({
      apply: async itemId => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight--;
        return { ok: true, item: answeredItem(itemId), affectedDocs: [] };
      },
      onFrame: () => {}
    });

    queue.enqueue('a', '');
    queue.enqueue('b', '');
    await queue.drain();

    expect(maxInFlight).toBe(1);
  });

  it('caps the queue at 50 entries and throws the exact full message on the 51st', () => {
    const queue = new AnswerQueue({
      apply: async itemId => ({ ok: true, item: answeredItem(itemId), affectedDocs: [] }),
      onFrame: () => {}
    });

    for (let i = 0; i < 50; i++) {
      queue.enqueue(`q${i}`, '');
    }
    expect(queue.pendingCount).toBe(50);

    expect(() => queue.enqueue('overflow', '')).toThrow(
      'Answer queue is full (50). Try again when the current turn finishes.'
    );
    expect(queue.pendingCount).toBe(50);
  });

  it('replaces a pending entry with the same itemId (single apply, latest answer)', async () => {
    const applied: Array<{ itemId: string; answer: string }> = [];
    const queue = new AnswerQueue({
      apply: async (itemId, answer) => {
        applied.push({ itemId, answer });
        return { ok: true, item: answeredItem(itemId), affectedDocs: [] };
      },
      onFrame: () => {}
    });

    const first = queue.enqueue('q1', 'first answer');
    const second = queue.enqueue('q1', 'revised answer');

    expect(first).toEqual({ queued: true, replaced: false });
    expect(second).toEqual({ queued: true, replaced: true });
    expect(queue.pendingCount).toBe(1);

    await queue.drain();

    expect(applied).toEqual([{ itemId: 'q1', answer: 'revised answer' }]);
  });

  it('guards re-entrancy: a second drain() while draining is a fast no-op', async () => {
    let releaseFirstApply!: () => void;
    const firstApplyGate = new Promise<void>(resolve => {
      releaseFirstApply = resolve;
    });
    const applyCalls: string[] = [];
    const queue = new AnswerQueue({
      apply: async itemId => {
        applyCalls.push(itemId);
        if (itemId === 'a') {
          await firstApplyGate;
        }
        return { ok: true, item: answeredItem(itemId), affectedDocs: [] };
      },
      onFrame: () => {}
    });

    queue.enqueue('a', '');
    queue.enqueue('b', '');

    const drain1 = queue.drain();
    expect(queue.isDraining).toBe(true);
    await vi.waitFor(() => expect(applyCalls).toEqual(['a']));

    // Second drain trigger while the first drain is mid-apply: must not overlap.
    const drain2 = queue.drain();

    releaseFirstApply();
    await Promise.all([drain1, drain2]);

    expect(applyCalls).toEqual(['a', 'b']);
    expect(queue.isDraining).toBe(false);
  });

  it('exposes isDraining only while a drain is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const queue = new AnswerQueue({
      apply: async itemId => {
        await gate;
        return { ok: true, item: answeredItem(itemId), affectedDocs: [] };
      },
      onFrame: () => {}
    });

    queue.enqueue('a', '');
    expect(queue.isDraining).toBe(false);

    const drainPromise = queue.drain();
    expect(queue.isDraining).toBe(true);

    release();
    await drainPromise;

    expect(queue.isDraining).toBe(false);
  });

  it('continues draining after a failed apply and emits answer_failed', async () => {
    const frames: AnswerFrameEvent[] = [];
    const applied: string[] = [];
    const queue = new AnswerQueue({
      apply: async itemId => {
        if (itemId === 'a') {
          return { ok: false, error: 'Critic still fails' };
        }
        applied.push(itemId);
        return { ok: true, item: answeredItem(itemId), affectedDocs: [] };
      },
      onFrame: ev => frames.push(ev)
    });

    queue.enqueue('a', '');
    queue.enqueue('b', '');
    await queue.drain();

    const failed = frames.find(f => f.kind === 'answer_failed' && f.itemId === 'a');
    expect(failed?.error).toBe('Critic still fails');
    expect(applied).toEqual(['b']);
  });

  it('continues draining even when deps.apply itself throws', async () => {
    const applied: string[] = [];
    const queue = new AnswerQueue({
      apply: async itemId => {
        if (itemId === 'a') {
          throw new Error('apply crashed');
        }
        applied.push(itemId);
        return { ok: true, item: answeredItem(itemId), affectedDocs: [] };
      },
      onFrame: () => {}
    });

    queue.enqueue('a', '');
    queue.enqueue('b', '');
    await queue.drain();

    expect(applied).toEqual(['b']);
    expect(queue.pendingCount).toBe(0);
  });

  it('emits applying → applied frames per item in FIFO order', async () => {
    const frames: AnswerFrameEvent[] = [];
    const queue = new AnswerQueue({
      apply: async itemId => ({ ok: true, item: answeredItem(itemId), affectedDocs: ['icd'] }),
      onFrame: ev => frames.push(ev)
    });

    queue.enqueue('a', '');
    queue.enqueue('b', '');
    await queue.drain();

    expect(frames.map(f => f.kind)).toEqual(['answer_applying', 'answer_applied', 'answer_applying', 'answer_applied']);
    expect(frames.filter(f => f.kind === 'answer_applied')).toEqual([
      { kind: 'answer_applied', itemId: 'a', item: answeredItem('a'), affectedDocs: ['icd'] },
      { kind: 'answer_applied', itemId: 'b', item: answeredItem('b'), affectedDocs: ['icd'] }
    ]);
  });
});