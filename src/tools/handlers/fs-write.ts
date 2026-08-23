import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const fsWriteHandler: ToolHandler = {
  name: 'fs_write',
  definition: {
    type: 'function',
    function: {
      name: 'fs_write',
      description: 'Create or overwrite a file in the project folder',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to file within the project' },
          content: { type: 'string', description: 'Content to write' }
        },
        required: ['path', 'content']
      }
    }
  },
  async execute(args: { path: string; content: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const safeBase = path.resolve(context.projectPath);
    const target = path.resolve(safeBase, args.path);
    if (!target.startsWith(safeBase)) {
      return { success: false, error: 'Path traversal is not permitted.' };
    }
    const parent = path.dirname(target);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(target, args.content, 'utf-8');
    return { success: true, result: `Successfully wrote ${args.content.length} bytes to ${args.path}` };
  }
};
