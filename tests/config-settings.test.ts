import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, saveUserConfig } from '../src/config.js';

describe('Digital Twin & Local Model Config', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists and loads local digital twin endpoint and model', () => {
    saveUserConfig(
      {
        digitalTwinProvider: 'local',
        digitalTwinBaseUrl: 'http://192.168.1.50:11434/v1',
        digitalTwinModel: 'llama3.3:70b'
      },
      tempDir
    );

    const config = loadConfig(tempDir);
    expect(config.digitalTwinProvider).toBe('local');
    expect(config.digitalTwinBaseUrl).toBe('http://192.168.1.50:11434/v1');
    expect(config.digitalTwinModel).toBe('llama3.3:70b');
  });
});
