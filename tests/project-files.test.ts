import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  saveExample,
  saveReference,
  listLibrary,
  removeLibraryFile
} from '../src/workspace/project-files.js';

describe('Project files: examples and references', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves markdown and text examples under examples/<specialistId>/', async () => {
    const res = await saveExample(tmpDir, 'conops', 'sample.md', Buffer.from('# Example'));
    expect(res.savedPath).toBe('examples/conops/sample.md');
    expect(res.filename).toBe('sample.md');
    expect(fs.readFileSync(path.join(tmpDir, res.savedPath), 'utf-8')).toBe('# Example');

    const txtRes = await saveExample(tmpDir, 'conops', 'notes.txt', Buffer.from('Plain text notes'));
    expect(txtRes.savedPath).toBe('examples/conops/notes.txt');
    expect(fs.readFileSync(path.join(tmpDir, txtRes.savedPath), 'utf-8')).toBe('Plain text notes');
  });

  it('prevents filename collisions by adding -2, -3 suffixes', async () => {
    await saveExample(tmpDir, 'conops', 'sample.md', Buffer.from('one'));
    const second = await saveExample(tmpDir, 'conops', 'sample.md', Buffer.from('two'));
    expect(second.filename).toBe('sample-2.md');
    expect(fs.readFileSync(path.join(tmpDir, second.savedPath), 'utf-8')).toBe('two');

    const third = await saveExample(tmpDir, 'conops', 'sample.md', Buffer.from('three'));
    expect(third.filename).toBe('sample-3.md');
  });

  it('rejects forbidden file extensions for examples', async () => {
    await expect(saveExample(tmpDir, 'conops', 'virus.exe', Buffer.from('bad'))).rejects.toThrow(
      /unsupported file type/i
    );
    await expect(saveExample(tmpDir, 'conops', 'image.png', Buffer.from('bad'))).rejects.toThrow(
      /unsupported file type/i
    );
  });

  it('rejects path traversal attempts', async () => {
    await expect(saveExample(tmpDir, 'conops', '../../etc/passwd', Buffer.from('bad'))).rejects.toThrow(
      /invalid filename/i
    );
    await expect(saveReference(tmpDir, '../../etc/passwd', Buffer.from('bad'))).rejects.toThrow(
      /invalid filename/i
    );
  });

  it('rejects files larger than 10MB', async () => {
    const bigBuf = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(saveExample(tmpDir, 'conops', 'big.md', bigBuf)).rejects.toThrow(/exceeds/i);
    await expect(saveReference(tmpDir, 'big.pdf', bigBuf)).rejects.toThrow(/exceeds/i);
  });

  it('saveReference saves allowed files in reference/ folder', async () => {
    const res = await saveReference(tmpDir, 'datasheet.pdf', Buffer.from('pdf data'));
    expect(res.savedPath).toBe('reference/datasheet.pdf');
    expect(fs.existsSync(path.join(tmpDir, res.savedPath))).toBe(true);
  });

  it('lists and removes library files', async () => {
    await saveReference(tmpDir, 'datasheet.pdf', Buffer.from('pdf'));
    await saveExample(tmpDir, 'conops', 'ex.md', Buffer.from('ex'));

    const list = listLibrary(tmpDir);
    expect(list.references.map(r => r.name)).toContain('datasheet.pdf');
    expect(list.examples.conops.map(e => e.name)).toContain('ex.md');

    removeLibraryFile(tmpDir, { kind: 'reference', name: 'datasheet.pdf' });
    expect(listLibrary(tmpDir).references).toHaveLength(0);

    removeLibraryFile(tmpDir, { kind: 'example', specialistId: 'conops', name: 'ex.md' });
    expect(listLibrary(tmpDir).examples.conops).toBeUndefined();
  });

  it('removeLibraryFile throws on non-existent file or path traversal', () => {
    expect(() => removeLibraryFile(tmpDir, { kind: 'reference', name: 'missing.pdf' })).toThrow(
      /not found/i
    );
    expect(() =>
      removeLibraryFile(tmpDir, { kind: 'reference', name: '../secret.txt' })
    ).toThrow(/invalid/i);
  });
});
