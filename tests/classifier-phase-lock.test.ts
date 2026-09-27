import { describe, it, expect, vi } from 'vitest';
import { classifyRequest, detectPhaseSwitchRequest } from '../src/core/classifier.js';
import { OpenRouterClient } from '../src/openrouter/client.js';

describe('classifyRequest precedence', () => {
  it('uses LLM classifier result when it returns valid JSON', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId":"bom","reason":"user wants BOM"}',
      raw: {}
    });
    const result = await classifyRequest('draft the bill of materials', mockClient, 'test-model', 'conops');
    expect(result).toBe('bom');
  });

  it('falls back to active phase on generic edit verb when LLM fails', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockRejectedValue(new Error('network down'));
    const result = await classifyRequest('update the battery section', mockClient, 'test-model', 'bom');
    expect(result).toBe('bom'); // routed to active phase via generic verb fallback
  });

  it('does NOT hardcode tractor nouns in the fallback', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockRejectedValue(new Error('down'));
    // "battery" alone (a tractor noun) without an edit verb should NOT lock to active phase
    const result = await classifyRequest('what battery options exist', mockClient, 'test-model', 'bom');
    expect(result).toBe('general'); // informational query → general
  });

  it('detectPhaseSwitchRequest no longer matches tractor nouns as phase switches', () => {
    expect(detectPhaseSwitchRequest('redo the battery')).toBeNull();
    expect(detectPhaseSwitchRequest('switch to bom')).toBe('bom');
  });
});

describe('classifyRequest with conversation history', () => {
  it('includes recent messages in the classifier prompt when provided', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    const spy = vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId":"conops","reason":"user answering prior question"}',
      raw: {}
    });
    const recentMessages = [
      { role: 'user', content: 'draft the conops' },
      { role: 'assistant', content: 'Should the mower deck use the PTO or an independent motor?' }
    ] as any;

    const result = await classifyRequest(
      'use the PTO',
      mockClient,
      'test-model',
      'conops',
      recentMessages,
      'conops'
    );

    expect(result).toBe('conops');
    // The classifier prompt must include the recent conversation context
    const callArg = spy.mock.calls[0][0];
    const promptContent = callArg.messages[0].content;
    expect(promptContent).toContain('Should the mower deck use the PTO');
    expect(promptContent).toContain('use the PTO');
    expect(promptContent).toContain('Last active specialist');
    expect(promptContent).toContain('conops');
  });

  it('routes a short reply to the last active specialist based on conversational context', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    // The LLM sees the Q&A context and routes to conops (the last active specialist)
    vi.spyOn(mockClient, 'chatCompletion').mockImplementation(async (opts: any) => {
      const prompt = opts.messages[0].content;
      // Verify the history was passed; route to conops because it's a short answer
      if (prompt.includes('Should the mower deck use the PTO')) {
        return { content: '{"specialistId":"conops","reason":"short answer to prior question"}', raw: {} } as any;
      }
      return { content: '{"specialistId":"general","reason":"no context"}', raw: {} } as any;
    });

    const recentMessages = [
      { role: 'user', content: 'draft the conops' },
      { role: 'assistant', content: 'Should the mower deck use the PTO or an independent motor?' }
    ] as any;

    const result = await classifyRequest(
      'use the PTO',
      mockClient,
      'test-model',
      'conops',
      recentMessages,
      'conops'
    );

    expect(result).toBe('conops');
  });

  it('works without recent messages (backward-compatible)', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId":"bom","reason":"user wants BOM"}',
      raw: {}
    });
    const result = await classifyRequest('draft the bill of materials', mockClient, 'test-model', 'conops');
    expect(result).toBe('bom');
  });

  it('truncates long messages in the history slice to keep the classifier prompt compact', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    const spy = vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId":"conops","reason":"ok"}',
      raw: {}
    });
    const longDoc = '# CONOPS\n\n' + 'x'.repeat(2000);
    const recentMessages = [
      { role: 'assistant', content: longDoc }
    ] as any;

    await classifyRequest('update it', mockClient, 'test-model', 'conops', recentMessages, 'conops');

    const promptContent = spy.mock.calls[0][0].messages[0].content;
    // The long message must be truncated — the full 2000-char run of 'x' is absent,
    // and the truncation marker is present.
    expect(promptContent).not.toContain('x'.repeat(2000));
    expect(promptContent).toContain('[truncated]');
  });

  it('strips tool_calls from history messages (irrelevant to routing)', async () => {
    const mockClient = new OpenRouterClient({ apiKey: 'mock' });
    const spy = vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId":"conops","reason":"ok"}',
      raw: {}
    });
    const recentMessages = [
      { role: 'assistant', content: 'thinking', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'fs_write', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', name: 'fs_write', content: 'wrote file' }
    ] as any;

    await classifyRequest('looks good', mockClient, 'test-model', 'conops', recentMessages, 'conops');

    const promptContent = spy.mock.calls[0][0].messages[0].content;
    // Tool call metadata must not bloat the classifier prompt
    expect(promptContent).not.toContain('tool_calls');
    expect(promptContent).not.toContain('call_1');
  });
});
