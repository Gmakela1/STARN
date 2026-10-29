import { useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

/**
 * Clamped, keyboard-resizable pane divider (design §5.I).
 * Pointer drag + keyboard fallback; emits onChange during the change and
 * onCommit when the interaction ends (persist point).
 */

export interface PaneSplitterProps {
  /** Left pane width as a percentage (0–100). */
  leftPct: number;
  /** Emitted on every value change (drag move / key press). */
  onChange: (pct: number) => void;
  /** Emitted when an interaction ends (pointerup / key press) — persist here. */
  onCommit?: (pct: number) => void;
  /** Clamp floor, e.g. 340px expressed as a % of the container. */
  minPct: number;
  /** Clamp ceiling (100 − minPct% so the right pane keeps its floor). */
  maxPct: number;
  label?: string;
}

function clampPct(value: number, minPct: number, maxPct: number): number {
  return Math.min(Math.max(value, minPct), maxPct);
}

export default function PaneSplitter({
  leftPct,
  onChange,
  onCommit,
  minPct,
  maxPct,
  label,
}: PaneSplitterProps) {
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startPctRef = useRef(0);
  const paneWidthRef = useRef(1);

  const recordDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    startXRef.current = e.clientX;
    startPctRef.current = leftPct;
    const parent = e.currentTarget.parentElement;
    const rectWidth = parent?.getBoundingClientRect().width ?? 0;
    // jsdom / hidden containers report 0 — fall back to the window width so
    // the % math degrades predictably during tests.
    paneWidthRef.current = rectWidth > 0 ? rectWidth : window.innerWidth || 1;
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    recordDragStart(e);
    draggingRef.current = true;
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const deltaPct = ((e.clientX - startXRef.current) / paneWidthRef.current) * 100;
    onChange(clampPct(startPctRef.current + deltaPct, minPct, maxPct));
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const deltaPct = ((e.clientX - startXRef.current) / paneWidthRef.current) * 100;
    onCommit?.(clampPct(startPctRef.current + deltaPct, minPct, maxPct));
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        next = leftPct - 2;
        break;
      case 'ArrowRight':
        next = leftPct + 2;
        break;
      case 'Home':
        next = minPct;
        break;
      case 'End':
        next = maxPct;
        break;
      default:
        return;
    }
    e.preventDefault();
    const clamped = clampPct(next, minPct, maxPct);
    onChange(clamped);
    onCommit?.(clamped);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label ?? 'Resize question and document panes'}
      aria-valuenow={leftPct}
      aria-valuemin={minPct}
      aria-valuemax={maxPct}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
      className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-slate-900 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
    >
      <span className="h-8 w-0.5 rounded-full bg-slate-700 group-hover:bg-cyan-500/60" aria-hidden />
    </div>
  );
}