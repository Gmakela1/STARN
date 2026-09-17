import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runDiscovery } from '../src/core/discovery.js';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('runDiscovery exclusions', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-disc-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('test', 'Test');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('excludes dist, tests, testbed, .pi, .vscode directories', async () => {
    for (const dir of ['dist', 'tests', 'testbed', '.pi', '.vscode', 'build', 'coverage']) {
      fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, dir, 'file.txt'), 'noise');
    }
    const result = await runDiscovery(tmpDir, stateMgr);
    expect(result.existingFiles).not.toContain('dist/file.txt');
    expect(result.existingFiles).not.toContain('tests/file.txt');
    expect(result.existingFiles).not.toContain('testbed/file.txt');
    expect(result.existingFiles).not.toContain('.pi/file.txt');
    expect(result.existingFiles).not.toContain('.vscode/file.txt');
    expect(result.existingFiles).not.toContain('build/file.txt');
    expect(result.existingFiles).not.toContain('coverage/file.txt');
  });

  it('excludes logs, wav, lockfiles, tsconfig, .env, .gitignore', async () => {
    fs.writeFileSync(path.join(tmpDir, 'debug.log'), 'noise');
    fs.writeFileSync(path.join(tmpDir, 'voice.wav'), 'noise');
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.env'), 'KEY=val');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules');
    const result = await runDiscovery(tmpDir, stateMgr);
    expect(result.existingFiles).not.toContain('debug.log');
    expect(result.existingFiles).not.toContain('voice.wav');
    expect(result.existingFiles).not.toContain('package-lock.json');
    expect(result.existingFiles).not.toContain('yarn.lock');
    expect(result.existingFiles).not.toContain('tsconfig.json');
    expect(result.existingFiles).not.toContain('.env');
    expect(result.existingFiles).not.toContain('.gitignore');
  });

  it('keeps reference/ and examples/ files enumerated by name', async () => {
    fs.mkdirSync(path.join(tmpDir, 'reference'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'reference', 'motor-specs.pdf'), '%PDF');
    fs.writeFileSync(path.join(tmpDir, 'reference', 'datasheet.txt'), 'specs');
    const result = await runDiscovery(tmpDir, stateMgr);
    expect(result.referenceFiles).toContain('reference/motor-specs.pdf');
    expect(result.referenceFiles).toContain('reference/datasheet.txt');
  });
});
