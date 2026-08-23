import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const stateReadHandler: ToolHandler = {
  name: 'state_read',
  definition: {
    type: 'function',
    function: {
      name: 'state_read',
      description: 'Read the current project state (discovery, artifacts, risks, phase)',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  async execute(_args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const state = context.stateManager.getState();
    return { success: true, result: JSON.stringify(state, null, 2) };
  }
};
