import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import { extractTextFromPdf, probeCharts } from './pdf-extractor.js';
import { extractTextFromScannedPdf } from '../document-extractors/vision-extractor.js';
import { extractTextFromDocx } from '../document-extractors/docx-extractor.js';
import { formatCsvAsTable } from '../document-extractors/csv-extractor.js';

/**
 * Builds the spec §5 chart banner for a PDF.
 * @param filePath Absolute path to the PDF.
 * @returns Banner text wrapped in blank lines, or '' when there is no chart or the probe fails.
 * @throws Never: the probe is wrapped so a banner failure cannot fail the read.
 */
async function chartBanner(filePath: string): Promise<string> {
  try {
    const probes = await probeCharts(filePath);
    if (probes.length === 0) return '';
    const lines = probes.map((probe) => {
      const named = probe.series.length > 0;
      if (!probe.reliable) {
        const count = named
          ? `${probe.series.length} series (${probe.series.join(', ')})`
          : `${probe.dataPaths} plotted paths`;
        return `[Charts detected: page ${probe.page} — ${count}. Curves are vector paths; text extraction cannot read their values. If read_chart_data is available, call it with declared axes; otherwise request research to extract the curve values.]`;
      }
      const count = named
        ? `${probe.series.length} series (${probe.series.join(', ')})`
        : `${probe.dataPaths} plotted paths`;
      return `[Charts detected: page ${probe.page} — ${count}. Curves are vector paths; text extraction cannot read their values. If read_chart_data is available, call it for numeric values; otherwise request research.]`;
    });
    return `\n${lines.join('\n')}\n`;
  } catch {
    return '';
  }
}

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
    // Sibling-prefix + case-insensitive guard: on win32 (case-insensitive FS)
    // compare lowercased so 'BASE-x' can never pass as 'BASE'/'BASE' + sep.
    const ci = process.platform === 'win32';
    const base = ci ? safeBase.toLowerCase() : safeBase;
    const resolved = ci ? target.toLowerCase() : target;
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
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
        const banner = await chartBanner(target);
        return {
          success: true,
          result: `[PDF Text Extraction: ${fileName}]\n${'='.repeat(60)}\n${text}\n${'='.repeat(60)}\n${banner}`
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
