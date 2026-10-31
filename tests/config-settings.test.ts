import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, saveUserConfig, DEFAULT_VOICE_INPUT_MODEL } from '../src/config.js';

describe('voiceInputModel setting (config round-trip)', () => {
  const originalEnv = process.env;
  let tempHome: string;
  let tempGlobalDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempHome = path.join(os.tmpdir(), 'starn-voice-config-' + Date.now());
    fs.mkdirSync(tempHome, { recursive: true });
    tempGlobalDir = path.join(tempHome, '.starn');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('defaults to openai/whisper-large-v3 when unset', () => {
    expect(DEFAULT_VOICE_INPUT_MODEL).toBe('openai/whisper-large-v3');
    const config = loadConfig(tempGlobalDir);
    expect(config.voiceInputModel).toBe('openai/whisper-large-v3');
  });

  it('persists and reloads voiceInput.model via saveUserConfig', () => {
    saveUserConfig({ voiceInput: { model: 'openai/gpt-4o-mini-transcribe' } }, tempGlobalDir);
    const config = loadConfig(tempGlobalDir);
    expect(config.voiceInputModel).toBe('openai/gpt-4o-mini-transcribe');
  });

  it('STARN_VOICE_INPUT_MODEL env override wins over the config file', () => {
    saveUserConfig({ voiceInput: { model: 'openai/whisper-large-v3' } }, tempGlobalDir);
    process.env.STARN_VOICE_INPUT_MODEL = 'openai/whisper-large-v3-turbo';
    const config = loadConfig(tempGlobalDir);
    expect(config.voiceInputModel).toBe('openai/whisper-large-v3-turbo');
  });

  it('falls back to the default for empty/whitespace values', () => {
    saveUserConfig({ voiceInput: { model: '   ' } }, tempGlobalDir);
    const config = loadConfig(tempGlobalDir);
    expect(config.voiceInputModel).toBe('openai/whisper-large-v3');
  });
});
