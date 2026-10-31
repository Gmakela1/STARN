import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { AVAILABLE_MODELS, STT_MODELS, fetchLiveOpenRouterModels, fetchTranscriptionModels } from '../src/openrouter/models.js';

describe('OpenRouter Models', () => {
  it('defines standard physical engineering compatible models', () => {
    expect(AVAILABLE_MODELS.length).toBeGreaterThan(0);
    expect(AVAILABLE_MODELS.some(m => m.id.includes('claude-3.5-sonnet'))).toBe(true);
  });

  it('fetches and formats live models from OpenRouter API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'anthropic/claude-3.5-sonnet',
            name: 'Anthropic: Claude 3.5 Sonnet',
            context_length: 200000,
            pricing: { prompt: '0.000003', completion: '0.000015' },
            description: 'Top tier model'
          },
          {
            id: 'meta-llama/llama-3.3-70b-instruct',
            name: 'Meta: Llama 3.3 70B',
            context_length: 131072,
            pricing: { prompt: '0.00000013', completion: '0.0000004' },
            description: 'Open weight model'
          }
        ]
      })
    });
    global.fetch = mockFetch;

    const models = await fetchLiveOpenRouterModels('sk-or-test-key');
    expect(models.length).toBe(2);
    expect(models[0].id).toBe('anthropic/claude-3.5-sonnet');
    expect(models[0].recommended).toBe(true);
    expect(models[0].contextLengthFormatted).toBe('200k ctx');
    expect(models[0].pricingFormatted).toContain('$3.00/$15.00');
  });

  it('falls back to AVAILABLE_MODELS when fetch fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
    global.fetch = mockFetch;

    const models = await fetchLiveOpenRouterModels('sk-or-test-key');
    expect(models.length).toBeGreaterThanOrEqual(AVAILABLE_MODELS.length);
    expect(models[0].id).toBe(AVAILABLE_MODELS[0].id);
  });
});

describe('fetchTranscriptionModels', () => {
  it('queries the transcription output modality and maps results', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'openai/whisper-large-v3-turbo',
            name: 'OpenAI: Whisper Large V3 Turbo',
            context_length: 8192,
            pricing: { prompt: '0.0000002', completion: '0' },
            description: 'Fast speech-to-text'
          }
        ]
      })
    });
    global.fetch = mockFetch;

    const models = await fetchTranscriptionModels('sk-or-test-key');
    expect(mockFetch.mock.calls[0][0]).toContain('output_modalities=transcription');
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-or-test-key');
    expect(models.length).toBe(1);
    expect(models[0].id).toBe('openai/whisper-large-v3-turbo');
    expect(models[0].name).toBe('OpenAI: Whisper Large V3 Turbo');
    expect(models[0].pricingFormatted).toContain('$0.20');
  });

  it('falls back to STT_MODELS when the fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    const models = await fetchTranscriptionModels();
    expect(models.map(m => m.id)).toEqual(STT_MODELS.map(m => m.id));
    expect(models[0].name).toBe(STT_MODELS[0].name);
  });

  it('falls back to STT_MODELS on non-OK response or empty list', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    expect((await fetchTranscriptionModels()).map(m => m.id)).toEqual(STT_MODELS.map(m => m.id));

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    expect((await fetchTranscriptionModels()).map(m => m.id)).toEqual(STT_MODELS.map(m => m.id));
  });

  it('STT_MODELS contains the seven known transcription models', () => {
    expect(STT_MODELS.map(m => m.id)).toEqual([
      'openai/whisper-large-v3-turbo',
      'openai/gpt-4o-transcribe',
      'openai/gpt-4o-mini-transcribe',
      'microsoft/mai-transcribe-2',
      'microsoft/mai-transcribe-1.5',
      'openai/whisper-large-v3',
      'openai/whisper-1'
    ]);
  });
});

describe('OpenRouter Client', () => {
  let client: OpenRouterClient;

  beforeEach(() => {
    client = new OpenRouterClient({
      apiKey: 'sk-or-test-key',
      siteUrl: 'https://test.starn.local',
      appName: 'STARN Unit Test'
    });
  });

  it('formats payload with OpenRouter specific headers and tools', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'gen-123',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello, physical engineer!'
            },
            finish_reason: 'stop'
          }
        ]
      })
    });
    global.fetch = mockFetch;

    const response = await client.chatCompletion({
      model: 'anthropic/claude-3.5-sonnet',
      messages: [{ role: 'user', content: 'Design solar frame' }]
    });

    expect(response.content).toBe('Hello, physical engineer!');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-or-test-key',
          'HTTP-Referer': 'https://test.starn.local',
          'X-Title': 'STARN Unit Test'
        })
      })
    );
  });

  it('handles tool calls returned by OpenRouter correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'gen-456',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'fs_read',
                    arguments: JSON.stringify({ path: 'docs/CONOPS.md' })
                  }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ]
      })
    });
    global.fetch = mockFetch;

    const response = await client.chatCompletion({
      model: 'anthropic/claude-3.5-sonnet',
      messages: [{ role: 'user', content: 'Check existing conops' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'fs_read',
            description: 'Read file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path']
            }
          }
        }
      ]
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].function.name).toBe('fs_read');
    expect(JSON.parse(response.toolCalls![0].function.arguments)).toEqual({ path: 'docs/CONOPS.md' });
  });

  it('throws helpful error message on API failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Invalid API Key'
    });
    global.fetch = mockFetch;

    await expect(
      client.chatCompletion({
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Hi' }]
      })
    ).rejects.toThrow('OpenRouter API error (401): Invalid API Key');
  });
});
