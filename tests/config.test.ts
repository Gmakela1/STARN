import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, getGlobalStarnDir, ensureStarnDirs } from '../src/config.js';

describe('Config Loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads API key from environment variable', () => {
    process.env.OPENROUTER_API_KEY = 'test-key-123';
    process.env.OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';
    const config = loadConfig();
    expect(config.apiKey).toBe('test-key-123');
    expect(config.defaultModel).toBe('anthropic/claude-3.5-sonnet');
  });

  it('resolves the global .starn directory path under user home directory', () => {
    const dir = getGlobalStarnDir();
    expect(dir).toBe(path.join(os.homedir(), '.starn'));
  });

  it('creates global directories if they do not exist', () => {
    const tempHome = path.join(os.tmpdir(), 'starn-test-home-' + Date.now());
    fs.mkdirSync(tempHome, { recursive: true });
    const dir = path.join(tempHome, '.starn');
    ensureStarnDirs(dir);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'projects'))).toBe(true);
    fs.rmSync(tempHome, { recursive: true, force: true });
  });
});
