import { describe, it, expect, vi } from 'vitest';
import { estimateTokens, serializeConversation, maybeCompact } from '../src/core/compaction.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { ChatMessage } from '../src/openrouter/types.js';

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a'.repeat(400) }
    ];
    expect(estimateTokens(messages)).toBe(100);
  });

  it('handles empty messages', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('sums across multiple messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'a'.repeat(200) },
      { role: 'user', content: 'b'.repeat(200) }
    ];
    expect(estimateTokens(messages)).toBe(100);
  });
});

describe('serializeConversation', () => {
  it('serializes messages to labeled text', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' }
    ];
    const text = serializeConversation(messages);
    expect(text).toContain('[User]: Hello');
    expect(text).toContain('[Assistant]: Hi there');
  });

  it('truncates tool results to 2000 chars', () => {
    const longResult = 'x'.repeat(5000);
    const messages: ChatMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fs_read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', name: 'fs_read', content: longResult }
    ];
    const text = serializeConversation(messages);
    expect(text).toContain('[Tool result]:');
    expect(text.length).toBeLessThan(longResult.length + 200);
    expect(text).toContain('truncated');
  });
});

describe('maybeCompact', () => {
  it('does not compact when under threshold', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'short' }
    ];
    const result = await maybeCompact({
      client: mockClient,
      messages,
      compactionModel: 'test-model',
      threshold: 100000,
      keepRecentTokens: 20000
    });
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it('compacts when over threshold, keeping recent messages and a summary', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '## Goal\nTest summary\n## Progress\n- [x] done',
      raw: {}
    });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a'.repeat(5000) },
      { role: 'assistant', content: 'b'.repeat(5000) },
      { role: 'user', content: 'recent short' },
      { role: 'assistant', content: 'recent reply' }
    ];
    const result = await maybeCompact({
      client: mockClient,
      messages,
      compactionModel: 'test-model',
      threshold: 1000,
      keepRecentTokens: 50
    });
    expect(result.compacted).toBe(true);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[1].content).toContain('Test summary');
    expect(result.messages.some(m => m.content === 'recent short')).toBe(true);
  });
});
