// Chat composer autosize: the textarea grows 2 → 6 lines (44 → 122 px) then
// scrolls. Instant (no height animation) per design §5 "Motion".
import { useLayoutEffect, type RefObject } from 'react';

/** Resting height in px = 2 lines at the 18 px/22 px composer metric. */
export const AUTOSIZE_MIN_PX = 44;
/** Cap in px = 6 lines; beyond this the textarea scrolls. */
export const AUTOSIZE_MAX_PX = 122;

/**
 * Size a textarea to its content between the 44 px floor and the 122 px cap.
 *
 * Input: `ref` to the textarea, the controlled `value` (re-measure on change),
 * and `enabled` (false while the composer is replaced by a locked row).
 * Output: none — writes `style.height` and `style.overflowY` on the element.
 * Side effects: DOM style writes only; no state, no timers, no animation.
 */
export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  enabled = true
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    // Collapse first so shrinking (deleting a line) is measured, not ignored.
    el.style.height = '0px';
    const content = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(content, AUTOSIZE_MIN_PX), AUTOSIZE_MAX_PX)}px`;
    el.style.overflowY = content > AUTOSIZE_MAX_PX ? 'auto' : 'hidden';
  }, [ref, value, enabled]);
}
