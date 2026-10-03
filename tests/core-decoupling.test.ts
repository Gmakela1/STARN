import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const HEADLESS_DIRS = ['core', 'workspace', 'specialists', 'tools'];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('Core Decoupling Verification', () => {
  it('ensures headless modules have zero imports from src/cli or src/server', () => {
    const srcRoot = path.resolve(__dirname, '../src');
    for (const dirName of HEADLESS_DIRS) {
      const dir = path.join(srcRoot, dirName);
      if (!fs.existsSync(dir)) continue;
      for (const file of collectTsFiles(dir)) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(content, `${file} imports from cli`).not.toMatch(/from\s+['"][^'"]*\/cli\//);
        expect(content, `${file} imports from server`).not.toMatch(/from\s+['"][^'"]*\/server\//);
      }
    }
  });
});
