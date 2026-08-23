import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const stateUpdateHandler: ToolHandler = {
  name: 'state_update',
  definition: {
    type: 'function',
    function: {
      name: 'state_update',
      description: 'Update project state fields such as phase, risk, or recent action',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action description to record' },
          phase: { type: 'string', description: 'New current phase name' },
          addRisk: { type: 'string', description: 'New risk to record' }
        }
      }
    }
  },
  async execute(args: { action?: string; phase?: string; addRisk?: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const state = context.stateManager.getState();
    if (args.phase) {
      state.currentPhase = args.phase;
    }
    if (args.addRisk) {
      state.openRisks.push(args.addRisk);
    }
    if (args.action) {
      state.recentActions.push(args.action);
    }
    context.stateManager.saveState(state);
    return { success: true, result: 'Project state successfully updated.' };
  }
};
