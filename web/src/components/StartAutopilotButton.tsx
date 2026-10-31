import { useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { describeAutopilotStartError } from '../lib/autopilotError';
// React Bits (reactbits.dev) decorative border effect — see web/src/components/reactbits.
import StarBorder from './reactbits/StarBorder';

interface StartAutopilotButtonProps {
  /** True while the autopilot turn is running → render Stop instead of Start. */
  running: boolean;
  /** api.autopilotStart — rejections are mapped to inline busy/failure copy. */
  onStart: () => Promise<void>;
  /** api.autopilotStop — rejections surface a role=alert (no silent catch). */
  onStop: () => Promise<void>;
  /** 'full' (default): labelled pill for the doc header. 'icon': 44x44
   * icon-only control for the chat composer (44px touch rule). */
  size?: 'full' | 'icon';
}

/**
 * Board #57 — start/stop autopilot controls extracted from DevelopmentView so
 * the start flow (disabled-while-pending, 409 busy alert, alert cleared on
 * success) and the stop failure alert are unit-testable without mounting the
 * whole view. Failure copy for start is mapped by describeAutopilotStartError.
 */
export default function StartAutopilotButton({
  running,
  onStart,
  onStop,
  size = 'full'
}: StartAutopilotButtonProps) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      await onStart();
    } catch (err) {
      setError(describeAutopilotStartError(err));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    setError(null);
    try {
      await onStop();
    } catch (err) {
      setError(`Couldn't stop auto-drafting: ${(err as Error).message}`);
    } finally {
      setStopping(false);
    }
  };

  if (running) {
    if (size === 'icon') {
      return (
        <span className="relative flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={stopping}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-rose-600/40 bg-rose-950/60 text-rose-300 transition hover:bg-rose-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3c]/60 disabled:cursor-not-allowed disabled:opacity-40"
            title="Stop autopilot"
            aria-label="Stop autopilot"
          >
            <Square className="h-4 w-4 fill-current" aria-hidden />
          </button>
          {error && (
            <span
              role="alert"
              className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-rose-800/60 bg-rose-950/90 px-2 py-1 text-[11px] text-rose-300"
            >
              {error}
            </span>
          )}
        </span>
      );
    }
    return (
      <span className="relative flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => void handleStop()}
          disabled={stopping}
          className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-md border border-rose-600/40 bg-rose-950/60 px-2.5 text-[11px] font-bold text-rose-300 transition hover:bg-rose-900/70 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Stop autopilot"
        >
          <Square className="h-3 w-3 fill-current" aria-hidden />
          Stop
        </button>
        {error && (
          <span
            role="alert"
            className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-rose-800/60 bg-rose-950/90 px-2 py-1 text-[11px] text-rose-300"
          >
            {error}
          </span>
        )}
      </span>
    );
  }

  if (size === 'icon') {
    return (
      <span className="relative flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={starting}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-rose-700/40 bg-[#d61f2c] text-white transition hover:bg-[#e11d3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3c]/60 disabled:cursor-not-allowed disabled:opacity-40"
          title="Start autopilot auto-drafting"
          aria-label="Start autopilot auto-drafting"
        >
          {starting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Play className="h-4 w-4 fill-current" aria-hidden />
          )}
        </button>
        {error && (
          <span
            role="alert"
            className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-rose-800/60 bg-rose-950/90 px-2 py-1 text-[11px] text-rose-300"
          >
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="relative flex shrink-0 items-center">
      {/* StarBorder (React Bits) renders the same <button>: classes, disabled
          state, aria-label and handlers are forwarded unchanged; the canvas is
          aria-hidden so the accessible name is untouched. */}
      <StarBorder
        as="button"
        type="button"
        onClick={() => void handleStart()}
        disabled={starting}
        className="cut-corner flex min-h-[44px] shrink-0 items-center gap-1 rounded-none bg-[#d61f2c] px-3.5 text-xs font-semibold text-white transition hover:bg-[#e11d3f] saber-on disabled:cursor-not-allowed disabled:opacity-40"
        style={{ padding: '0.875rem' }}
        backgroundColor="#d61f2c"
        textColor="#ffffff"
        color="#ff2a3c"
        trailColor="#d9a441"
        duration={6}
        thickness={2}
        glow={0.7}
        radius={0}
        aria-label="Start autopilot auto-drafting"
      >
        {starting ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <Play className="h-3 w-3 fill-current" aria-hidden />
        )}
        Start Auto-Drafting
      </StarBorder>
      {error && (
        <span
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-rose-800/60 bg-rose-950/90 px-2 py-1 text-[11px] text-rose-300"
        >
          {error}
        </span>
      )}
    </span>
  );
}
