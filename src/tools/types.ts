import { ChatClient, ToolDefinition } from '../openrouter/types.js';
import { ProjectStateManager } from '../workspace/state.js';
import { SearchClient } from './search/types.js';
import type { ResearchDelegationResult } from '../core/research-delegation.js';

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
  /**
   * Research delegation capability, injected by the caller that owns the role
   * clients (runner / session). One function: question in, delegation outcome
   * out — no clients, no models, no registry. Absent when the context has no
   * research wiring; the handler then reports the gap instead of researching.
   * The injected wrapper owns the 240 s budget (the core runner arms no timer).
   */
  requestResearch?: (req: { question: string; focus?: string[] }) => Promise<ResearchDelegationResult>;
  /**
   * Structured log sink for tool-level diagnostics (one line per chart read).
   * Structurally satisfied by `Logger`. Absent when the caller built no logger;
   * handlers then stay silent instead of writing to the console.
   */
  logger?: { info(message: string): void; warn(message: string): void };
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
