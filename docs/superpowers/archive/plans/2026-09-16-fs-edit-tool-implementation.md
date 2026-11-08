# fs_edit Targeted Document Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `fs_edit` tool that applies targeted `{old_text, new_text}` edits to drafted documents, replacing the whole-file-rewrite path for feedback turns — limiting drift, lowering token cost, and giving the critic a change log.

**Architecture:** New `fs_edit` handler sits alongside `fs_write` in the tool registry. The handler verifies each `old_text` matches exactly once (atomic batch), writes once, returns matched line ranges + context on success or a line-numbered doc on failure. A version backup is created before every overwrite (both `fs_edit` and `fs_write`). An `editLog` on `ToolExecutionContext` captures applied edits per turn; the runner passes it to the critic as `appliedEdits`. Specialist prompts get a shared edit-instructions constant. Full doc text stays in the system prompt (whole-project understanding preserved on input).

**Tech Stack:** TypeScript (strict), Node `fs`/`path`, Zod (available), Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-fs-edit-tool-design.md`

## Global Constraints

- All code must pass `tsc --noEmit` (strict mode) — it runs in the test pipeline (`npm test` = `tsc --noEmit && vitest run`).
- No new external dependencies. Node built-ins (`fs`, `path`, `crypto` only if needed) + existing Zod.
- `core/*` must not import from `cli/*` (AGENTS.md I/O-agnostic principle).
- Path-traversal guard required on all file tools: resolve against `projectPath`, reject if target escapes.
- `fs_edit` is scoped to files under `docs/` only.
- Version files live in `.starn/versions/`; retain 10 most recent per doc name.
- Atomic batch: if any edit in a call fails to match exactly once, no write occurs.
- One-line-per-package edit: add `'fs_edit'` to each specialist's `allowedTools` array.

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/tools/types.ts` | Add `EditEntry` interface + optional `editLog` field on `ToolExecutionContext` | Modify |
| `src/util/version-backup.ts` | Shared `createVersionBackup(projectPath, filePath)` + pruning logic | Create |
| `src/tools/handlers/fs-edit.ts` | `fs_edit` handler: atomic apply, context/editLog return, failure with line numbers | Create |
| `src/tools/handlers/fs-write.ts` | Add version backup before overwrite (when file exists) | Modify |
| `src/tools/registry.ts` | Register `fsEditHandler` | Modify |
| `src/specialists/shared.ts` | `SHARED_EDIT_INSTRUCTIONS` constant | Create |
| `src/core/runner.ts` | Fresh `editLog` per turn + reset per revision; append shared instructions to prompt; pass `appliedEdits` to critic; add `fs_edit` to allow-list at runtime | Modify |
| `src/core/critic.ts` | Accept `appliedEdits`; include change log in critic prompt | Modify |
| `src/specialists/packages/*/index.ts` | Add `'fs_edit'` to `allowedTools` (14 files) | Modify |
| `tests/fs-edit-handler.test.ts` | Handler unit tests | Create |
| `tests/fs-write-backup.test.ts` | fs_write version backup regression | Create |
| `tests/fs-edit-integration.test.ts` | End-to-end edit + editLog + version backup | Create |
| `tests/critic-edit-log.test.ts` | Critic receives appliedEdits | Create |

**Boundary note:** `SHARED_EDIT_INSTRUCTIONS` lives in `src/specialists/shared.ts` (not `cli/*`) so the runner can import it without violating the I/O-agnostic rule.

---

## Task 1: EditEntry type + editLog on ToolExecutionContext

**Files:**
- Modify: `src/tools/types.ts`
- Test: `tests/tools.test.ts` (type-check only — no runtime test needed; the field is consumed by later tasks)

**Interfaces:**
- Produces: `EditEntry` interface and `editLog?: EditEntry[]` on `ToolExecutionContext`, consumed by Task 3 (fs-edit handler) and Task 6 (runner).

- [ ] **Step 1: Add the types**

In `src/tools/types.ts`, after the `ToolExecutionResponse` interface, add:

```typescript
export interface EditEntry {
  path: string;
  oldText: string;
  newText: string;
  matchedLineRange: { start: number; end: number }; // 1-indexed, in patched file
  timestamp: string; // ISO 8601
}
```

Then extend `ToolExecutionContext` to include the optional field. The current interface is:

```typescript
export interface ToolExecutionContext {
  projectPath: string;
  stateManager: ProjectStateManager;
  builtinExamplesDir?: string;
}
```

Change it to:

```typescript
export interface ToolExecutionContext {
  projectPath: string;
  stateManager: ProjectStateManager;
  builtinExamplesDir?: string;
  editLog?: EditEntry[];
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no errors (the new optional field is backward-compatible — existing code constructing `{ projectPath, stateManager }` is still valid).

- [ ] **Step 3: Commit**

```bash
git add src/tools/types.ts
git commit -m "feat: add EditEntry type and editLog to ToolExecutionContext"
```

---

## Task 2: Version backup utility

**Files:**
- Create: `src/util/version-backup.ts`
- Test: `tests/version-backup.test.ts`

**Interfaces:**
- Produces: `createVersionBackup(projectPath: string, filePath: string): string | null` — copies the existing file at `filePath` to `.starn/versions/<DOCNAME>-<ISOtimestamp>.md`, prunes to 10 most recent per doc name, returns the backup path or `null` if the source file does not exist. Consumed by Task 3 (fs-edit) and Task 4 (fs-write).

- [ ] **Step 1: Write the failing test**

Create `tests/version-backup.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createVersionBackup } from '../src/util/version-backup.js';

describe('createVersionBackup', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = path.join(os.tmpdir(), 'starn-version-test-' + Date.now());
    fs.mkdirSync(path.join(projectDir, 'docs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates a versioned backup of an existing file in .starn/versions/', () => {
    const docPath = path.join(projectDir, 'docs', 'CONOPS.md');
    fs.writeFileSync(docPath, '# CONOPS v1', 'utf-8');

    const backupPath = createVersionBackup(projectDir, docPath);

    expect(backupPath).not.toBeNull();
    expect(backupPath).toContain('.starn');
    expect(backupPath).toContain('versions');
    expect(backupPath).toContain('CONOPS');
    expect(fs.existsSync(backupPath!)).toBe(true);
    expect(fs.readFileSync(backupPath!, 'utf-8')).toBe('# CONOPS v1');
  });

  it('returns null when the source file does not exist', () => {
    const missing = path.join(projectDir, 'docs', 'MISSING.md');
    expect(createVersionBackup(projectDir, missing)).toBeNull();
  });

  it('retains only the 10 most recent backups per doc name', () => {
    const docPath = path.join(projectDir, 'docs', 'BOM.md');
    // Create 12 backups with distinct timestamps by varying file content + small delays
    for (let i = 0; i < 12; i++) {
      fs.writeFileSync(docPath, `# BOM v${i}`, 'utf-8');
      createVersionBackup(projectDir, docPath);
      // Force a different filename by bumping mtime; createVersionBackup uses Date.now()
      // which may collide across rapid calls — so sleep 15ms to guarantee distinct names.
      const start = Date.now();
      while (Date.now() - start < 15) { /* spin */ }
    }

    const versionsDir = path.join(projectDir, '.starn', 'versions');
    const backups = fs.readdirSync(versionsDir).filter(f => f.startsWith('BOM-'));
    expect(backups.length).toBe(10);
  });

  it('uses a filesystem-safe ISO timestamp (colons replaced with dashes)', () => {
    const docPath = path.join(projectDir, 'docs', 'SOW.md');
    fs.writeFileSync(docPath, '# SOW', 'utf-8');

    const backupPath = createVersionBackup(projectDir, docPath)!;
    const basename = path.basename(backupPath);
    // e.g. SOW-2026-09-16T14-22-03-000Z.md — no colons
    expect(basename).not.toContain(':');
    expect(basename).toMatch(/^SOW-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/version-backup.test.ts`
Expected: FAIL with "Cannot find module '../src/util/version-backup.js'"

- [ ] **Step 3: Write the implementation**

Create `src/util/version-backup.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';

const MAX_VERSIONS_PER_DOC = 10;

/**
 * Copies the current contents of `filePath` to a timestamped backup under
 * `<projectPath>/.starn/versions/`. Prunes to the MAX_VERSIONS_PER_DOC most
 * recent backups for that doc name. Returns the backup path, or null if the
 * source file does not exist (e.g. initial creation — nothing to back up).
 *
 * Timestamp format is filesystem-safe ISO 8601 (colons replaced with dashes)
 * so the same name sorts chronologically and is safe on Windows.
 */
export function createVersionBackup(projectPath: string, filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const versionsDir = path.join(projectPath, '.starn', 'versions');
  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }

  const docName = path.basename(filePath, path.extname(filePath));
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const backupPath = path.join(versionsDir, `${docName}-${timestamp}.md`);

  fs.copyFileSync(filePath, backupPath);

  // Prune: keep only the MAX_VERSIONS_PER_DOC most recent for this doc name.
  const all = fs.readdirSync(versionsDir)
    .filter(f => f.startsWith(`${docName}-`) && f.endsWith('.md'))
    .sort(); // ISO-safe names sort chronologically
  if (all.length > MAX_VERSIONS_PER_DOC) {
    const toDelete = all.slice(0, all.length - MAX_VERSIONS_PER_DOC);
    for (const f of toDelete) {
      fs.unlinkSync(path.join(versionsDir, f));
    }
  }

  return backupPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/version-backup.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/util/version-backup.ts tests/version-backup.test.ts
git commit -m "feat: version backup utility for document edits"
```

---

## Task 3: fs_edit handler

**Files:**
- Create: `src/tools/handlers/fs-edit.ts`
- Test: `tests/fs-edit-handler.test.ts`

**Interfaces:**
- Consumes: `EditEntry`, `ToolExecutionContext` from `src/tools/types.js`; `createVersionBackup` from `src/util/version-backup.js`
- Produces: `fsEditHandler` (ToolHandler) — registered in Task 5.

**Handler behavior summary (from spec §2):**
- Resolve + traversal guard + `docs/` scope guard.
- File must exist (else error: use `fs_write`).
- Version backup before applying.
- Atomic: verify every edit matches exactly once at apply time; on any failure, no write.
- Success: write once, append entries to `context.editLog`, return line ranges + 3-line context.
- Failure: no write, return full file with 1-indexed line numbers.

- [ ] **Step 1: Write the failing test**

Create `tests/fs-edit-handler.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { EditEntry } from '../src/tools/types.js';

describe('fs_edit handler', () => {
  let tempDir: string;
  let registry: ToolRegistry;
  let stateMgr: ProjectStateManager;
  let docPath: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-fsedit-test-' + Date.now());
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('test-proj', 'Test');
    registry = new ToolRegistry();
    docPath = path.join(tempDir, 'docs', 'CONOPS.md');
    // Seed a drafted doc
    fs.writeFileSync(docPath, [
      '# CONOPS',
      '',
      '## 1 Purpose',
      'Build a solar shed.',
      '',
      '## 3.2 Power System',
      'TBD: battery size',
      'Uses a 12V lead acid bank.',
      '',
      '## 6 Open Questions',
      '- What battery size?'
    ].join('\n'), 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const context = (dir: string, editLog?: EditEntry[]) => ({
    projectPath: dir,
    stateManager: stateMgr,
    editLog
  });

  it('applies a single targeted edit and preserves the rest of the file', async () => {
    const log: EditEntry[] = [];
    const res = await registry.execute(
      'fs_edit',
      {
        path: 'docs/CONOPS.md',
        edits: [{ old_text: 'TBD: battery size', new_text: '48V 100Ah LiFePO4' }]
      },
      context(tempDir, log),
      ['fs_edit']
    );

    expect(res.success).toBe(true);
    const updated = fs.readFileSync(docPath, 'utf-8');
    expect(updated).toContain('48V 100Ah LiFePO4');
    expect(updated).not.toContain('TBD: battery size');
    // Untouched sections preserved byte-for-byte
    expect(updated).toContain('# CONOPS');
    expect(updated).toContain('## 1 Purpose');
    expect(updated).toContain('Build a solar shed.');
    expect(updated).toContain('## 6 Open Questions');
  });

  it('appends an EditEntry to context.editLog on success', async () => {
    const log: EditEntry[] = [];
    await registry.execute(
      'fs_edit',
      {
        path: 'docs/CONOPS.md',
        edits: [{ old_text: 'TBD: battery size', new_text: '48V 100Ah LiFePO4' }]
      },
      context(tempDir, log),
      ['fs_edit']
    );

    expect(log.length).toBe(1);
    expect(log[0].path).toBe('docs/CONOPS.md');
    expect(log[0].oldText).toBe('TBD: battery size');
    expect(log[0].newText).toBe('48V 100Ah LiFePO4');
    expect(log[0].matchedLineRange.start).toBeGreaterThanOrEqual(1);
    expect(log[0].matchedLineRange.end).toBeGreaterThanOrEqual(log[0].matchedLineRange.start);
    expect(log[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('applies multiple edits in a batch atomically', async () => {
    const log: EditEntry[] = [];
    const res = await registry.execute(
      'fs_edit',
      {
        path: 'docs/CONOPS.md',
        edits: [
          { old_text: 'TBD: battery size', new_text: '48V 100Ah LiFePO4' },
          { old_text: 'Uses a 12V lead acid bank.', new_text: 'Uses a 48V LiFePO4 bank.' }
        ]
      },
      context(tempDir, log),
      ['fs_edit']
    );

    expect(res.success).toBe(true);
    const updated = fs.readFileSync(docPath, 'utf-8');
    expect(updated).toContain('48V 100Ah LiFePO4');
    expect(updated).toContain('48V LiFePO4 bank.');
    expect(log.length).toBe(2);
  });

  it('rejects the entire batch when one edit does not match (no write)', async () => {
    const original = fs.readFileSync(docPath, 'utf-8');
    const log: EditEntry[] = [];
    const res = await registry.execute(
      'fs_edit',
      {
        path: 'docs/CONOPS.md',
        edits: [
          { old_text: 'TBD: battery size', new_text: '48V 100Ah LiFePO4' },
          { old_text: 'THIS STRING DOES NOT EXIST', new_text: 'whatever' }
        ]
      },
      context(tempDir, log),
      ['fs_edit']
    );

    expect(res.success).toBe(false);
    // File untouched
    expect(fs.readFileSync(docPath, 'utf-8')).toBe(original);
    // No edits logged
    expect(log.length).toBe(0);
    // Failure response includes line-numbered file
    expect(res.error).toContain('1');
    expect(res.error).toContain('|');
    expect(res.error).toContain('# CONOPS');
  });

  it('rejects an edit whose old_text matches more than once', async () => {
    // Add a duplicate phrase
    fs.writeFileSync(docPath, '# Doc\n\nduplicate\nduplicate\n', 'utf-8');
    const original = fs.readFileSync(docPath, 'utf-8');
    const res = await registry.execute(
      'fs_edit',
      { path: 'docs/CONOPS.md', edits: [{ old_text: 'duplicate', new_text: 'unique' }] },
      context(tempDir, []),
      ['fs_edit']
    );

    expect(res.success).toBe(false);
    expect(fs.readFileSync(docPath, 'utf-8')).toBe(original);
    expect(res.error).toContain('matched 2 times');
  });

  it('supports deletion via empty new_text', async () => {
    const log: EditEntry[] = [];
    const res = await registry.execute(
      'fs_edit',
      { path: 'docs/CONOPS.md', edits: [{ old_text: '## 6 Open Questions\n- What battery size?', new_text: '' }] },
      context(tempDir, log),
      ['fs_edit']
    );

    expect(res.success).toBe(true);
    const updated = fs.readFileSync(docPath, 'utf-8');
    expect(updated).not.toContain('## 6 Open Questions');
  });

  it('supports chained edits where a later edit targets an earlier edit\'s output', async () => {
    const log: EditEntry[] = [];
    const res = await registry.execute(
      'fs_edit',
      {
        path: 'docs/CONOPS.md',
        edits: [
          { old_text: 'TBD: battery size', new_text: 'PLACEHOLDER_BATTERY' },
          { old_text: 'PLACEHOLDER_BATTERY', new_text: '48V 100Ah LiFePO4' }
        ]
      },
      context(tempDir, log),
      ['fs_edit']
    );

    expect(res.success).toBe(true);
    const updated = fs.readFileSync(docPath, 'utf-8');
    expect(updated).toContain('48V 100Ah LiFePO4');
    expect(updated).not.toContain('PLACEHOLDER_BATTERY');
  });

  it('rejects path traversal outside the project', async () => {
    const res = await registry.execute(
      'fs_edit',
      { path: '../etc/passwd', edits: [{ old_text: 'x', new_text: 'y' }] },
      context(tempDir, []),
      ['fs_edit']
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('Path traversal');
  });

  it('rejects paths outside docs/ (scope guard)', async () => {
    // Create a file outside docs
    fs.writeFileSync(path.join(tempDir, 'state.json'), '{}', 'utf-8');
    const res = await registry.execute(
      'fs_edit',
      { path: 'state.json', edits: [{ old_text: '{}', new_text: '{"x":1}' }] },
      context(tempDir, []),
      ['fs_edit']
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('docs');
  });

  it('errors when the target file does not exist', async () => {
    const res = await registry.execute(
      'fs_edit',
      { path: 'docs/MISSING.md', edits: [{ old_text: 'x', new_text: 'y' }] },
      context(tempDir, []),
      ['fs_edit']
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('does not exist');
    expect(res.error).toContain('fs_write');
  });

  it('creates a version backup before applying the edit', async () => {
    const originalContent = fs.readFileSync(docPath, 'utf-8');
    await registry.execute(
      'fs_edit',
      { path: 'docs/CONOPS.md', edits: [{ old_text: 'TBD: battery size', new_text: '48V' }] },
      context(tempDir, []),
      ['fs_edit']
    );

    const versionsDir = path.join(tempDir, '.starn', 'versions');
    expect(fs.existsSync(versionsDir)).toBe(true);
    const backups = fs.readdirSync(versionsDir).filter(f => f.startsWith('CONOPS-'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    const backupContent = fs.readFileSync(path.join(versionsDir, backups[0]), 'utf-8');
    expect(backupContent).toBe(originalContent);
  });

  it('returns context lines and line numbers in the success response', async () => {
    const res = await registry.execute(
      'fs_edit',
      { path: 'docs/CONOPS.md', edits: [{ old_text: 'TBD: battery size', new_text: '48V 100Ah LiFePO4' }] },
      context(tempDir, []),
      ['fs_edit']
    );
    expect(res.success).toBe(true);
    expect(res.result).toContain('Applied 1 edit(s)');
    expect(res.result).toMatch(/L\d+/); // line number
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fs-edit-handler.test.ts`
Expected: FAIL — `fs_edit` is not a registered tool (`Unknown tool: fs_edit`).

- [ ] **Step 3: Write the handler implementation**

Create `src/tools/handlers/fs-edit.ts`:

```typescript
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

/** Compute the 1-indexed start line of `needle` in `haystack` (after it has been patched in). */
function lineRangeOf(contents: string, regionStartIndex: number, regionText: string): { start: number; end: number } {
  const before = contents.slice(0, regionStartIndex);
  const startLine = before.split('\n').length; // 1-indexed
  const lineCount = regionText.split('\n').length;
  return { start: startLine, end: startLine + lineCount - 1 };
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

function atomicFailure(filePath: string, reason: string, contents: string): ToolExecutionResponse {
  const numbered = formatWithLineNumbers(contents);
  return {
    success: false,
    error: `Edit batch rejected: ${reason}\nNo changes written to ${filePath}.\nFile contents with line numbers (re-quote a unique snippet):\n${numbered}`
  };
}
```

- [ ] **Step 4: Run test to verify it fails differently (handler not registered yet)**

Run: `npx vitest run tests/fs-edit-handler.test.ts`
Expected: still FAIL with "Unknown tool: fs_edit" — because the registry doesn't register it yet (Task 5). The handler file existing is enough for `tsc`; we'll register it in Task 5. **For now, to make this task's tests pass, register it temporarily by adding it to the registry in this step.** Add the registration now (this overlaps with Task 5 step 1, which is fine — Task 5 then only verifies it).

Actually — to keep tasks independently testable, register `fsEditHandler` in `src/tools/registry.ts` now:

```typescript
import { fsEditHandler } from './handlers/fs-edit.js';
// ... in constructor:
this.register(fsEditHandler);
```

- [ ] **Step 5: Register the handler in the registry**

Edit `src/tools/registry.ts`:

Add the import with the other handler imports:
```typescript
import { fsEditHandler } from './handlers/fs-edit.js';
```

Add registration in the constructor after `this.register(fsWriteHandler);`:
```typescript
this.register(fsEditHandler);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/fs-edit-handler.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 7: Run full suite to check for regressions**

Run: `npm test`
Expected: all tests PASS, `tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add src/tools/handlers/fs-edit.ts src/tools/registry.ts tests/fs-edit-handler.test.ts
git commit -m "feat: fs_edit handler with atomic targeted edits, context return, version backup"
```

---

## Task 4: fs_write version backup on overwrite

**Files:**
- Modify: `src/tools/handlers/fs-write.ts`
- Test: `tests/fs-write-backup.test.ts`

**Interfaces:**
- Consumes: `createVersionBackup` from `src/util/version-backup.js`
- Produces: unchanged `fsWriteHandler` with backup-before-overwrite behavior.

- [ ] **Step 1: Write the failing test**

Create `tests/fs-write-backup.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('fs_write version backup on overwrite', () => {
  let tempDir: string;
  let registry: ToolRegistry;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-fswrite-backup-' + Date.now());
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('test', 'Test');
    registry = new ToolRegistry();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a version backup when overwriting an existing file', async () => {
    const docPath = path.join(tempDir, 'docs', 'CONOPS.md');
    fs.writeFileSync(docPath, '# CONOPS v1', 'utf-8');

    const ctx = { projectPath: tempDir, stateManager: stateMgr };
    await registry.execute('fs_write', { path: 'docs/CONOPS.md', content: '# CONOPS v2' }, ctx, ['fs_write']);

    const versionsDir = path.join(tempDir, '.starn', 'versions');
    const backups = fs.readdirSync(versionsDir).filter(f => f.startsWith('CONOPS-'));
    expect(backups.length).toBe(1);
    expect(fs.readFileSync(path.join(versionsDir, backups[0]), 'utf-8')).toBe('# CONOPS v1');
  });

  it('does NOT create a backup on initial file creation', async () => {
    const ctx = { projectPath: tempDir, stateManager: stateMgr };
    await registry.execute('fs_write', { path: 'docs/NEW.md', content: '# New' }, ctx, ['fs_write']);

    const versionsDir = path.join(tempDir, '.starn', 'versions');
    expect(fs.existsSync(versionsDir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fs-write-backup.test.ts`
Expected: the first test FAILS — no backup created (versions dir doesn't exist).

- [ ] **Step 3: Add the backup call to fs-write.ts**

Edit `src/tools/handlers/fs-write.ts`. Add the import and a backup-before-overwrite call. The current `execute` is:

```typescript
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
```

Change it to (add import at top, add backup call before write):

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import { createVersionBackup } from '../../util/version-backup.js';

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
    // Back up the prior version before overwriting (no-op on initial creation).
    createVersionBackup(context.projectPath, target);
    fs.writeFileSync(target, args.content, 'utf-8');
    return { success: true, result: `Successfully wrote ${args.content.length} bytes to ${args.path}` };
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fs-write-backup.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run full suite for regressions**

Run: `npm test`
Expected: all PASS. Note: the existing `tools.test.ts` may create files and now produce version backups — that's fine, no assertions break.

- [ ] **Step 6: Commit**

```bash
git add src/tools/handlers/fs-write.ts tests/fs-write-backup.test.ts
git commit -m "feat: fs_write creates version backup before overwriting existing files"
```

---

## Task 5: Verify registry registration (already done in Task 3)

This task is a verification gate only — the registration was done in Task 3 Step 5 to keep that task independently testable. No code change here.

**Files:** none.

- [ ] **Step 1: Confirm fs_edit is registered and discoverable**

Run: `npx vitest run tests/fs-edit-handler.test.ts tests/tools.test.ts`
Expected: PASS. `fs_edit` is callable through the registry and appears in `getDefinitions(['fs_edit'])`.

- [ ] **Step 2: Confirm getDefinitions includes fs_edit**

Quick check (can be a one-off node command):
```bash
node -e "const {ToolRegistry}=require('./dist/tools/registry.js');const r=new ToolRegistry();console.log(r.getDefinitions(['fs_edit']).map(d=>d.function.name));"
```
Expected output: `[ 'fs_edit' ]`
(Requires `dist/` to be built; if not, skip and rely on the test above.)

- [ ] **Step 3: No commit needed (no changes)**

---

## Task 6: Shared edit-instructions constant + specialist allow-lists

**Files:**
- Create: `src/specialists/shared.ts`
- Modify: `src/specialists/packages/*/index.ts` (14 files — add `'fs_edit'` to each `allowedTools`)

**Interfaces:**
- Produces: `SHARED_EDIT_INSTRUCTIONS` string constant, consumed by Task 7 (runner appends it to every specialist's system prompt).

- [ ] **Step 1: Create the shared constant**

Create `src/specialists/shared.ts`:

```typescript
/**
 * Instructions appended to every specialist's system prompt, instructing the
 * model to use fs_edit for changes to existing drafts and fs_write only for
 * initial creation. Kept here (not in cli/*) to preserve the I/O-agnostic
 * boundary required by AGENTS.md.
 */
export const SHARED_EDIT_INSTRUCTIONS = `

EDITING DISCIPLINE:
When the deliverable document already exists on disk, make changes using the fs_edit tool with targeted {old_text, new_text} edits — never rewrite the whole document via fs_write. Quote old_text verbatim from the document; it must match exactly once. Reason about what section to change and why before calling. Use fs_write only for the initial creation of a new deliverable file. If you need to restructure a large region, quote the full region as old_text and provide the replacement as new_text.`;
```

- [ ] **Step 2: Add 'fs_edit' to every specialist's allowedTools**

For each of the 14 package files in `src/specialists/packages/*/index.ts`, change the `allowedTools` line from:

```typescript
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
```

to:

```typescript
  allowedTools: ['fs_read', 'fs_write', 'fs_edit', 'fs_list', 'state_read', 'state_update', 'example_reader'],
```

The 14 files are: `conops`, `architecture`, `icd`, `capabilities`, `requirements`, `bom`, `rtm`, `milestones`, `risk-register`, `build-sequence`, `testplans`, `sow`, `change-impact`, `general`.

**Note on `general` and `change-impact`:** these may have different allow-lists (general has no file writes; change-impact may be read-only). Check each file before editing — only add `'fs_edit'` where `'fs_write'` is already present. For packages without `'fs_write'`, skip adding `'fs_edit'` (they don't modify docs).

- [ ] **Step 3: Verify type-check + tests**

Run: `npm test`
Expected: PASS. No behavior change yet (the runner hasn't wired the constant), but allow-lists now include `fs_edit`.

- [ ] **Step 4: Commit**

```bash
git add src/specialists/shared.ts src/specialists/packages/
git commit -m "feat: SHARED_EDIT_INSTRUCTIONS constant + fs_edit in specialist allow-lists"
```

---

## Task 7: Runner wiring — editLog, shared instructions, appliedEdits to critic

**Files:**
- Modify: `src/core/runner.ts`

**Interfaces:**
- Consumes: `SHARED_EDIT_INSTRUCTIONS` from `src/specialists/shared.js`; `EditEntry` from `src/tools/types.js`; `appliedEdits` option on critic (added in Task 8).
- Produces: runner passes `editLog: []` on context per turn, resets it per revision iteration, appends `SHARED_EDIT_INSTRUCTIONS` to the enhanced system prompt, passes `appliedEdits: context.editLog` to `critic.evaluate`.

**Three changes in `runner.ts`:**

1. Import `SHARED_EDIT_INSTRUCTIONS` and `EditEntry`.
2. Where `context` is built (line ~278: `const context = { projectPath, stateManager };`), add `editLog: [] as EditEntry[]`.
3. In the enhanced system prompt assembly (line ~277), append `SHARED_EDIT_INSTRUCTIONS`.
4. In the auto-revision loop, reset `context.editLog = []` before each revision iteration.
5. Pass `appliedEdits: context.editLog` to `critic.evaluate(...)`.

- [ ] **Step 1: Add imports**

At the top of `src/core/runner.ts`, add to the existing imports:

```typescript
import { SHARED_EDIT_INSTRUCTIONS } from '../specialists/shared.js';
import { EditEntry } from '../tools/types.js';
```

- [ ] **Step 2: Build context with a fresh editLog**

Find (around line 278):
```typescript
    const context = { projectPath, stateManager };
```
Change to:
```typescript
    const context: ToolExecutionContext = { projectPath, stateManager, editLog: [] as EditEntry[] };
```
(If `ToolExecutionContext` is not already imported in runner.ts, add it to the existing `../tools/types.js` import.)

- [ ] **Step 3: Append shared instructions to the system prompt**

Find (around line 277):
```typescript
    const enhancedSystemPrompt = `${specialist.systemPrompt}\n\n${discovery.discoveryText}${existingBaselineText}`;
```
Change to:
```typescript
    const enhancedSystemPrompt = `${specialist.systemPrompt}\n\n${discovery.discoveryText}${existingBaselineText}${SHARED_EDIT_INSTRUCTIONS}`;
```

- [ ] **Step 4: Reset editLog before each revision iteration**

In the auto-revision `while` loop, find where the revision agent loop is invoked (the block starting with `const revisionResult = await runAgentToolLoop({...})`). Immediately before that call, add:

```typescript
          // Reset the edit log so the critic sees only this revision's edits.
          context.editLog = [];
```

- [ ] **Step 5: Pass appliedEdits to the critic**

Find the `critic.evaluate({...})` call (around line 325). It currently looks like:
```typescript
        criticResult = await critic.evaluate({
          model,
          artifactContent: artifactForCritic,
          rubric: specialist.criticRubric || '',
          secretSauceExamples: specialist.secretSauceExamples,
          userExamples: customExamples,
          programBaselineDocuments: programBaselineDocs
        });
```
Add the `appliedEdits` field:
```typescript
        criticResult = await critic.evaluate({
          model,
          artifactContent: artifactForCritic,
          rubric: specialist.criticRubric || '',
          secretSauceExamples: specialist.secretSauceExamples,
          userExamples: customExamples,
          programBaselineDocuments: programBaselineDocs,
          appliedEdits: context.editLog
        });
```

- [ ] **Step 6: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: may FAIL because `CriticEvaluateOptions` doesn't yet have `appliedEdits` — that's Task 8. **If the type error is only about `appliedEdits` not existing on `CriticEvaluateOptions`, proceed to Task 8 and come back.** To keep tasks independently green, do Task 8 first, then return to this task's verification. (Tasks 7 and 8 are tightly coupled — it's fine to implement them in sequence and verify together.)

- [ ] **Step 7: Commit (after Task 8 makes tsc green)**

Deferred to after Task 8.

---

## Task 8: Critic accepts appliedEdits + change log in prompt

**Files:**
- Modify: `src/core/critic.ts`
- Test: `tests/critic-edit-log.test.ts`

**Interfaces:**
- Consumes: `EditEntry` from `src/tools/types.js`
- Produces: `CriticEvaluateOptions.appliedEdits?: EditEntry[]`; critic prompt includes a change-log section when present.

- [ ] **Step 1: Write the failing test**

Create `tests/critic-edit-log.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CriticEvaluator } from '../src/core/critic.js';
import { EditEntry } from '../src/tools/types.js';

describe('Critic appliedEdits change log', () => {
  it('includes the change log in the critic prompt when appliedEdits is provided', async () => {
    const captured: string[] = [];
    const mockClient = {
      chatCompletion: vi.fn(async (opts: any) => {
        captured.push(opts.messages[0].content);
        return {
          content: JSON.stringify({
            passed: true,
            score: 9,
            summary: 'ok',
            strengths: ['good'],
            weaknesses: [],
            actionableGuidance: ''
          }),
          toolCalls: []
        };
      })
    } as any;

    const edits: EditEntry[] = [
      {
        path: 'docs/CONOPS.md',
        oldText: 'TBD: battery',
        newText: '48V LiFePO4',
        matchedLineRange: { start: 42, end: 42 },
        timestamp: '2026-09-16T00:00:00.000Z'
      }
    ];

    const critic = new CriticEvaluator(mockClient);
    await critic.evaluate({
      model: 'test-model',
      artifactContent: '# CONOPS\n\n48V LiFePO4',
      rubric: 'rubric',
      secretSauceExamples: [],
      userExamples: [],
      appliedEdits: edits
    });

    expect(captured.length).toBe(1);
    const prompt = captured[0];
    expect(prompt).toContain('TARGETED EDITS APPLIED THIS TURN');
    expect(prompt).toContain('docs/CONOPS.md');
    expect(prompt).toContain('TBD: battery');
    expect(prompt).toContain('48V LiFePO4');
    expect(prompt).toContain('L42-42');
  });

  it('omits the change log section when appliedEdits is empty or absent', async () => {
    const captured: string[] = [];
    const mockClient = {
      chatCompletion: vi.fn(async (opts: any) => {
        captured.push(opts.messages[0].content);
        return {
          content: JSON.stringify({ passed: true, score: 9, summary: 'ok', strengths: [], weaknesses: [], actionableGuidance: '' }),
          toolCalls: []
        };
      })
    } as any;

    const critic = new CriticEvaluator(mockClient);
    await critic.evaluate({
      model: 'test-model',
      artifactContent: '# Doc',
      rubric: 'r',
      secretSauceExamples: [],
      userExamples: []
    });

    expect(captured[0]).not.toContain('TARGETED EDITS APPLIED THIS TURN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/critic-edit-log.test.ts`
Expected: FAIL — `appliedEdits` is not a property on `CriticEvaluateOptions` (TS error) and the prompt doesn't contain the change-log strings.

- [ ] **Step 3: Extend CriticEvaluateOptions + prompt**

Edit `src/core/critic.ts`:

Add the import at the top:
```typescript
import { EditEntry } from '../tools/types.js';
```

Extend the options interface — find:
```typescript
export interface CriticEvaluateOptions {
  model: string;
  artifactContent: string;
  rubric: string;
  secretSauceExamples: string[];
  userExamples: string[];
  programBaselineDocuments?: BaselineDocument[];
}
```
Change to:
```typescript
export interface CriticEvaluateOptions {
  model: string;
  artifactContent: string;
  rubric: string;
  secretSauceExamples: string[];
  userExamples: string[];
  programBaselineDocuments?: BaselineDocument[];
  appliedEdits?: EditEntry[];
}
```

In the `evaluate` method, build a change-log section. After the `baselineSection` is built (the block that sets `baselineSection` from `programBaselineDocuments`), add:

```typescript
    let editLogSection = '';
    if (options.appliedEdits && options.appliedEdits.length > 0) {
      editLogSection = `\nTARGETED EDITS APPLIED THIS TURN (verify these address the user's feedback and do not introduce drift or break cross-document alignment):
${options.appliedEdits.map(e => `- [${e.path}] L${e.matchedLineRange.start}-${e.matchedLineRange.end}: "${e.oldText}" → "${e.newText}"`).join('\n')}
Review the full updated document below, focusing attention on the edited regions and their downstream effects.\n`;
    }
```

Then in the prompt template, inject `${editLogSection}` immediately before the `DRAFT ARTIFACT TO EVALUATE:` line. The current prompt ends with:

```typescript
${options.userExamples.length > 0 ? `USER CUSTOM EXAMPLES:\n${options.userExamples.join('\n\n')}` : ''}

DRAFT ARTIFACT TO EVALUATE:
${options.artifactContent}
```

Change to:

```typescript
${options.userExamples.length > 0 ? `USER CUSTOM EXAMPLES:\n${options.userExamples.join('\n\n')}` : ''}
${editLogSection}
DRAFT ARTIFACT TO EVALUATE:
${options.artifactContent}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/critic-edit-log.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run full suite + tsc (verifies Task 7 too)**

Run: `npm test`
Expected: all PASS, `tsc --noEmit` clean (the `appliedEdits` field now exists on the options interface, so Task 7's runner change type-checks).

- [ ] **Step 6: Commit (Tasks 7 + 8 together)**

```bash
git add src/core/critic.ts src/core/runner.ts tests/critic-edit-log.test.ts
git commit -m "feat: runner wires editLog + shared instructions; critic receives appliedEdits change log"
```

---

## Task 9: Integration test — end-to-end edit + editLog + version backup + critic

**Files:**
- Test: `tests/fs-edit-integration.test.ts`

**Interfaces:**
- Consumes: `ToolRegistry`, `ProjectStateManager`, `fsEditHandler`, `CriticEvaluator` (mocked client).

- [ ] **Step 1: Write the integration test**

Create `tests/fs-edit-integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { EditEntry } from '../src/tools/types.js';

describe('fs_edit integration: edit + editLog + version backup', () => {
  let tempDir: string;
  let registry: ToolRegistry;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-fsedit-integ-' + Date.now());
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('integ', 'Integration');
    registry = new ToolRegistry();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('edits a drafted doc, captures editLog, and preserves a prior version', async () => {
    const docPath = path.join(tempDir, 'docs', 'CONOPS.md');
    const original = [
      '# CONOPS',
      '',
      '## 1 Purpose',
      'Build a solar shed.',
      '',
      '## 3.2 Power',
      'TBD: battery',
      '12V lead acid.'
    ].join('\n');
    fs.writeFileSync(docPath, original, 'utf-8');

    const editLog: EditEntry[] = [];
    const ctx = { projectPath: tempDir, stateManager: stateMgr, editLog };

    // Simulate a feedback turn: targeted edit via the registry
    const res = await registry.execute(
      'fs_edit',
      {
        path: 'docs/CONOPS.md',
        edits: [
          { old_text: 'TBD: battery', new_text: '48V 100Ah LiFePO4' },
          { old_text: '12V lead acid.', new_text: '48V LiFePO4 bank.' }
        ]
      },
      ctx,
      ['fs_edit', 'fs_read']
    );

    expect(res.success).toBe(true);

    // editLog captured both edits
    expect(editLog.length).toBe(2);
    expect(editLog[0].newText).toBe('48V 100Ah LiFePO4');
    expect(editLog[1].newText).toBe('48V LiFePO4 bank.');

    // Version backup preserved the pre-edit content
    const versionsDir = path.join(tempDir, '.starn', 'versions');
    const backups = fs.readdirSync(versionsDir).filter(f => f.startsWith('CONOPS-'));
    expect(backups.length).toBe(1);
    expect(fs.readFileSync(path.join(versionsDir, backups[0]), 'utf-8')).toBe(original);

    // Updated doc has the new content + preserved untouched sections
    const updated = fs.readFileSync(docPath, 'utf-8');
    expect(updated).toContain('48V 100Ah LiFePO4');
    expect(updated).toContain('48V LiFePO4 bank.');
    expect(updated).toContain('# CONOPS');
    expect(updated).toContain('## 1 Purpose');
    expect(updated).toContain('Build a solar shed.');
    // The pre-edit content is gone
    expect(updated).not.toContain('TBD: battery');
    expect(updated).not.toContain('12V lead acid.');
  });

  it('a failed edit batch leaves the file, editLog, and version backups untouched', async () => {
    const docPath = path.join(tempDir, 'docs', 'SOW.md');
    fs.writeFileSync(docPath, '# SOW\n\nbody', 'utf-8');
    const original = fs.readFileSync(docPath, 'utf-8');

    const editLog: EditEntry[] = [];
    const ctx = { projectPath: tempDir, stateManager: stateMgr, editLog };

    const res = await registry.execute(
      'fs_edit',
      {
        path: 'docs/SOW.md',
        edits: [
          { old_text: 'body', new_text: 'new body' },
          { old_text: 'NONEXISTENT', new_text: 'x' }
        ]
      },
      ctx,
      ['fs_edit']
    );

    expect(res.success).toBe(false);
    expect(fs.readFileSync(docPath, 'utf-8')).toBe(original);
    expect(editLog.length).toBe(0);
    // No version backup created for the failed attempt
    const versionsDir = path.join(tempDir, '.starn', 'versions');
    if (fs.existsSync(versionsDir)) {
      const backups = fs.readdirSync(versionsDir).filter(f => f.startsWith('SOW-'));
      expect(backups.length).toBe(0);
    }
  });
});
```

**Note:** Because the handler creates the version backup *after* all edits verify (Task 3 places `createVersionBackup` after the verification loop, before the write), a failed batch leaves no orphan backup — the integration test above asserts this correctly. No handler change is needed in this task.

- [ ] **Step 2: Add no-backup assertion to the "rejects batch" unit test**

In `tests/fs-edit-handler.test.ts`, find the test `it('rejects the entire batch when one edit does not match (no write)', ...)` and add this assertion at the end (before the closing `});`), so the unit suite also pins the no-backup-on-failure contract:

```typescript
    const versionsDir = path.join(tempDir, '.starn', 'versions');
    if (fs.existsSync(versionsDir)) {
      const backups = fs.readdirSync(versionsDir).filter(f => f.startsWith('CONOPS-'));
      expect(backups.length).toBe(0);
    }
```

- [ ] **Step 3: Run the integration test**

Run: `npx vitest run tests/fs-edit-integration.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 4: Run the updated fs-edit-handler unit tests**

Run: `npx vitest run tests/fs-edit-handler.test.ts`
Expected: PASS (the "rejects batch" test now also asserts no backup).

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/tools/handlers/fs-edit.ts tests/fs-edit-handler.test.ts tests/fs-edit-integration.test.ts
git commit -m "feat: move version backup after verification; add end-to-end integration test"
```

---

## Task 10: Final verification + spec coverage check

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite one final time**

Run: `npm test`
Expected: all tests PASS, `tsc --noEmit` clean.

- [ ] **Step 2: Spec coverage spot-check**

Verify each spec section has a corresponding implementation:
- §1 schema → `fs_edit` definition in `src/tools/handlers/fs-edit.ts` ✓
- §2 handler behavior → atomic apply, success/failure responses, scope guard ✓
- §3 version history → `src/util/version-backup.ts` + wired into both handlers ✓
- §4 change log → `EditEntry` + `editLog` on context + critic `appliedEdits` ✓
- §5 specialist prompt + runner → `SHARED_EDIT_INSTRUCTIONS` + runner wiring + allow-lists ✓
- §6 testing → unit + integration + critic tests ✓

- [ ] **Step 3: Manual smoke test (optional, if OpenRouter key available)**

```bash
npm start
```
Load the existing "Electric tractor test" project, select a drafted doc, provide feedback, and confirm:
- The model calls `fs_edit` (visible in status / logs) rather than `fs_write`
- Only the targeted region changes
- A version backup appears in `.starn/versions/`
- The critic output references the applied edits

- [ ] **Step 4: No commit unless fixes were made**

If the smoke test surfaces issues, fix and commit them. Otherwise, the feature is complete.
