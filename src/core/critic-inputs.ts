/**
 * Program-baseline and user-examples loading for the critic loop.
 *
 * Extracted verbatim from the core runner (behavior-preserving refactor).
 * Both reads are loop-invariant — the critic while-loop re-reads the same
 * `docs/*.md` baseline and the same `examples/<specialistId>/*` files every
 * iteration — so the runner loads them once before the loop.
 *
 * Imports: node:fs and node:path only (I/O-agnostic core leaf).
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * A program baseline document entry: the uppercased doc id derived from the
 * filename, the on-disk-relative path, and the raw file content.
 *
 * Structurally identical to `BaselineDocument` in `./critic.js`; the runner
 * types its local collection as `BaselineDocument[]`.
 */
export interface BaselineDocumentLike {
  id: string;
  path: string;
  content: string;
}

/**
 * Read all approved baseline documents from `docs/*.md` for cross-document
 * program alignment. Excludes the specialist's own deliverable (matched
 * case-insensitively via the uppercased file id) and skips empty/
 * whitespace-only files. Read errors are ignored (unreadable doc → absent
 * baseline), byte-identical to the runner's inline block.
 */
export function loadProgramBaseline(projectPath: string, specialistId: string): BaselineDocumentLike[] {
  const programBaselineDocs: BaselineDocumentLike[] = [];
  const docsDir = path.join(projectPath, 'docs');
  if (fs.existsSync(docsDir)) {
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
    for (const f of files) {
      const docId = f.replace(/\.md$/i, '').toUpperCase();
      if (docId !== specialistId.toUpperCase()) {
        try {
          const content = fs.readFileSync(path.join(docsDir, f), 'utf-8');
          if (content.trim()) {
            programBaselineDocs.push({
              id: docId,
              path: `docs/${f}`,
              content
            });
          }
        } catch (_e) {
          // ignore
        }
      }
    }
  }
  return programBaselineDocs;
}

/**
 * Read the user's custom quality examples from `examples/<specialistId>`.
 * Only `.md` and `.txt` files are included (extension check is exact, so
 * `UPPER.MD` is ignored); empty files are included as empty strings —
 * byte-identical to the runner's inline block. A missing examples dir yields
 * an empty list.
 */
export function loadUserExamples(projectPath: string, specialistId: string): string[] {
  const customExamples: string[] = [];
  const userExDir = path.join(projectPath, 'examples', specialistId);
  if (fs.existsSync(userExDir)) {
    for (const f of fs.readdirSync(userExDir)) {
      if (f.endsWith('.md') || f.endsWith('.txt')) {
        customExamples.push(fs.readFileSync(path.join(userExDir, f), 'utf-8'));
      }
    }
  }
  return customExamples;
}