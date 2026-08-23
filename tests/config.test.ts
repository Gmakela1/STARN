import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, getGlobalStarnDir, ensureStarnDirs, saveUserConfig } from '../src/config.js';

describe('Config Loader', () => {
  const originalEnv = process.env;
  let tempHome: string;
  let tempGlobalDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempHome = path.join(os.tmpdir(), 'starn-test-home-' + Date.now());
    fs.mkdirSync(tempHome, { recursive: true });
    tempGlobalDir = path.join(tempHome, '.starn');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('loads API key from environment variable', () => {
    process.env.OPENROUTER_API_KEY = 'test-key-123';
    process.env.OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';
    const config = loadConfig(tempGlobalDir);
    expect(config.apiKey).toBe('test-key-123');
    expect(config.defaultModel).toBe('anthropic/claude-3.5-sonnet');
  });

  it('resolves the global .starn directory path under user home directory', () => {
    const dir = getGlobalStarnDir();
    expect(dir).toBe(path.join(os.homedir(), '.starn'));
  });

  it('creates global directories if they do not exist', () => {
    ensureStarnDirs(tempGlobalDir);
    expect(fs.existsSync(tempGlobalDir)).toBe(true);
    expect(fs.existsSync(path.join(tempGlobalDir, 'projects'))).toBe(true);
  });

  it('saves and reads API key and default model to/from config.json', () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;

    saveUserConfig(
      {
        apiKey: 'sk-or-saved-file-key',
        defaultModel: 'openai/gpt-4o'
      },
      tempGlobalDir
    );

    const configFile = path.join(tempGlobalDir, 'config.json');
    expect(fs.existsSync(configFile)).toBe(true);

    const loaded = loadConfig(tempGlobalDir);
    expect(loaded.apiKey).toBe('sk-or-saved-file-key');
    expect(loaded.defaultModel).toBe('openai/gpt-4o');
  });
});
