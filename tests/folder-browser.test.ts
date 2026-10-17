import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listFolders } from '../src/workspace/folder-browser.js';

describe('listFolders', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folders-'));
    fs.mkdirSync(path.join(tmpDir, 'alpha'));
    fs.mkdirSync(path.join(tmpDir, 'beta', '.starn'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.hidden'));
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists only visible non-dev subdirectories and identifies projects', () => {
    const listing = listFolders(tmpDir);
    expect(listing.folders.map(f => f.name)).toEqual(['alpha', 'beta']);
    expect(listing.folders.find(f => f.name === 'beta')?.isProject).toBe(true);
    expect(listing.folders.find(f => f.name === 'alpha')?.isProject).toBe(false);
    expect(listing.currentPath).toBe(path.resolve(tmpDir));
    expect(listing.parentPath).toBe(path.dirname(path.resolve(tmpDir)));
  });

  it('filters folders by case-insensitive query', () => {
    const listing = listFolders(tmpDir, 'bet');
    expect(listing.folders.map(f => f.name)).toEqual(['beta']);
  });

  it('throws on non-existent or file path', () => {
    expect(() => listFolders(path.join(tmpDir, 'missing'))).toThrow();
    expect(() => listFolders(path.join(tmpDir, 'file.txt'))).toThrow();
  });
});
