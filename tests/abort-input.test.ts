import { describe, it, expect, vi } from 'vitest';
import { attachAbortListener } from '../src/util/abort-input.js';

describe('attachAbortListener (ESC to abort)', () => {
  it('aborts the controller when the ESC byte arrives on stdin', () => {
    const controller = new AbortController();
    const listeners: Record<string, (...args: any[]) => void> = {};
    const fakeStdin = {
      isTTY: true,
      setRawMode: vi.fn(),
      on: vi.fn((event: string, cb: (...args: any[]) => void) => {
        listeners[event] = cb;
      }),
      off: vi.fn((event: string) => {
        delete listeners[event];
      }),
      resume: vi.fn(),
      pause: vi.fn()
    };

    const detach = attachAbortListener(controller, fakeStdin as any);

    expect(fakeStdin.setRawMode).toHaveBeenCalledWith(true);
    expect(listeners['data']).toBeDefined();

    // Simulate ESC byte
    listeners['data'](Buffer.from('\x1b', 'utf-8'));
    expect(controller.signal.aborted).toBe(true);

    detach();
    expect(fakeStdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it('is a no-op when stdin does not support raw mode (piped/non-TTY)', () => {
    const controller = new AbortController();
    const fakeStdin = {
      isTTY: false,
      setRawMode: vi.fn(() => { throw new Error('not a TTY'); }),
      on: vi.fn(),
      off: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn()
    };

    const detach = attachAbortListener(controller, fakeStdin as any);
    // No raw mode set, no listener attached
    expect(fakeStdin.setRawMode).not.toHaveBeenCalledWith(true);
    expect(controller.signal.aborted).toBe(false);
    // detach is a safe no-op
    expect(() => detach()).not.toThrow();
  });

  it('ignores non-ESC bytes', () => {
    const controller = new AbortController();
    const listeners: Record<string, (...args: any[]) => void> = {};
    const fakeStdin = {
      isTTY: true,
      setRawMode: vi.fn(),
      on: vi.fn((event: string, cb: (...args: any[]) => void) => { listeners[event] = cb; }),
      off: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn()
    };

    attachAbortListener(controller, fakeStdin as any);

    // Send a regular character
    listeners['data'](Buffer.from('a', 'utf-8'));
    expect(controller.signal.aborted).toBe(false);
  });

  it('is idempotent — aborting twice does not throw', () => {
    const controller = new AbortController();
    const listeners: Record<string, (...args: any[]) => void> = {};
    const fakeStdin = {
      isTTY: true,
      setRawMode: vi.fn(),
      on: vi.fn((event: string, cb: (...args: any[]) => void) => { listeners[event] = cb; }),
      off: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn()
    };

    attachAbortListener(controller, fakeStdin as any);
    listeners['data'](Buffer.from('\x1b', 'utf-8'));
    expect(() => listeners['data'](Buffer.from('\x1b', 'utf-8'))).not.toThrow();
  });
});
