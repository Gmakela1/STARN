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
    // e.g. SOW-2026-09-16T14-22-03.963Z.md — colons replaced with dashes, ms dot preserved
    expect(basename).not.toContain(':');
    expect(basename).toMatch(/^SOW-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.md$/);
  });
});
