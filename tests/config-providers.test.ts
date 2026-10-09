import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, resolveAssignments, validateAssignments, Assignments } from '../src/config.js';

const OR = 'openrouter';

describe('provider + role assignment config', () => {
  let tempDir: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-cfg-prov-'));
    delete process.env.STARN_MODEL;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.STARN_COMPACT_MODEL;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('migrates legacy defaultModel/compactionModel to openrouter assignments', () => {
    const a = resolveAssignments({ defaultModel: 'a/m', compactionModel: 'c/m' }, {});
    expect(a.drafting).toEqual({ providerId: OR, model: 'a/m' });
    expect(a.critic).toEqual({ providerId: OR, model: 'a/m' });
    expect(a.classifier).toEqual({ providerId: OR, model: 'a/m' });
    expect(a.compaction).toEqual({ providerId: OR, model: 'c/m' });
  });

  it('compaction falls back to defaultModel', () => {
    expect(resolveAssignments({ defaultModel: 'a/m' }, {}).compaction).toEqual({ providerId: OR, model: 'a/m' });
  });

  it('keeps explicit assignments', () => {
    const a = resolveAssignments(
      { defaultModel: 'a/m', assignments: { critic: { providerId: 'ollama', model: 'qwen' } } },
      {}
    );
    expect(a.critic).toEqual({ providerId: 'ollama', model: 'qwen' });
    expect(a.drafting).toEqual({ providerId: OR, model: 'a/m' });
  });

  it('env STARN_MODEL overrides openrouter roles only', () => {
    const a = resolveAssignments(
      { defaultModel: 'a/m', assignments: { critic: { providerId: 'ollama', model: 'qwen' } } },
      { STARN_MODEL: 'env/m' }
    );
    expect(a.drafting.model).toBe('env/m');
    expect(a.classifier.model).toBe('env/m');
    expect(a.critic).toEqual({ providerId: 'ollama', model: 'qwen' });
  });

  it('validateAssignments throws naming role and provider', () => {
    const a: Assignments = resolveAssignments({ defaultModel: 'a/m' }, {});
    a.critic = { providerId: 'ghost', model: 'x' };
    expect(() => validateAssignments(a, [])).toThrow(
      'Config error: role "critic" references unknown provider "ghost"'
    );
    expect(() =>
      validateAssignments(a, [{ id: 'ghost', name: 'Ghost', baseUrl: 'http://h/v1' }])
    ).not.toThrow();
  });

  it('loadConfig returns providers [] by default and no digitalTwin* keys', () => {
    const cfg = loadConfig(tempDir) as unknown as Record<string, unknown>;
    expect(cfg.providers).toEqual([]);
    expect(Object.keys(cfg).some(k => k.startsWith('digitalTwin'))).toBe(false);
    expect((cfg.assignments as Assignments).drafting.providerId).toBe(OR);
  });
});
