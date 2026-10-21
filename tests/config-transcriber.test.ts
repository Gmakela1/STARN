import { describe, it, expect } from 'vitest';
import { resolveAssignments, transcriptionEnabled, MODEL_ROLES, OPENROUTER_PROVIDER_ID, DEFAULT_TRANSCRIBER_MODEL } from '../src/config.js';

describe('transcriber role', () => {
  it('defaults to openrouter + gemini-2.5-flash when unset', () => {
    const a = resolveAssignments({}, {});
    const t = a.transcriber;
    expect(t.providerId).toBe(OPENROUTER_PROVIDER_ID);
    expect(t.model).toBe(DEFAULT_TRANSCRIBER_MODEL);
  });

  it('honors an explicit assignment', () => {
    const a = resolveAssignments({ assignments: { transcriber: { providerId: 'ollama', model: 'qwen2.5vl:7b' } } }, {});
    expect(a.transcriber.model).toBe('qwen2.5vl:7b');
    expect(a.transcriber.providerId).toBe('ollama');
  });

  it('is not overridden by STARN_MODEL env', () => {
    const a = resolveAssignments({}, { STARN_MODEL: 'some/local-model' });
    expect(a.transcriber.model).toBe(DEFAULT_TRANSCRIBER_MODEL);
  });

  it('appears in MODEL_ROLES', () => {
    expect(MODEL_ROLES).toContain('transcriber');
  });
});

describe('transcription toggle', () => {
  it('defaults enabled', () => {
    expect(transcriptionEnabled({}, {})).toBe(true);
  });

  it('honors config file off', () => {
    expect(transcriptionEnabled({ transcription: { enabled: false } }, {})).toBe(false);
  });

  it('env override wins over file', () => {
    expect(transcriptionEnabled({ transcription: { enabled: true } }, { STARN_TRANSCRIPTION_ENABLED: '0' })).toBe(false);
    expect(transcriptionEnabled({ transcription: { enabled: false } }, { STARN_TRANSCRIPTION_ENABLED: '1' })).toBe(true);
  });
});