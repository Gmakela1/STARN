/**
 * Maps a failed `POST /api/autopilot/start` rejection to the inline message the
 * DevelopmentView shows under the action cluster. The server answers 409 with
 * "A turn is already in progress" when the busy guard is held, and the API
 * client surfaces only the envelope's error string — never a status code — so
 * the busy case is detected from the message text.
 */

const BUSY_MESSAGE =
  "Couldn't start auto-drafting — a turn is already running. Press Stop or wait, then retry.";

const BUSY_PATTERN = /already (?:in progress|running)|turn is already|busy/i;

function reasonOf(err: unknown): string {
  if (err instanceof Error && err.message.trim().length > 0) return err.message.trim();
  if (typeof err === 'string' && err.trim().length > 0) return err.trim();
  return 'unknown error';
}

export function describeAutopilotStartError(err: unknown): string {
  const reason = reasonOf(err);
  if (BUSY_PATTERN.test(reason)) return BUSY_MESSAGE;
  return `Couldn't start auto-drafting: ${reason}`;
}
