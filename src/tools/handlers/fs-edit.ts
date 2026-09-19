import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse, EditEntry } from '../types.js';
import { createVersionBackup } from '../../util/version-backup.js';

interface FsEditArgs {
  path: string;
  edits: Array<{ old_text: string; new_text: string }>;
}

/**
 * Prefix every line of `contents` with a 1-indexed line number, right-aligned,
 * e.g. "   1 | # CONOPS". Used in failure responses so the model can re-target.
 */
function formatWithLineNumbers(contents: string): string {
  const lines = contents.split('\n');
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width)} | ${line}`).join('\n');
}

/** Compute the 1-indexed start/end line of the replacement region in the patched file. */
function lineRangeOf(contents: string, regionStartIndex: number, regionText: string): { start: number; end: number } {
  const before = contents.slice(0, regionStartIndex);
  const startLine = before.split('\n').length; // 1-indexed
  const lineCount = Math.max(regionText.split('\n').length, 1);
  return { start: startLine, end: startLine + lineCount - 1 };
}

function atomicFailure(filePath: string, reason: string, contents: string): ToolExecutionResponse {
  const numbered = formatWithLineNumbers(contents);
  return {
    success: false,
    error: `Edit batch rejected: ${reason}\nNo changes written to ${filePath}.\nFile contents with line numbers (re-quote a unique snippet):\n${numbered}`
  };
}

export const fsEditHandler: ToolHandler = {
  name: 'fs_edit',
  definition: {
    type: 'function',
    function: {
      name: 'fs_edit',
      description:
        'Apply targeted edits to an existing document under docs/. Each old_text must match exactly once in the file. Reason about what section to change and why before calling. Use fs_write only for initial creation of a new deliverable.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to an existing file under docs/' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                old_text: { type: 'string', description: 'Verbatim text to find; must appear exactly once' },
                new_text: { type: 'string', description: 'Replacement text (empty string deletes the region)' }
              },
              required: ['old_text', 'new_text']
            }
          }
        },
        required: ['path', 'edits']
      }
    }
  },

  async execute(args: FsEditArgs, context: ToolExecutionContext): Promise<ToolExecutionResponse> {
    const safeBase = path.resolve(context.projectPath);
    const target = path.resolve(safeBase, args.path);

    // Path traversal guard
    if (!target.startsWith(safeBase)) {
      return { success: false, error: 'Path traversal is not permitted.' };
    }

    // Scope guard: docs/ only
    const docsRoot = path.join(safeBase, 'docs');
    if (!target.startsWith(docsRoot)) {
      return { success: false, error: 'fs_edit may only modify files under docs/.' };
    }

    if (!fs.existsSync(target)) {
      return { success: false, error: `File does not exist: ${args.path}. Use fs_write to create a new file.` };
    }

    let contents = fs.readFileSync(target, 'utf-8');

    // Verify + apply in memory (atomic). Version backup is created only after
    // all edits verify, so a failed batch leaves no orphan backup.
    const applied: Array<{ entry: EditEntry; regionStartIndex: number }> = [];
    for (const edit of args.edits) {
      const firstIdx = contents.indexOf(edit.old_text);
      if (firstIdx === -1) {
        return atomicFailure(args.path, `old_text not found (matched 0 times; must match exactly once).`, contents);
      }
      const secondIdx = contents.indexOf(edit.old_text, firstIdx + 1);
      if (secondIdx !== -1) {
        return atomicFailure(args.path, `old_text matched 2+ times (must match exactly once).`, contents);
      }
      // Apply
      const patched = contents.slice(0, firstIdx) + edit.new_text + contents.slice(firstIdx + edit.old_text.length);
      applied.push({
        entry: {
          path: args.path,
          oldText: edit.old_text,
          newText: edit.new_text,
          matchedLineRange: lineRangeOf(patched, firstIdx, edit.new_text || ''),
          timestamp: new Date().toISOString()
        },
        regionStartIndex: firstIdx
      });
      contents = patched;
    }

    // Version backup only after all edits verified (failed batches leave no backup).
    createVersionBackup(context.projectPath, target);

    // Write once.
    fs.writeFileSync(target, contents, 'utf-8');

    // Append to editLog.
    if (context.editLog) {
      for (const a of applied) {
        context.editLog.push(a.entry);
      }
    }

    // Build success response: list each edit with line range + 3-line context.
    const lines = [`Applied ${applied.length} edit(s) to ${args.path}:`];
    applied.forEach((a, i) => {
      const r = a.entry.matchedLineRange;
      const ctxLines = a.entry.newText.split('\n').slice(0, 3);
      lines.push(`[${i + 1}] L${r.start}-${r.end} (matched once): old_text → new_text`);
      lines.push('    context after edit (first 3 lines):');
      for (const cl of ctxLines) {
        lines.push(`      ${cl}`);
      }
    });

    return { success: true, result: lines.join('\n') };
  }
};
