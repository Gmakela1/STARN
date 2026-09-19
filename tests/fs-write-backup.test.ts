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
