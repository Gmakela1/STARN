/**
 * Minimal typed event bus with live fan-out plus a capped reconnect-backfill
 * ring. I/O-agnostic core leaf: no http, no server/session imports.
 */
export class EventBus<T extends { kind: string }> {
  private subscribers: Array<(ev: T) => void> = [];
  private recent: T[] = [];
  private static readonly MAX_RECENT_EVENTS = 20;

  /** Registers a listener; returns an unsubscribe function. */
  subscribe(fn: (ev: T) => void): () => void {
    this.subscribers.push(fn);
    return () => {
      const idx = this.subscribers.indexOf(fn);
      if (idx >= 0) {
        this.subscribers.splice(idx, 1);
      }
    };
  }

  /**
   * Pushes the event into the backfill ring (unless the skipBackfill predicate
   * returns true) and always fans it out to live subscribers. Subscriber
   * errors are swallowed so one bad listener never breaks the fan-out.
   */
  publish(ev: T, opts?: { skipBackfill?: (ev: T) => boolean }): void {
    if (!opts?.skipBackfill?.(ev)) {
      this.recent.push(ev);
      if (this.recent.length > EventBus.MAX_RECENT_EVENTS) {
        this.recent.shift();
      }
    }
    for (const fn of this.subscribers) {
      try {
        fn(ev);
      } catch {
        // Subscriber error swallowed to prevent one bad subscriber from
        // breaking the entire fan-out.
      }
    }
  }

  /** FIFO ring snapshot (oldest first, newest last, capped at 20) for SSE reconnect backfill. */
  backfill(): T[] {
    return [...this.recent];
  }

  /** Empties the backfill ring. Live subscribers are unaffected. */
  clear(): void {
    this.recent = [];
  }
}