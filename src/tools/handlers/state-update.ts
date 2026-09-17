import { z } from 'zod';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import { ORDERED_WORKFLOW_PHASES } from '../../workspace/state.js';

const validPhaseIds = ORDERED_WORKFLOW_PHASES.map(p => p.id);

const addPendingRiskSchema = z.object({
  source: z.string().min(1),
  section: z.string().min(1),
  risk: z.string().min(1)
});

const stateUpdateArgsSchema = z.object({
  action: z.string().optional(),
  phase: z.enum(validPhaseIds as [string, ...string[]]).optional(),
  addPendingRisk: addPendingRiskSchema.optional()
});

export const stateUpdateHandler: ToolHandler = {
  name: 'state_update',
  definition: {
    type: 'function',
    function: {
      name: 'state_update',
      description: 'Update project state: record an action, switch the active phase, or add a structured pending risk (source, section, risk).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action description to record in recent actions' },
          phase: { type: 'string', description: 'New active phase id (e.g. conops, architecture, bom)', enum: validPhaseIds },
          addPendingRisk: {
            type: 'object',
            description: 'A structured pending risk to add to the risk register source pool',
            properties: {
              source: { type: 'string', description: 'Document where the risk was identified (e.g. BOM.md)' },
              section: { type: 'string', description: 'Section or subsystem reference (e.g. SS-02)' },
              risk: { type: 'string', description: 'Risk description in IF/THEN form if possible' }
            },
            required: ['source', 'section', 'risk']
          }
        }
      }
    }
  },
  async execute(args: any, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const parsed = stateUpdateArgsSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid state_update args: ${parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; ')}`
      };
    }
    const { action, phase, addPendingRisk } = parsed.data;

    if (phase) {
      context.stateManager.setActivePhase(phase);
    }
    if (addPendingRisk) {
      context.stateManager.addPendingRisk(addPendingRisk);
    }
    if (action) {
      context.stateManager.addAction(action);
    }
    return { success: true, result: 'Project state successfully updated.' };
  }
};
