import { ChatCompletionOptions, ChatCompletionResult, TranscriptionResult } from './types.js';
import { Logger } from '../util/logger.js';

export interface OpenRouterClientOptions {
  apiKey: string;
  siteUrl?: string;
  appName?: string;
  baseUrl?: string;
  logger?: Logger;
}

export class OpenRouterClient {
  private apiKey: string;
  private siteUrl: string;
  private appName: string;
  private baseUrl: string;
  private logger?: Logger;
  private backoffMs: number[] = [1000, 2000, 4000];

  constructor(options: OpenRouterClientOptions) {
    this.apiKey = options.apiKey;
    this.siteUrl = options.siteUrl || 'https://github.com/makel/STARN';
    this.appName = options.appName || 'STARN PM Agent';
    this.baseUrl = options.baseUrl || 'https://openrouter.ai/api/v1/chat/completions';
    this.logger = options.logger;
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured.');
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // An aborted signal means the user cancelled — never retry.
      if (options.signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      try {
        return await this._doRequest(options);
      } catch (err: any) {
        lastError = err;
        // Aborts are user-initiated; do not retry.
        if (err.name === 'AbortError') {
          throw err;
        }
        const isRetryable = this._isRetryableError(err);
        if (!isRetryable || attempt >= maxRetries) {
          throw err;
        }
        const delay = this.backoffMs[attempt] || 4000;
        const retryAfter = this._extractRetryAfter(err);
        const waitMs = retryAfter !== null ? retryAfter : delay;
        this.logger?.warn(`OpenRouter ${attempt === 0 ? 'request' : 'retry ' + attempt} failed (${err.message}). Retrying in ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    throw lastError || new Error('Retry loop exhausted');
  }

  private async _doRequest(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
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
      body: JSON.stringify(payload),
      signal: options.signal
    });

    if (!res.ok) {
      const errorText = await res.text();
      const err = new Error(`OpenRouter API error (${res.status}): ${errorText}`);
      (err as any).status = res.status;
      const retryAfterHeader = (res.headers && typeof res.headers.get === 'function')
        ? res.headers.get('Retry-After')
        : null;
      (err as any).retryAfter = this._parseRetryAfter(retryAfterHeader);
      throw err;
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

  private _isRetryableError(err: any): boolean {
    const status = err.status;
    if (status === 429) return true;
    if (status && status >= 500 && status < 600) return true;
    if (!status && err.message && /fetch|network|ECONN/i.test(err.message)) return true;
    return false;
  }

  private _extractRetryAfter(err: any): number | null {
    if (err.retryAfter !== undefined && err.retryAfter !== null) {
      return err.retryAfter * 1000;
    }
    return null;
  }

  private _parseRetryAfter(value: string | null): number | null {
    if (!value) return null;
    const seconds = Number.parseInt(value, 10);
    if (!Number.isNaN(seconds)) return seconds;
    return null;
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