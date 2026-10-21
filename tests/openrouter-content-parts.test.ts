import { describe, it, expect } from 'vitest';
import { ChatMessage, ChatContentPart } from '../src/openrouter/types.js';

describe('ChatMessage content parts', () => {
  it('accepts image_url parts alongside text', () => {
    const parts: ChatContentPart[] = [
      { type: 'text', text: 'Transcribe page 1' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }
    ];
    const msg: ChatMessage = { role: 'user', content: parts };
    const payload = JSON.parse(JSON.stringify(msg));
    expect(payload.content[1].type).toBe('image_url');
    expect(payload.content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('still accepts plain string content', () => {
    const msg: ChatMessage = { role: 'user', content: 'hello' };
    expect(typeof msg.content).toBe('string');
  });
});