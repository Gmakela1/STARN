import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const fsListHandler: ToolHandler = {
  name: 'fs_list',
  definition: {
    type: 'function',
    function: {
      name: 'fs_list',
      description: 'List files and directories in the project or a subfolder',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Relative directory path (defaults to root .)' }
        }
      }
    }
  },
  async execute(args: { dir?: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const safeBase = path.resolve(context.projectPath);
    const target = path.resolve(safeBase, args.dir || '.');
    if (!target.startsWith(safeBase)) {
      return { success: false, error: 'Path traversal is not permitted.' };
    }
    if (!fs.existsSync(target)) {
      return { success: false, error: `Directory not found: ${args.dir || '.'}` };
    }
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const formatted = entries
      .filter(e => e.name !== '.git' && e.name !== 'node_modules')
      .map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`)
      .join('\n');
    return { success: true, result: formatted || '(empty directory)' };
  }
};
