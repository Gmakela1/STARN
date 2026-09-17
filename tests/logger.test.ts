import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Logger } from '../src/util/logger.js';

describe('Logger', () => {
  let tmpDir: string;
  let logger: Logger;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-log-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    logger = new Logger(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes info/warn/error lines to a dated log file with timestamps and levels', () => {
    logger.info('turn started');
    logger.warn('rate limited');
    logger.error('api failed');

    const files = fs.readdirSync(path.join(tmpDir, 'logs'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^starn-\d{4}-\d{2}-\d{2}\.log$/);

    const content = fs.readFileSync(path.join(tmpDir, 'logs', files[0]), 'utf-8');
    expect(content).toContain('[INFO]');
    expect(content).toContain('turn started');
    expect(content).toContain('[WARN]');
    expect(content).toContain('rate limited');
    expect(content).toContain('[ERROR]');
    expect(content).toContain('api failed');
  });

  it('appends to the same file within a day', () => {
    logger.info('first');
    logger.info('second');
    const files = fs.readdirSync(path.join(tmpDir, 'logs'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(tmpDir, 'logs', files[0]), 'utf-8');
    expect(content).toContain('first');
    expect(content).toContain('second');
  });
});
