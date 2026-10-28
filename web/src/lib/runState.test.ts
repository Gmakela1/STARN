import { describe, expect, it } from 'vitest';
import { deriveRunState } from './runState';

// Design §5.H — derivation table. Order (first match wins):
// failed → working → waiting → finished → ready, with the design's
// (autopilotRunning && !waiting) → working clause.
const base = () => ({
  busy: false,
  checkpoint: false,
  autopilotRunning: false,
  openQuestions: 0,
  blocks: 0,
  lastError: null,
  passedCount: 0,
});

describe('deriveRunState', () => {
  it('returns failed when blocks > 0 or a last error is present', () => {
    expect(deriveRunState({ ...base(), blocks: 2 })).toBe('failed');
    expect(deriveRunState({ ...base(), lastError: 'phase crashed' })).toBe('failed');
  });

  it('failed beats working and waiting', () => {
    expect(deriveRunState({ ...base(), blocks: 1, busy: true })).toBe('failed');
    expect(deriveRunState({ ...base(), lastError: 'boom', checkpoint: true, openQuestions: 1 })).toBe('failed');
  });

  it('returns working while the turn is busy', () => {
    expect(deriveRunState({ ...base(), busy: true })).toBe('working');
  });

  it('busy beats waiting (busy checked before checkpoint)', () => {
    expect(deriveRunState({ ...base(), busy: true, checkpoint: true, openQuestions: 3 })).toBe('working');
  });

  it('returns waiting while a checkpoint is pending', () => {
    expect(deriveRunState({ ...base(), checkpoint: true })).toBe('waiting');
  });

  it('returns waiting while the autopilot runs with open questions', () => {
    expect(deriveRunState({ ...base(), autopilotRunning: true, openQuestions: 2 })).toBe('waiting');
  });

  it('waiting beats finished when a checkpoint is set but not busy', () => {
    expect(deriveRunState({ ...base(), checkpoint: true, passedCount: 5, openQuestions: 0 })).toBe('waiting');
  });

  it('returns working while the autopilot runs with nothing waiting on input', () => {
    expect(deriveRunState({ ...base(), autopilotRunning: true })).toBe('working');
  });

  it('returns finished when idle with passed work and nothing open', () => {
    expect(deriveRunState({ ...base(), passedCount: 6 })).toBe('finished');
  });

  it('never reports finished with open questions or blocks', () => {
    expect(deriveRunState({ ...base(), passedCount: 6, openQuestions: 1 })).toBe('ready');
    expect(deriveRunState({ ...base(), passedCount: 6, blocks: 1 })).toBe('failed');
  });

  it('returns ready by default (nothing running)', () => {
    expect(deriveRunState(base())).toBe('ready');
  });
});