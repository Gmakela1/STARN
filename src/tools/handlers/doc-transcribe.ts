import path from 'node:path';
import fs from 'node:fs';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import { extractTextFromScannedPdf } from '../document-extractors/vision-extractor.js';

export const docTranscribeHandler: ToolHandler = {
  name: 'doc_transcribe',
  definition: {
    type: 'function',
    function: {
      name: 'doc_transcribe',
      description: 'Transcribe a scanned/image-based PDF (manual, datasheet) into readable text using a vision model. Use when a PDF has no text layer. Args: path (relative within project), maxPages (optional, default 25), focus (optional, e.g. "motor specifications").',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the PDF within the project' },
          maxPages: { type: 'number', description: 'Max pages to transcribe (default 25)' },
          focus: { type: 'string', description: 'What to look for in the document' }
        },
        required: ['path']
      }
    }
  },
  async execute(args: { path: string; maxPages?: number; focus?: string }, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const safeBase = path.resolve(context.projectPath);
    const target = path.resolve(safeBase, args.path);
    if (!target.startsWith(safeBase)) {
      return { success: false, error: 'Path traversal is not permitted.' };
    }
    if (!context.transcriber) {
      return { success: false, error: 'Document transcription is not available for this specialist package or is disabled in settings.' };
    }
    if (!fs.existsSync(target)) {
      return { success: false, error: `File not found: ${args.path}` };
    }
    try {
      const text = await extractTextFromScannedPdf(target, context.transcriber, {
        maxPages: args.maxPages,
        focus: args.focus,
        signal: context.signal
      });
      return { success: true, result: `[Scanned document transcription: ${path.basename(target)}]\n${text}` };
    } catch (err: any) {
      return { success: false, error: `Transcription failed: ${err?.message ?? String(err)}` };
    }
  }
};