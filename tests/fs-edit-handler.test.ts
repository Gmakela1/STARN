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
    // No version backup created for a failed batch (backup is after verification)
    const versionsDir = path.join(tempDir, '.starn', 'versions');
    if (fs.existsSync(versionsDir)) {
      const backups = fs.readdirSync(versionsDir).filter(f => f.startsWith('CONOPS-'));
      expect(backups.length).toBe(0);
    }
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
    expect(res.error).toContain('matched 2');
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
