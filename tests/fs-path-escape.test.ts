/**
 * Regression tests for the fs_read/fs_list path guard (prompt-injection
 * audit LOW): prefix startsWith allowed sibling dirs (e.g. '../proj-x/file')
 * and was case-sensitive on win32. Path-guard semantics only — no real fs
 * reads are asserted, only the guard's accept/reject behavior.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolExecutionContext } from '../src/tools/types.js';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('fs_read/fs_list path guard escape regressions', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;
  const originalPlatform = process.platform;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-fs-guard-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'docs', 'file.md'), 'x', 'utf-8');
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('p1', 'Guard Test');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects a sibling directory whose name shares a prefix (fs_read)', async () => {
    const registry = new ToolRegistry();
    const context: ToolExecutionContext = { projectPath: tempDir, stateManager: stateMgr };
    const res = await registry.execute('fs_read', { path: '../' + path.basename(tempDir) + '-x/secret.md' }, context, ['fs_read']);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Path traversal');
  });

  it('rejects a sibling directory whose name shares a prefix (fs_list)', async () => {
    const registry = new ToolRegistry();
    const context: ToolExecutionContext = { projectPath: tempDir, stateManager: stateMgr };
    const res = await registry.execute('fs_list', { dir: '../' + path.basename(tempDir) + '-x' }, context, ['fs_list']);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Path traversal');
  });

  it('win32 semantics: accepts an in-project target typed with different case', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const registry = new ToolRegistry();
    const context: ToolExecutionContext = { projectPath: tempDir, stateManager: stateMgr };
    const upperFile = path.join(tempDir, 'DOCS', 'FILE.MD');
    const res = await registry.execute('fs_read', { path: upperFile }, context, ['fs_read']);
    // Guard must NOT reject: on a case-insensitive FS this is an in-project file
    // (the file may not exist on a case-sensitive FS, which yields 'File not found').
    expect(res.error || '').not.toContain('Path traversal');
  });

  it('win32 semantics: rejects a mixed-case sibling directory', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const registry = new ToolRegistry();
    const context: ToolExecutionContext = { projectPath: tempDir, stateManager: stateMgr };
    const sibling = path.join(tempDir, '..', path.basename(tempDir).toUpperCase() + '-x', 'secret.md');
    const res = await registry.execute('fs_read', { path: sibling }, context, ['fs_read']);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Path traversal');
  });
});
