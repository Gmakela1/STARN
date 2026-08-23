import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('Tool Registry & Safe Handlers', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-tool-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('test-proj', 'Test Project');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('allows reading, writing, and listing files safely inside project path', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    // Write file
    const writeRes = await registry.execute(
      'fs_write',
      { path: 'docs/test.md', content: '# Physical Frame Specs' },
      context,
      ['fs_write', 'fs_read', 'fs_list']
    );
    expect(writeRes.success).toBe(true);

    // Read file
    const readRes = await registry.execute(
      'fs_read',
      { path: 'docs/test.md' },
      context,
      ['fs_write', 'fs_read', 'fs_list']
    );
    expect(readRes.result).toBe('# Physical Frame Specs');

    // List directory
    const listRes = await registry.execute(
      'fs_list',
      { dir: 'docs' },
      context,
      ['fs_list']
    );
    expect(listRes.result).toContain('test.md');
  });

  it('rejects execution when a tool is not in the allowed tool list', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    const result = await registry.execute(
      'fs_write',
      { path: 'danger.txt', content: 'not allowed' },
      context,
      ['fs_read'] // Only fs_read allowed
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool fs_write is not permitted');
  });

  it('prevents directory traversal outside project root', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    const result = await registry.execute(
      'fs_read',
      { path: '../../outside.txt' },
      context,
      ['fs_read']
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal');
  });

  it('handles state reading and state updating via tools', async () => {
    const registry = new ToolRegistry();
    const context = { projectPath: tempDir, stateManager: stateMgr };

    const updateRes = await registry.execute(
      'state_update',
      { phase: 'CONOPS Drafting', addRisk: 'Wind load on roof panels', action: 'Initialized CONOPS' },
      context,
      ['state_update']
    );
    expect(updateRes.success).toBe(true);

    const readRes = await registry.execute(
      'state_read',
      {},
      context,
      ['state_read']
    );
    expect(readRes.success).toBe(true);
    const parsedState = JSON.parse(readRes.result!);
    expect(parsedState.currentPhase).toBe('CONOPS Drafting');
    expect(parsedState.openRisks).toContain('Wind load on roof panels');
  });
});
