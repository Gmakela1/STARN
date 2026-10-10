import { describe, it, expect, vi, afterEach } from 'vitest';
import { listProviderModels, probeToolCalling } from '../src/models/provider-models.js';
import { ChatClient } from '../src/openrouter/types.js';

const p = { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1/' };

describe('listProviderModels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns data[].id from GET <baseUrl>/models', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'qwen' }, { id: 'llama' }] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await listProviderModels(p)).toEqual(['qwen', 'llama']);
    expect((f.mock.calls[0] as any[])[0]).toBe('http://localhost:11434/v1/models');
  });

  it('error message includes URL tried on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(listProviderModels(p)).rejects.toThrow('http://localhost:11434/v1/models');
  });

  it('error message includes URL tried when unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(listProviderModels(p)).rejects.toThrow('Provider "Ollama" unreachable at http://localhost:11434/v1/models: fetch failed');
  });
});

describe('probeToolCalling', () => {
  const fake = (impl: ChatClient['chatCompletion']) => {
    const chatCompletion = vi.fn(impl);
    return { client: { chatCompletion } as ChatClient, chatCompletion };
  };

  it('ok when tool_calls contains ping', async () => {
    const { client, chatCompletion } = fake(async () => ({
      content: null,
      toolCalls: [{ id: '1', type: 'function', function: { name: 'ping', arguments: '{}' } }],
      raw: {}
    }));
    const r = await probeToolCalling(client, 'qwen');
    expect(r.ok).toBe(true);
    const req = chatCompletion.mock.calls[0][0];
    expect(req.model).toBe('qwen');
    expect(req.tool_choice).toEqual({ type: 'function', function: { name: 'ping' } });
    expect(req.tools?.[0].function.name).toBe('ping');
  });

  it('not ok when content only', async () => {
    const { client } = fake(async () => ({ content: 'pong', raw: {} }));
    expect(await probeToolCalling(client, 'qwen')).toEqual({ ok: false, detail: 'Model returned text, not a tool call' });
  });

  it('not ok on throw', async () => {
    const { client } = fake(async () => { throw new Error('boom'); });
    expect(await probeToolCalling(client, 'qwen')).toEqual({ ok: false, detail: 'boom' });
  });
});
