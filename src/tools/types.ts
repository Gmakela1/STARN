import { ChatClient, ToolDefinition } from '../openrouter/types.js';
import { ProjectStateManager } from '../workspace/state.js';
import { SearchClient } from './search/types.js';

export interface ToolExecutionContext {
  projectPath: string;
  stateManager: ProjectStateManager;
  builtinExamplesDir?: string;
  editLog?: EditEntry[];
  searchClient?: SearchClient;
  /** Vision-transcription client+model; present only when the active specialist allows doc_transcribe AND transcription is enabled. */
  transcriber?: { client: ChatClient; model: string };
  /** Abort signal from the running turn, so tool handlers can be cancelled mid-work. */
  signal?: AbortSignal;
}

export interface ToolExecutionResponse {
  success: boolean;
  result?: string;
  error?: string;
}

export interface EditEntry {
  path: string;
  oldText: string;
  newText: string;
  matchedLineRange: { start: number; end: number }; // 1-indexed, in patched file
  timestamp: string; // ISO 8601
}

export interface ToolHandler {
  name: string;
  definition: ToolDefinition;
  execute: (args: any, context: ToolExecutionContext) => Promise<ToolExecutionResponse>;
}
