import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolExecutionContext } from '../src/tools/types.js';
import { SearchClient } from '../src/tools/search/types.js';

describe('web_search Tool Handler', () => {
  it('executes search through SearchClient and formats results', async () => {
    const registry = new ToolRegistry();

    const mockSearchClient: SearchClient = {
      search: vi.fn().mockResolvedValue({
        provider: 'tavily',
        query: 'Motenergy ME1115',
        results: [
          {
            title: 'Motenergy ME1115 Motor Specs',
            url: 'https://example.com/me1115',
            snippet: '72V 12kW peak motor specifications and drawing.'
          }
        ]
      })
    };

    const context: ToolExecutionContext = {
      projectPath: '/tmp/test',
      stateManager: {} as any,
      searchClient: mockSearchClient
    };

    const res = await registry.execute(
      'web_search',
      { query: 'Motenergy ME1115', maxResults: 3 },
      context,
      ['web_search']
    );

    expect(res.success).toBe(true);
    expect(res.result).toContain('Motenergy ME1115 Motor Specs');
    expect(res.result).toContain('https://example.com/me1115');
    expect(mockSearchClient.search).toHaveBeenCalledWith('Motenergy ME1115', 3);
  });

  it('rejects empty query', async () => {
    const registry = new ToolRegistry();
    const context: ToolExecutionContext = {
      projectPath: '/tmp/test',
      stateManager: {} as any
    };

    const res = await registry.execute(
      'web_search',
      { query: '' },
      context,
      ['web_search']
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/query is required/i);
  });

  it('enforces specialist scoping: fails if tool not allowed', async () => {
    const registry = new ToolRegistry();
    const context: ToolExecutionContext = {
      projectPath: '/tmp/test',
      stateManager: {} as any
    };

    const res = await registry.execute(
      'web_search',
      { query: 'test' },
      context,
      ['fs_read', 'fs_write'] // web_search is omitted
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('not permitted');
  });
});
