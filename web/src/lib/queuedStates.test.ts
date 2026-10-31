import { describe, it, expect } from 'vitest';
import { deriveQueuedAnswerStates } from './queuedStates';
import type { PortalItem } from '../types/api';

function item(overrides: Partial<PortalItem> = {}): PortalItem {
  return {
    id: 'q1',
    type: 'question',
    severity: 'normal',
    title: 'Question',
    status: 'open',
    source: 'autopilot',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('deriveQueuedAnswerStates', () => {
  it('seeds a queued state for items whose meta marks a pending queue entry', () => {
    const states = deriveQueuedAnswerStates([
      item({ id: 'a', meta: { answerQueued: true } }),
      item({ id: 'b' })
    ]);

    expect(Object.keys(states)).toEqual(['a']);
    expect(states.a).toEqual({ phase: 'queued' });
  });

  it('never downgrades an existing live state back to queued', () => {
    const states = deriveQueuedAnswerStates(
      [item({ id: 'a', meta: { answerQueued: true } })],
      { a: { phase: 'applying' }, b: { phase: 'applied' } }
    );

    expect(states.a).toEqual({ phase: 'applying' });
    expect(states.b).toEqual({ phase: 'applied' });
  });

  it('keeps pre-existing states for items without the marker', () => {
    const states = deriveQueuedAnswerStates([item({ id: 'c' })], {
      c: { phase: 'failed', error: 'boom' }
    });

    expect(states.c).toEqual({ phase: 'failed', error: 'boom' });
  });
});
