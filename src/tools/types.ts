import { ToolDefinition } from '../openrouter/types.js';
import { ProjectStateManager } from '../workspace/state.js';

export interface ToolExecutionContext {
  projectPath: string;
  stateManager: ProjectStateManager;
  builtinExamplesDir?: string;
  editLog?: EditEntry[];
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
