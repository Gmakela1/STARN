import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';

export const exampleReaderHandler: ToolHandler = {
  name: 'example_reader',
  definition: {
    type: 'function',
    function: {
      name: 'example_reader',
      description: 'List and read developer secret-sauce or user custom quality examples',
      parameters: {
        type: 'object',
        properties: {
          specialistId: { type: 'string', description: 'Specialist ID (e.g., conops, wbs)' }
        },
        required: ['specialistId']
      }
    }
  },
  async execute(args: { specialistId: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const customExamplesDir = path.join(context.projectPath, 'examples', args.specialistId);
    const results: string[] = [];

    if (fs.existsSync(customExamplesDir)) {
      const files = fs.readdirSync(customExamplesDir);
      for (const f of files) {
        if (f.endsWith('.md')) {
          const content = fs.readFileSync(path.join(customExamplesDir, f), 'utf-8');
          results.push(`### Custom User Example (${f}):\n${content}`);
        }
      }
    }

    if (results.length === 0) {
      return { success: true, result: 'No user custom examples found for this specialist.' };
    }
    return { success: true, result: results.join('\n\n---\n\n') };
  }
};
