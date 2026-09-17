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
