import { describe, it, expect } from 'vitest';
import { describeAutopilotStartError } from './autopilotError';

const BUSY_MESSAGE =
  "Couldn't start auto-drafting — a turn is already running. Press Stop or wait, then retry.";

describe('describeAutopilotStartError', () => {
  it('maps a turn-in-progress 409 failure to the Stop-or-wait guidance', () => {
    expect(describeAutopilotStartError(new Error('A turn is already in progress'))).toBe(BUSY_MESSAGE);
  });

  it('treats busy wording case-insensitively', () => {
    expect(describeAutopilotStartError(new Error('SESSION BUSY'))).toBe(BUSY_MESSAGE);
    expect(describeAutopilotStartError(new Error('Autopilot already running'))).toBe(BUSY_MESSAGE);
  });

  it('falls back to the generic message with the underlying reason', () => {
    expect(describeAutopilotStartError(new Error('Agent session unavailable'))).toBe(
      "Couldn't start auto-drafting: Agent session unavailable",
    );
  });

  it('surfaces non-Error rejections instead of swallowing them', () => {
    expect(describeAutopilotStartError('network down')).toBe("Couldn't start auto-drafting: network down");
  });

  it('never renders an empty reason', () => {
    expect(describeAutopilotStartError(new Error('   '))).toBe("Couldn't start auto-drafting: unknown error");
  });
});
