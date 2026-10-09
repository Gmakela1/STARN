import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAICompatClient, OpenRouterClient } from '../src/openrouter/client.js';

const okResponse = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });

function stubFetch(impl?: (...args: any[]) => any) {
  const f = vi.fn(impl ?? (async () => okResponse()));
  vi.stubGlobal('fetch', f);
  return f;
}

const msg = [{ role: 'user' as const, content: 'hi' }];

describe('OpenAICompatClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to <baseUrl>/chat/completions and strips trailing slash', async () => {
    const f = stubFetch();
    const c = new OpenAICompatClient({ providerName: 'Ollama', baseUrl: 'http://h:1/v1/' });
    await c.chatCompletion({ model: 'm', messages: msg });
    expect(f.mock.calls[0][0]).toBe('http://h:1/v1/chat/completions');
  });

  it('omits Authorization when no apiKey', async () => {
    const f = stubFetch();
    await new OpenAICompatClient({ providerName: 'Ollama', baseUrl: 'http://h:1/v1' }).chatCompletion({ model: 'm', messages: msg });
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('omits HTTP-Referer/X-Title unless openRouterHeaders', async () => {
    const f = stubFetch();
    await new OpenAICompatClient({ providerName: 'LM', baseUrl: 'http://h:1/v1', apiKey: 'k' }).chatCompletion({ model: 'm', messages: msg });
    const h = f.mock.calls[0][1].headers;
    expect(h.Authorization).toBe('Bearer k');
    expect(h['HTTP-Referer']).toBeUndefined();
    expect(h['X-Title']).toBeUndefined();

    await new OpenRouterClient({ apiKey: 'k' }).chatCompletion({ model: 'm', messages: msg });
    const h2 = f.mock.calls[1][1].headers;
    expect(f.mock.calls[1][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(h2['HTTP-Referer']).toBeDefined();
    expect(h2['X-Title']).toBeDefined();
  });

  it('passes tool_choice through', async () => {
    const f = stubFetch();
    const tool_choice = { type: 'function' as const, function: { name: 'ping' } };
    await new OpenAICompatClient({ providerName: 'X', baseUrl: 'http://h:1/v1' }).chatCompletion({ model: 'm', messages: msg, tool_choice });
    expect(JSON.parse(f.mock.calls[0][1].body).tool_choice).toEqual(tool_choice);
  });

  it('network failure reports provider name and URL', async () => {
    stubFetch(async () => { throw new TypeError('fetch failed'); });
    const c = new OpenAICompatClient({ providerName: 'Ollama', baseUrl: 'http://h:1/v1' });
    (c as any).backoffMs = [1, 1, 1];
    await expect(c.chatCompletion({ model: 'm', messages: msg })).rejects.toThrow(
      'Provider "Ollama" unreachable at http://h:1/v1: fetch failed'
    );
  });

  it('non-2xx error names the provider', async () => {
    stubFetch(async () => new Response('bad model', { status: 400 }));
    const c = new OpenAICompatClient({ providerName: 'Ollama', baseUrl: 'http://h:1/v1' });
    await expect(c.chatCompletion({ model: 'm', messages: msg })).rejects.toThrow('Ollama API error (400): bad model');
  });

  it('OpenRouterClient without key still throws OPENROUTER_API_KEY is not configured.', async () => {
    stubFetch();
    await expect(new OpenRouterClient({ apiKey: '' }).chatCompletion({ model: 'm', messages: msg })).rejects.toThrow(
      'OPENROUTER_API_KEY is not configured.'
    );
  });
});
