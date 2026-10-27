import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/core/event-bus.js';

interface Ev {
  kind: string;
  seq: number;
}

function ev(seq: number, kind: string = 'status'): Ev {
  return { kind, seq };
}

describe('EventBus', () => {
  it('fans out published events to all subscribers in subscription order', () => {
    const bus = new EventBus<Ev>();
    const a: Ev[] = [];
    const b: Ev[] = [];
    bus.subscribe(e => a.push(e));
    bus.subscribe(e => b.push(e));

    bus.publish(ev(1));
    bus.publish(ev(2));

    expect(a.map(e => e.seq)).toEqual([1, 2]);
    expect(b.map(e => e.seq)).toEqual([1, 2]);
  });

  it('unsubscribes via the returned function (no further events)', () => {
    const bus = new EventBus<Ev>();
    const a: Ev[] = [];
    const b: Ev[] = [];
    const unsubscribeA = bus.subscribe(e => a.push(e));
    bus.subscribe(e => b.push(e));

    bus.publish(ev(1));
    unsubscribeA();
    bus.publish(ev(2));

    expect(a.map(e => e.seq)).toEqual([1]);
    expect(b.map(e => e.seq)).toEqual([1, 2]);
  });

  it('backfills the last 20 events in FIFO order (newest last)', () => {
    const bus = new EventBus<Ev>();
    for (let i = 0; i < 25; i++) {
      bus.publish(ev(i));
    }

    const backfill = bus.backfill();
    expect(backfill).toHaveLength(20);
    expect(backfill[0].seq).toBe(5);
    expect(backfill[19].seq).toBe(24);
  });

  it('skipBackfill keeps live fan-out but skips the ring buffer', () => {
    const bus = new EventBus<Ev>();
    const live: Ev[] = [];
    bus.subscribe(e => live.push(e));

    bus.publish(ev(1), { skipBackfill: e => e.kind === 'skip' });
    bus.publish(ev(2, 'skip'), { skipBackfill: e => e.kind === 'skip' });
    bus.publish(ev(3), { skipBackfill: e => e.kind === 'skip' });

    expect(live.map(e => e.seq)).toEqual([1, 2, 3]);
    expect(bus.backfill().map(e => e.seq)).toEqual([1, 3]);
  });

  it('clear empties the ring buffer (live subscribers unaffected)', () => {
    const bus = new EventBus<Ev>();
    const live: Ev[] = [];
    bus.subscribe(e => live.push(e));

    bus.publish(ev(1));
    bus.clear();
    expect(bus.backfill()).toEqual([]);

    bus.publish(ev(2));
    expect(bus.backfill().map(e => e.seq)).toEqual([2]);
    expect(live.map(e => e.seq)).toEqual([1, 2]);
  });

  it('swallows a throwing subscriber so the other subscribers still receive events', () => {
    const bus = new EventBus<Ev>();
    const good: Ev[] = [];
    bus.subscribe(() => {
      throw new Error('bad subscriber');
    });
    bus.subscribe(e => good.push(e));

    expect(() => bus.publish(ev(1))).not.toThrow();
    expect(good.map(e => e.seq)).toEqual([1]);
  });
});