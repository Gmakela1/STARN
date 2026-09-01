import { ChatCompletionOptions, ChatCompletionResult, TranscriptionResult } from './types.js';

export interface OpenRouterClientOptions {
  apiKey: string;
  siteUrl?: string;
  appName?: string;
  baseUrl?: string;
}

export class OpenRouterClient {
  private apiKey: string;
  private siteUrl: string;
  private appName: string;
  private baseUrl: string;

  constructor(options: OpenRouterClientOptions) {
    this.apiKey = options.apiKey;
    this.siteUrl = options.siteUrl || 'https://github.com/makel/STARN';
    this.appName = options.appName || 'STARN PM Agent';
    this.baseUrl = options.baseUrl || 'https://openrouter.ai/api/v1/chat/completions';
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'HTTP-Referer': this.siteUrl,
      'X-Title': this.appName
    };

    const payload: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2
    };

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools;
    }
    if (options.max_tokens) {
      payload.max_tokens = options.max_tokens;
    }

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenRouter API error (${res.status}): ${errorText}`);
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error('Invalid response structure from OpenRouter API');
    }

    return {
      content: choice.message.content ?? null,
      toolCalls: choice.message.tool_calls || undefined,
      raw: data
    };
  }

  async transcribeAudio(audioBuffer: Buffer, filename: string = 'recording.wav'): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured.');
    }

    const transcriptionUrl = this.baseUrl.replace('/chat/completions', '/audio/transcriptions');

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('file', blob, filename);
    formData.append('model', 'openai/whisper-large-v3');

    const res = await fetch(transcriptionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.siteUrl,
        'X-Title': this.appName
      },
      body: formData
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenRouter transcription error (${res.status}): ${errorText}`);
    }

    const data = await res.json() as any;
    if (!data.text || !data.text.trim()) {
      throw new Error('Empty transcription result');
    }

    return { text: data.text.trim() };
  }
}