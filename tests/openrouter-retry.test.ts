import { describe, it, expect, vi } from 'vitest';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { Logger } from '../src/util/logger.js';
import os from 'node:os';
import path from 'node:path';

describe('OpenRouterClient retry', () => {
  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const mockFetch = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        return new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', mockFetch);

    const logger = new Logger(path.join(os.tmpdir(), 'starn-retry-test-' + Date.now()));
    const client = new OpenRouterClient({ apiKey: 'mock', logger });
    // Speed up the test by overriding backoff delays
    (client as any).backoffMs = [10, 20, 40];

    const result = await client.chatCompletion({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }]
    });

    expect(result.content).toBe('ok');
    expect(calls).toBe(3);
    vi.unstubAllGlobals();
  });

  it('throws after max retries on persistent 500', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response('server error', { status: 500 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new OpenRouterClient({ apiKey: 'mock' });
    (client as any).backoffMs = [10, 20, 40];

    await expect(client.chatCompletion({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toThrow(/OpenRouter API error \(500\)/);

    expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
    vi.unstubAllGlobals();
  });
});

describe('OpenRouterClient abort via signal', () => {
  it('does not retry when the signal is already aborted', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new OpenRouterClient({ apiKey: 'mock' });
    (client as any).backoffMs = [10, 20, 40];
    const controller = new AbortController();
    controller.abort();

    await expect(client.chatCompletion({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal
    })).rejects.toThrow();

    // The pre-call guard aborts before fetch is ever invoked.
    expect(mockFetch).toHaveBeenCalledTimes(0);
    vi.unstubAllGlobals();
  });

  it('aborts an in-flight fetch and does not retry', async () => {
    const controller = new AbortController();
    const mockFetch = vi.fn((_url: string, opts: any) => {
      // Simulate real fetch: a pending request that rejects when the signal aborts.
      return new Promise((_resolve, reject) => {
        if (opts.signal?.aborted) {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          return reject(e);
        }
        opts.signal?.addEventListener('abort', () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new OpenRouterClient({ apiKey: 'mock' });
    (client as any).backoffMs = [10, 20, 40];

    const p = client.chatCompletion({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal
    });
    // Abort mid-flight.
    controller.abort();
    await expect(p).rejects.toThrow();
    // Should not have retried (AbortError is not retryable).
    expect(mockFetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
