import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { isVoiceCommand } from '../src/cli/voice.js';

describe('Voice Transcription', () => {
  let client: OpenRouterClient;

  beforeEach(() => {
    client = new OpenRouterClient({ apiKey: 'sk-or-test-key' });
  });

  it('transcribeAudio sends multipart form to OpenRouter Whisper and returns text', async () => {
    const mockAudioBuffer = Buffer.from('fake-wav-data');
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts: any) => {
      capturedUrl = url as string;
      capturedHeaders = opts.headers as Record<string, string>;
      capturedBody = opts.body;
      return {
        ok: true,
        json: async () => ({ text: 'Redo the conops document with the new battery voltage' })
      } as any;
    });

    const result = await client.transcribeAudio(mockAudioBuffer);

    expect(result.text).toBe('Redo the conops document with the new battery voltage');
    expect(capturedUrl).toContain('audio/transcriptions');
    expect(capturedHeaders['Authorization']).toBe('Bearer sk-or-test-key');
    // Verify it's a multipart form (FormData)
    expect(capturedBody instanceof FormData).toBe(true);
  });

  it('transcribeAudio throws on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    } as any);

    await expect(client.transcribeAudio(Buffer.from('test'))).rejects.toThrow('OpenRouter transcription error (401)');
  });

  it('transcribeAudio throws on empty response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: '' })
    } as any);

    await expect(client.transcribeAudio(Buffer.from('test'))).rejects.toThrow('Empty transcription result');
  });

  it('isVoiceCommand detects /voice prefix', () => {
    expect(isVoiceCommand('/voice')).toBe(true);
    expect(isVoiceCommand('/voice ')).toBe(true);
    expect(isVoiceCommand('/voice  redo the conops')).toBe(true);
    expect(isVoiceCommand('redo the conops')).toBe(false);
    expect(isVoiceCommand('/plan')).toBe(false);
    expect(isVoiceCommand('')).toBe(false);
  });

  it('isVoiceCommand detects alt+v prefix', () => {
    expect(isVoiceCommand('\x00v')).toBe(true);
    expect(isVoiceCommand('\x00\x00')).toBe(false);
  });
});