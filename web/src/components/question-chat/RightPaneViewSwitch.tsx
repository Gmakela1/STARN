// Right-pane Document / Details switch (design 2026-11-03 §3b.3.4, §3b.6(vi)).
// A doc-pane control, not chat: an ARIA tablist (panels, not a mode input) with
// roving tabindex so the group costs ONE Tab stop, and ←/→/Home/End that
// auto-activate (both panels are already mounted). It owns no state and adds no
// keyboard shortcut.
import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { FileText, List } from 'lucide-react';

export type RightPaneView = 'doc' | 'details';

export interface RightPaneViewSwitchProps {
  /** The panel currently shown. */
  value: RightPaneView;
  /** Called on click or arrow auto-activation; never for a disabled tab. */
  onChange: (view: RightPaneView) => void;
  /** No `type === 'question'` item → Details has nothing to show (§3b.6(v)). */
  disabled?: boolean;
}

const TABS = [
  { value: 'doc', label: 'Document', id: 'tab-doc', panel: 'pane-doc', Icon: FileText },
  { value: 'details', label: 'Details', id: 'tab-details', panel: 'pane-details', Icon: List }
] as const;

const BTN =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition focus:ring-2 focus:ring-[#ff2a3c]/60';
const BTN_ON = `${BTN} border-[var(--sf-review)]/75 bg-[var(--sf-review-fill)]/90 text-violet-200`;
const BTN_OFF = `${BTN} border-transparent text-[var(--sf-text-2)] hover:text-[var(--sf-text)]`;
const BTN_DISABLED = `${BTN_OFF} cursor-not-allowed opacity-40`;

/**
 * Document / Details tablist. Inputs/outputs: see `RightPaneViewSwitchProps`.
 * A disabled Details tab keeps `aria-disabled` and stays focusable (ARIA tabs
 * practice); activating it is a no-op. Throws: never.
 */
export default function RightPaneViewSwitch({
  value,
  onChange,
  disabled = false
}: RightPaneViewSwitchProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isTabDisabled = (view: RightPaneView) => view === 'details' && disabled;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = TABS.findIndex(tab => tab.value === value);
    const last = TABS.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = current === last ? 0 : current + 1;
        break;
      case 'ArrowLeft':
        next = current <= 0 ? last : current - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    tabRefs.current[next]?.focus();
    if (!isTabDisabled(TABS[next].value)) onChange(TABS[next].value);
  }

  return (
    <div
      role="tablist"
      aria-label="Right pane view"
      onKeyDown={handleKeyDown}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-white/10 bg-black/35 p-0.5"
    >
      {TABS.map((tab, i) => {
        const selected = tab.value === value;
        const tabDisabled = isTabDisabled(tab.value);
        return (
          <button
            key={tab.value}
            ref={el => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tab.id}
            aria-selected={selected}
            aria-controls={tab.panel}
            aria-disabled={tabDisabled || undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!tabDisabled) onChange(tab.value);
            }}
            className={tabDisabled ? BTN_DISABLED : selected ? BTN_ON : BTN_OFF}
          >
            <tab.Icon className="h-3.5 w-3.5" aria-hidden />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
