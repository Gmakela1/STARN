import { ChatClient, ChatCompletionOptions, ChatCompletionResult, TranscriptionResult } from './types.js';
import { Logger } from '../util/logger.js';

export const OPENROUTER_API_ROOT = 'https://openrouter.ai/api/v1';

export interface OpenAICompatClientOptions {
  /** Human-readable provider name used in errors and logs. */
  providerName: string;
  /** API root, e.g. http://localhost:11434/v1 (trailing slash tolerated). */
  baseUrl: string;
  apiKey?: string;
  /** Send OpenRouter attribution headers (HTTP-Referer, X-Title). */
  openRouterHeaders?: boolean;
  siteUrl?: string;
  appName?: string;
  logger?: Logger;
}

/**
 * Provider-agnostic client for any OpenAI-compatible chat completions API
 * (OpenRouter, Ollama, LM Studio, llama.cpp server). Retries 429/5xx/network
 * errors with backoff, respecting Retry-After. Never retries user aborts.
 */
export class OpenAICompatClient implements ChatClient {
  readonly providerName: string;
  readonly baseUrl: string;
  protected apiKey: string;
  protected siteUrl: string;
  protected appName: string;
  protected openRouterHeaders: boolean;
  protected logger?: Logger;
  private backoffMs: number[] = [1000, 2000, 4000];

  constructor(options: OpenAICompatClientOptions) {
    this.providerName = options.providerName;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? '';
    this.siteUrl = options.siteUrl || 'https://github.com/makel/STARN';
    this.appName = options.appName || 'STARN PM Agent';
    this.openRouterHeaders = options.openRouterHeaders ?? false;
    this.logger = options.logger;
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
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
        if (err.name === 'AbortError') {
          throw err;
        }
        const isRetryable = this._isRetryableError(err);
        if (!isRetryable || attempt >= maxRetries) {
          throw this._finalError(err);
        }
        const delay = this.backoffMs[attempt] || 4000;
        const retryAfter = this._extractRetryAfter(err);
        const waitMs = retryAfter !== null ? retryAfter : delay;
        this.logger?.warn(`${this.providerName} ${attempt === 0 ? 'request' : 'retry ' + attempt} failed (${err.message}). Retrying in ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    throw this._finalError(lastError || new Error('Retry loop exhausted'));
  }

  protected buildHeaders(json: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) headers['Content-Type'] = 'application/json';
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.openRouterHeaders) {
      headers['HTTP-Referer'] = this.siteUrl;
      headers['X-Title'] = this.appName;
    }
    return headers;
  }

  /** Network failures (no HTTP status) become a provider-named "unreachable" error. */
  private _finalError(err: any): Error {
    if (err && !err.status && err.name !== 'AbortError' && /fetch|network|ECONN|ENOTFOUND|EHOSTUNREACH/i.test(err.message ?? '')) {
      const wrapped = new Error(`Provider "${this.providerName}" unreachable at ${this.baseUrl}: ${err.message}`);
      (wrapped as any).cause = err;
      return wrapped;
    }
    return err;
  }

  private async _doRequest(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const payload: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2
    };

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools;
    }
    if (options.tool_choice) {
      payload.tool_choice = options.tool_choice;
    }
    if (options.max_tokens) {
      payload.max_tokens = options.max_tokens;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(true),
      body: JSON.stringify(payload),
      signal: options.signal
    });

    if (!res.ok) {
      const errorText = await res.text();
      const err = new Error(`${this.providerName} API error (${res.status}): ${errorText}`);
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
      throw new Error(`Invalid response structure from ${this.providerName} API`);
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
}

export interface OpenRouterClientOptions {
  apiKey: string;
  siteUrl?: string;
  appName?: string;
  /** API root; defaults to https://openrouter.ai/api/v1 */
  baseUrl?: string;
  logger?: Logger;
}

/** The built-in OpenRouter provider. Requires an API key; also handles voice transcription. */
export class OpenRouterClient extends OpenAICompatClient {
  constructor(options: OpenRouterClientOptions) {
    super({
      providerName: 'OpenRouter',
      baseUrl: options.baseUrl || OPENROUTER_API_ROOT,
      apiKey: options.apiKey,
      openRouterHeaders: true,
      siteUrl: options.siteUrl,
      appName: options.appName,
      logger: options.logger
    });
  }

  override async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured.');
    }
    return super.chatCompletion(options);
  }

  async transcribeAudio(audioBuffer: Buffer, filename: string = 'recording.wav'): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured.');
    }

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('file', blob, filename);
    formData.append('model', 'openai/whisper-large-v3');

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: this.buildHeaders(false),
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
