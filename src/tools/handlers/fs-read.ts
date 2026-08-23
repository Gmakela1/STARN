import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const fsReadHandler: ToolHandler = {
  name: 'fs_read',
  definition: {
    type: 'function',
    function: {
      name: 'fs_read',
      description: 'Read the contents of a file in the project folder',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to file within the project' }
        },
        required: ['path']
      }
    }
  },
  async execute(args: { path: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const safeBase = path.resolve(context.projectPath);
    const target = path.resolve(safeBase, args.path);
    if (!target.startsWith(safeBase)) {
      return { success: false, error: 'Path traversal is not permitted.' };
    }
    if (!fs.existsSync(target)) {
      return { success: false, error: `File not found: ${args.path}` };
    }
    const content = fs.readFileSync(target, 'utf-8');
    return { success: true, result: content };
  }
};
