export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | ChatContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  max_tokens?: number;
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  signal?: AbortSignal;
}

/** Minimal chat interface every model-using core module depends on. */
export interface ChatClient {
  chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls?: ToolCall[];
  raw: unknown;
}

export interface TranscriptionResult {
  text: string;
}
