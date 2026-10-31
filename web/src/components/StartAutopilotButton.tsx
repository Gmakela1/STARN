import { useEffect, useRef, useState } from 'react';
import { Loader2, Rocket, Sparkles, Square } from 'lucide-react';
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
  /** 'full' (default): labelled StarBorder pill for the dashboard/doc header.
   * 'icon': 44x44 icon-only control (44px touch rule). 'composer': 56x56
   * icon-only rocket control, bottom-aligned with the PromptBar row. */
  size?: 'full' | 'icon' | 'composer';
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
  // One-shot idle→running transition flag: the button owns the timing on the
  // `running` edge (false→true fires the flag, cleared after 900ms) so the
  // composer variant plays the rocket launch + spark burst exactly once and
  // never replays it on remount while already running. Only the composer
  // variant consumes `launched`; the full/icon variants are rocket-free.
  const prevRunning = useRef(running);
  const [launched, setLaunched] = useState(false);
  useEffect(() => {
    if (running && !prevRunning.current) {
      prevRunning.current = true;
      setLaunched(true);
      const timer = setTimeout(() => setLaunched(false), 900);
      return () => clearTimeout(timer);
    }
    if (!running) prevRunning.current = false;
    return undefined;
  }, [running]);

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
    if (size === 'composer') {
      return (
        <span className="relative flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={stopping}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-rose-600/40 bg-rose-950/60 text-rose-300 transition hover:bg-rose-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3c]/60 disabled:cursor-not-allowed disabled:opacity-40"
            title="Stop autopilot"
            aria-label="Stop autopilot"
          >
            {launched ? (
              // Launch window: the rocket plays the one-shot launch on the
              // idle→running edge before the running layout settles.
              <Rocket className="rocket-launch-safe h-5 w-5 fill-current" aria-hidden />
            ) : (
              <Square className="h-4 w-4 fill-current" aria-hidden />
            )}
          </button>
          {/* Indeterminate 4px bar pinned to the bottom edge — held back during
              the 900ms launch window so the launch plays before settling.
              Static under reduced motion (index.css sets animation:none on
              .bar-slide-safe), dimmed. */}
          {!launched && (
            <span className="pointer-events-none absolute inset-x-2 bottom-1 h-1 overflow-hidden rounded-full bg-rose-900/60" aria-hidden>
              <span className="bar-slide-safe block h-full w-1/3 rounded-full bg-[#ff2a3c] motion-reduce:opacity-70" />
            </span>
          )}
          {/* One-shot spark burst on the idle→running edge; lives on the outer
              span so the rounded-lg button edge cannot clip the dots. */}
          {launched && (
            <span className="pointer-events-none absolute inset-0" aria-hidden="true">
              {[0, 1, 2, 3, 4].map(i => (
                <span
                  key={i}
                  className="spark-burst-safe absolute top-[-2px] block h-1.5 w-1.5 rounded-full bg-[#ffd28a]"
                  style={{ left: `${12 + i * 19}%` }}
                />
              ))}
            </span>
          )}
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

  if (size === 'composer') {
    return (
      <span className="relative flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={starting}
          className="cut-corner flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[#d61f2c] text-white transition hover:bg-[#e11d3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3c]/60 disabled:cursor-not-allowed disabled:opacity-40"
          title="Launch autopilot auto-drafting"
          aria-label="Launch autopilot auto-drafting"
        >
          {starting ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <Rocket className="h-5 w-5 fill-current motion-safe:animate-[sf-breathe_2.4s_ease-in-out_infinite]" aria-hidden />
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

  if (size === 'icon') {
    return (
      <span className="relative flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={starting}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-rose-700/40 bg-[#d61f2c] text-white transition hover:bg-[#e11d3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3c]/60 disabled:cursor-not-allowed disabled:opacity-40"
          title="Launch auto-drafting — drafts docs automatically between gates"
          aria-label="Launch autopilot auto-drafting"
        >
          {starting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4 fill-current motion-safe:animate-[sf-breathe_2.4s_ease-in-out_infinite]" aria-hidden />
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
        aria-label="Launch autopilot auto-drafting"
      >
        {starting ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-3 w-3 fill-current motion-safe:animate-[sf-breathe_2.4s_ease-in-out_infinite]" aria-hidden />
        )}
        Launch Auto-Drafting
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
