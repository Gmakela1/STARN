/**
 * Run-state derivation (design §5.H).
 * Single source of truth for the top-bar / panel run-state cluster.
 * First match wins: failed → working → waiting → finished → ready.
 */

export type RunState = 'ready' | 'working' | 'waiting' | 'finished' | 'failed';

export function deriveRunState(i: {
  busy: boolean;
  checkpoint: boolean;
  autopilotRunning: boolean;
  openQuestions: number;
  blocks: number;
  lastError?: string | null;
  passedCount: number;
}): RunState {
  // Failed: blocks parked or a last error.
  if (i.blocks > 0 || i.lastError) return 'failed';

  // Working: a turn is busy…
  if (i.busy) return 'working';

  // Waiting: a checkpoint is pending, or the autopilot is waiting on questions.
  const waiting = i.checkpoint || (i.autopilotRunning && i.openQuestions > 0);
  if (waiting) return 'waiting';

  // Working: autopilot is running with nothing waiting on input
  // (design: busy || (autopilotRunning && !waiting)).
  if (i.autopilotRunning) return 'working';

  // Finished: idle, with passed work and nothing open.
  if (!i.busy && i.passedCount > 0 && i.openQuestions === 0 && i.blocks === 0) return 'finished';

  return 'ready';
}
