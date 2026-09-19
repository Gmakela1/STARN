import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    // No version backup created for the failed attempt (backup is after verification)
    const versionsDir = path.join(tempDir, '.starn', 'versions');
    if (fs.existsSync(versionsDir)) {
      const backups = fs.readdirSync(versionsDir).filter(f => f.startsWith('SOW-'));
      expect(backups.length).toBe(0);
    }
  });
});
