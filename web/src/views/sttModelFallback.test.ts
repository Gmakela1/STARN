// Board #57 — slug pin: STT_MODEL_FALLBACK in web/src/views/SettingsView.tsx
// must stay in lockstep with STT_MODELS in src/openrouter/models.ts (the core
// fallback the server actually uses). These tests pin the exact id list so the
// web list cannot silently drift from core.
import { describe, expect, it } from 'vitest';
import { STT_MODEL_FALLBACK } from './SettingsView';

const CORE_STT_SLUGS = [
  'openai/whisper-large-v3-turbo',
  'openai/gpt-4o-transcribe',
  'openai/gpt-4o-mini-transcribe',
  'microsoft/mai-transcribe-2',
  'microsoft/mai-transcribe-1.5',
  'openai/whisper-large-v3',
  'openai/whisper-1'
];

describe('STT_MODEL_FALLBACK slug pin', () => {
  it('contains exactly the 7 core STT slugs, in core order', () => {
    expect(STT_MODEL_FALLBACK.map(m => m.id)).toEqual(CORE_STT_SLUGS);
  });

  it('has no duplicate ids and every entry has a display name', () => {
    const ids = STT_MODEL_FALLBACK.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const model of STT_MODEL_FALLBACK) {
      expect(model.name.trim().length).toBeGreaterThan(0);
    }
  });
});
