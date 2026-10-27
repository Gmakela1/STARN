import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadProgramBaseline, loadUserExamples } from '../src/core/critic-inputs.js';

describe('loadProgramBaseline', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      'starn-critic-inputs-' + Date.now() + '-' + Math.random().toString(36).substring(2)
    );
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads docs/*.md excluding the specialist own id and empty files', () => {
    fs.writeFileSync(path.join(tempDir, 'docs', 'REQUIREMENTS.md'), '# Requirements\nApproved baseline.', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'docs', 'BOM.md'), '# Bill of Materials\nLedger.', 'utf-8');
    // Same id in a different case must also be excluded.
    fs.writeFileSync(path.join(tempDir, 'docs', 'requirements.md'), 'other case, same id', 'utf-8');
    // Empty / whitespace-only files are skipped.
    fs.writeFileSync(path.join(tempDir, 'docs', 'EMPTY.md'), '', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'docs', 'WHITESPACE.md'), '   \n  ', 'utf-8');
    // Non-markdown is ignored (the runner only reads *.md).
    fs.writeFileSync(path.join(tempDir, 'docs', 'notes.txt'), '# Not markdown', 'utf-8');
    // Nested files are not part of the flat docs/ readdir scan.
    fs.mkdirSync(path.join(tempDir, 'docs', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'docs', 'nested', 'IGNORED.md'), '# nested', 'utf-8');

    const baseline = loadProgramBaseline(tempDir, 'requirements');

    expect(baseline).toEqual([
      { id: 'BOM', path: 'docs/BOM.md', content: '# Bill of Materials\nLedger.' }
    ]);
  });

  it('returns an empty array when docs/ does not exist', () => {
    const tmp = path.join(
      os.tmpdir(),
      'starn-critic-inputs-nodocs-' + Date.now() + '-' + Math.random().toString(36).substring(2)
    );
    try {
      expect(loadProgramBaseline(tmp, 'requirements')).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('loadUserExamples', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      'starn-critic-examples-' + Date.now() + '-' + Math.random().toString(36).substring(2)
    );
    fs.mkdirSync(path.join(tempDir, 'examples', 'conops'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads only .md and .txt files under examples/<specialistId>/', () => {
    fs.writeFileSync(path.join(tempDir, 'examples', 'conops', 'sample.md'), '# Sample', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'examples', 'conops', 'notes.txt'), 'raw text', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'examples', 'conops', 'data.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'examples', 'conops', 'UPPER.MD'), 'ignored extension', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'examples', 'conops', 'empty.md'), '', 'utf-8');

    const examples = loadUserExamples(tempDir, 'conops');

    expect(examples.sort()).toEqual(['', '# Sample', 'raw text']);
  });

  it('returns an empty array when the specialist examples dir is missing', () => {
    expect(loadUserExamples(tempDir, 'architecture')).toEqual([]);
  });
});