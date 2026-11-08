// Plan-frame behaviour of the autopilot SSE hook (spec §7.4, §12.6): a `plan`
// frame is collected and forwarded, never merged into the status object.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAutopilotEvents, type AutopilotPlanEvent } from './useAutopilotEvents';

vi.mock('../api/client', () => ({
  api: {
    fetchAutopilotStatus: vi.fn().mockResolvedValue({
      enabled: false,
      running: false,
      docStatus: {},
      blocks: 0,
      passedCount: 0,
      totalPhases: 13
    }),
    fetchPortalItems: vi.fn().mockResolvedValue({ items: [] })
  }
}));

/** One SSE frame on the `autopilot` stream, wrapped as the server writes it. */
function frame(ev: unknown): string {
  return `event: autopilot\ndata: ${JSON.stringify({ status: ev })}\n\n`;
}

/** Plan event fixture — one known and one unknown claim. */
function planEvent(specialist: string): AutopilotPlanEvent {
  return {
    kind: 'plan',
    specialist,
    docId: 'p1',
    itemId: 'q1',
    order: ['Draft the chart'],
    claims: [
      { claim: 'Fuse rating', status: 'known', source: 'requirements.md §3' },
      { claim: 'Motor rating', status: 'unknown', question: 'Motor continuous rating?', likelyAt: 'ME1115.pdf' }
    ]
  };
}

/** A body whose reader stays open; the test pushes frames into it. */
function openStream(): { body: ReadableStream<Uint8Array>; push: (text: string) => void } {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    }
  });
  return {
    body,
    push(text: string) {
      controller?.enqueue(new TextEncoder().encode(text));
    }
  };
}

/** Push frames, then let the hook's promise chain drain inside `act`. */
async function push(stream: { push: (text: string) => void }, text: string): Promise<void> {
  await act(async () => {
    stream.push(text);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

let stream: ReturnType<typeof openStream>;

beforeEach(() => {
  stream = openStream();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, body: stream.body }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useAutopilotEvents — plan frames', () => {
  it('does not mutate autopilotStatus and does append to plans', async () => {
    const onPlan = vi.fn();
    const { result } = renderHook(() => useAutopilotEvents(undefined, onPlan));

    await push(stream, frame({ kind: 'start', total: 3 }));
    const statusBefore = result.current.status;
    expect(statusBefore).not.toBeNull();

    await push(stream, frame(planEvent('systems-engineer')));

    // The status object is the same reference — no `claims[]` leaked into it.
    expect(result.current.status).toBe(statusBefore);
    expect((result.current.status as unknown as Record<string, unknown>).claims).toBeUndefined();
    expect(Object.keys(result.current.status ?? {})).not.toContain('claims');

    expect(result.current.plans).toHaveLength(1);
    expect(result.current.plans[0].specialist).toBe('systems-engineer');
    expect(result.current.plans[0].claims).toHaveLength(2);
    expect(onPlan).toHaveBeenCalledTimes(1);
    expect(onPlan.mock.calls[0][0].kind).toBe('plan');
  });

  it('caps plans at 20, newest last', async () => {
    const { result } = renderHook(() => useAutopilotEvents());

    let frames = '';
    for (let i = 1; i <= 21; i += 1) frames += frame(planEvent(`s${i}`));
    await push(stream, frames);

    expect(result.current.plans).toHaveLength(20);
    expect(result.current.plans[0].specialist).toBe('s2');
    expect(result.current.plans[19].specialist).toBe('s21');
  });
});
