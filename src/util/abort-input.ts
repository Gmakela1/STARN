/**
 * Attaches a keypress listener to stdin that aborts `controller` when the ESC
 * key (\x1b) is pressed. Returns a detach function that restores stdin.
 *
 * Only active during an in-flight turn (the caller attaches before the turn
 * and detaches after), so it never conflicts with inquirer prompts (which
 * manage their own raw mode).
 *
 * If stdin does not support raw mode (piped input, non-TTY, or setRawMode
 * throws), this is a safe no-op — the controller simply will not be aborted
 * by the keyboard, and Ctrl+C still exits the process via the SIGINT handler.
 */
export function attachAbortListener(
  controller: AbortController,
  stdin: NodeJS.ReadStream = process.stdin
): () => void {
  // Bail out if stdin isn't a TTY (raw mode unsupported).
  if (!stdin.isTTY) {
    return () => { /* no-op */ };
  }

  let wasRaw = false;
  try {
    stdin.setRawMode(true);
    wasRaw = true;
  } catch (_e) {
    // Raw mode unsupported — degrade gracefully (no ESC abort).
    return () => { /* no-op */ };
  }

  const onData = (chunk: Buffer) => {
    // ESC byte (0x1b). Only the first byte matters; multi-byte escapes (arrows)
    // start with 0x1b followed by '[' — the ESC handler fires on the first byte
    // which is enough to signal a stop.
    if (chunk.length > 0 && chunk[0] === 0x1b) {
      try {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      } catch (_e) {
        // idempotent — ignore double-abort
      }
    }
  };

  stdin.on('data', onData);
  stdin.resume();

  return () => {
    stdin.off('data', onData);
    if (wasRaw) {
      try {
        stdin.setRawMode(false);
      } catch (_e) {
        // ignore
      }
    }
    try {
      stdin.pause();
    } catch (_e) {
      // ignore
    }
  };
}
