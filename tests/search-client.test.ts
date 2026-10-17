import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSearchClient } from '../src/tools/search/search-client.js';
import { StarnConfig } from '../src/config.js';

describe('Search Client & Providers', () => {
  const baseConfig: StarnConfig = {
    apiKey: 'sk-or-v1-test',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    compressionThreshold: 80000,
    keepRecentTokens: 20000,
    siteUrl: 'http://localhost',
    appName: 'STARN',
    globalDir: '/tmp/.starn',
    providers: [],
    assignments: {
      drafting: { providerId: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
      critic: { providerId: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
      classifier: { providerId: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
      compaction: { providerId: 'openrouter', model: 'anthropic/claude-3.5-sonnet' }
    },
    search: {
      provider: 'openrouter'
    }
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('searches via Tavily provider when configured', async () => {
    const config: StarnConfig = {
      ...baseConfig,
      search: {
        provider: 'tavily',
        tavilyApiKey: 'tvly-test-123'
      }
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: 'Motenergy ME1115 BLDC Motor',
            url: 'https://example.com/me1115',
            content: '72V 12kW peak brushless DC motor with 28 Nm continuous torque.'
          }
        ]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = createSearchClient(config);
    const res = await client.search('ME1115 motor specs', 3);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0];
    const callInit = mockFetch.mock.calls[0][1];
    expect(callUrl).toBe('https://api.tavily.com/search');
    expect(callInit.method).toBe('POST');
    const body = JSON.parse(callInit.body);
    expect(body.api_key).toBe('tvly-test-123');
    expect(body.query).toBe('ME1115 motor specs');
    expect(body.max_results).toBe(3);

    expect(res.provider).toBe('tavily');
    expect(res.results).toHaveLength(1);
    expect(res.results[0].title).toBe('Motenergy ME1115 BLDC Motor');
    expect(res.results[0].url).toBe('https://example.com/me1115');
  });

  it('searches via Brave provider when configured', async () => {
    const config: StarnConfig = {
      ...baseConfig,
      search: {
        provider: 'brave',
        braveApiKey: 'BSA-test-key'
      }
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        web: {
          results: [
            {
              title: 'Kelly KLS7245N Controller',
              url: 'https://example.com/kelly',
              description: '72V 450A sinusoidal motor controller.'
            }
          ]
        }
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = createSearchClient(config);
    const res = await client.search('Kelly KLS7245N', 5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0];
    const callInit = mockFetch.mock.calls[0][1];
    expect(callUrl).toContain('https://api.search.brave.com/res/v1/web/search');
    expect(callInit.headers['X-Subscription-Token']).toBe('BSA-test-key');

    expect(res.provider).toBe('brave');
    expect(res.results).toHaveLength(1);
    expect(res.results[0].title).toBe('Kelly KLS7245N Controller');
  });

  it('searches via OpenRouter server tool as zero-config default', async () => {
    const config: StarnConfig = {
      ...baseConfig,
      search: {
        provider: 'openrouter'
      }
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Found parts:\n- [Motenergy ME1115](https://example.com/me1115): 72V 12kW peak motor.\n- [Kelly KLS](https://example.com/kelly): 72V 450A controller.'
            }
          }
        ]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = createSearchClient(config);
    const res = await client.search('electric tractor motor 72V', 5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callInit = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callInit.body);
    expect(body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'openrouter:web_search' })
      ])
    );

    expect(res.provider).toBe('openrouter');
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].url).toBe('https://example.com/me1115');
  });

  it('falls back to OpenRouter if Tavily is configured without an API key', async () => {
    const config: StarnConfig = {
      ...baseConfig,
      search: {
        provider: 'tavily',
        tavilyApiKey: ''
      }
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '- [Sample Motor](https://example.com/motor): High torque'
            }
          }
        ]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = createSearchClient(config);
    const res = await client.search('motor', 2);
    expect(res.provider).toBe('openrouter');
  });
});
