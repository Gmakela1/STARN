import { ToolDefinition } from '../openrouter/types.js';
import { ProjectStateManager } from '../workspace/state.js';

export interface ToolExecutionContext {
  projectPath: string;
  stateManager: ProjectStateManager;
  builtinExamplesDir?: string;
}

export interface ToolExecutionResponse {
  success: boolean;
  result?: string;
  error?: string;
}

export interface ToolHandler {
  name: string;
  definition: ToolDefinition;
  execute: (args: any, context: ToolExecutionContext) => Promise<ToolExecutionResponse>;
}
