import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import { extractTextFromPdf } from './pdf-extractor.js';

export const fsReadHandler: ToolHandler = {
  name: 'fs_read',
  definition: {
    type: 'function',
    function: {
      name: 'fs_read',
      description: 'Read the contents of a file in the project folder. Supports .md, .txt, .json, .csv, .pdf, and other text-based formats. For PDFs, text content is automatically extracted.',
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

    const ext = path.extname(target).toLowerCase();

    if (ext === '.pdf') {
      try {
        const text = await extractTextFromPdf(target);
        const fileName = path.basename(target);
        return {
          success: true,
          result: `[PDF Text Extraction: ${fileName}]\n${'='.repeat(60)}\n${text}\n${'='.repeat(60)}\n`
        };
      } catch (err: any) {
        return {
          success: true,
          result: `[PDF: ${path.basename(target)}]\nNote: Could not extract text from this PDF. This may be a scanned image-based document. Error: ${err.message || 'Unknown'}`
        };
      }
    }

    // For text-based files (.md, .txt, .json, .csv, etc.)
    try {
      const content = fs.readFileSync(target, 'utf-8');
      return { success: true, result: content };
    } catch (err: any) {
      return {
        success: false,
        error: `Could not read file: ${err.message || 'Unknown error'}`
      };
    }
  }
};