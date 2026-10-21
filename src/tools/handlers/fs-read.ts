import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import { extractTextFromPdf } from './pdf-extractor.js';
import { extractTextFromScannedPdf } from '../document-extractors/vision-extractor.js';
import { extractTextFromDocx } from '../document-extractors/docx-extractor.js';
import { formatCsvAsTable } from '../document-extractors/csv-extractor.js';

export const fsReadHandler: ToolHandler = {
  name: 'fs_read',
  definition: {
    type: 'function',
    function: {
      name: 'fs_read',
      description: 'Read the contents of a file in the project folder. Supports .md, .txt, .json, .csv, .docx, .pdf, and other formats. For PDFs and DOCX files, text is automatically extracted. For CSV files, clean tabular markdown is generated.',
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
        if (text.includes('No extractable text found') && context.transcriber) {
          try {
            const scanned = await extractTextFromScannedPdf(target, context.transcriber, {
              maxPages: 25,
              signal: context.signal
            });
            return {
              success: true,
              result: `[PDF: ${fileName} — scanned; transcribed via vision model (first 25 pages)]\n${scanned}\n`
            };
          } catch (visionErr: any) {
            return {
              success: true,
              result: `[PDF: ${fileName}]\nNote: Could not extract text from this PDF (vision transcription also failed). Error: ${visionErr?.message || 'Unknown'}`
            };
          }
        }
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

    if (ext === '.docx') {
      try {
        const text = await extractTextFromDocx(target);
        const fileName = path.basename(target);
        return {
          success: true,
          result: `[DOCX Document: ${fileName}]\n${'='.repeat(60)}\n${text}\n${'='.repeat(60)}\n`
        };
      } catch (err: any) {
        return {
          success: true,
          result: `[DOCX: ${path.basename(target)}]\nNote: Could not extract text from this DOCX. Error: ${err.message || 'Unknown'}`
        };
      }
    }

    if (ext === '.csv') {
      try {
        const raw = fs.readFileSync(target, 'utf-8');
        const table = formatCsvAsTable(raw);
        const fileName = path.basename(target);
        return {
          success: true,
          result: `[Tabular CSV: ${fileName}]\n${'='.repeat(60)}\n${table}\n${'='.repeat(60)}\n`
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Could not parse CSV: ${err.message || 'Unknown error'}`
        };
      }
    }

    // For standard text-based files (.md, .txt, .json, etc.)
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
