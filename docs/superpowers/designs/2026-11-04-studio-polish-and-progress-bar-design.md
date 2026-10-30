# Studio Polish + Top-Bar Progress Widget Design

**Date:** 2026-11-04  
**Status:** Draft for review  
**Scope:** Five targeted fixes to the Engineering Studio layout + a new DocProgressBar in the top bar.

---

## 1. What Changed & Why

| # | Issue | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | Doc header elements overlap at narrow pane widths | PhaseRail (13 dots) + selector dropdown + action cluster compete for space in `h-12` | **Remove PhaseRail from the doc header entirely.** The new top-bar progress bar replaces it as the single project-health indicator. Add ResizeObserver-driven narrow mode to the remaining header elements. |
| 2 | Splitter drag feels like it snaps to discrete positions | CSS `min-w-[340px]` / `max-w-[calc(100%-340px)]` + `grow lg:grow-0` override flexBasis at extremes, creating hard stops. `transition-[flex-basis]` fights direct manipulation. | **Remove CSS clamps and transition.** Let flexBasis + JS minPct/maxPct be the sole constraint. |
| 3 | Requirement-ID highlight auto-fades after 2.4s | `applyAnchorHighlight` uses a `setTimeout` that clears the marker | **Persist highlight** until explicit clear (doc change, edit, panel close, new focus). Remove the auto-fade timer. |
| 4 | Minimize shows a compressed mini-panel | `onMinimize` sets `surface='minimized'` | **Wire minimize to `setSurface('closed')`** — restores the feed, no mini-state. |
| 5 | No at-a-glance project health indicator in the persistent chrome | The old badge showed only open-question count on the Engineering Studio tab | **New `DocProgressBar`** in the top bar's right cluster: single bar with three fills (grey/striped/solid green) + open-question ring. Clickable → popover with per-phase breakdown. |

---

## 2. DocProgressBar — Design

### 2.1 Visual

A single horizontal bar, 24px tall, rounded, in the top bar's right cluster (replacing the `{openQuestions}` badge on the Engineering Studio tab). The bar is always visible regardless of which hub tab is active.

```
  [████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░]  ◉ 3
   ↑ solid green       ↑ striped       ↑ grey             ↑ open
     approved            drafted         not started        questions
     (no open Qs)                        

  At-risk overlay: if approved docs have open questions, a
  thin hatched amber stripe runs across the green section.
```

**Fills (left to right, most-complete to least-complete):**

| Segment | CSS | Meaning |
|---------|-----|---------|
| Solid green | `bg-emerald-500` | Approved docs with zero open questions |
| Hatched amber overlay | `repeating-linear-gradient(45deg, ...)` on top of green | Approved docs that have open questions ("at-risk") |
| Striped blue | `repeating-linear-gradient(45deg, ...)` | Drafted but not yet approved |
| Grey | `bg-slate-700` | Not started |

**Right side:** open-question count in a small ring/oval (like the current badge, but always present).

### 2.2 Data Sources

All computed from data already available at `AppShell` level:

- `autopilotStatus.docStatus` — per-phase doc status (`idle`|`drafting`|`critic`|`revising`|`passed`|`auto-approved`|`parked`)
- `roadmap` — per-phase `status` + `docExists` (needed to distinguish "drafted with PENDING_REVIEW" from "approved")
- `portalItems` — open questions with their `docPath` (to match against approved phases)

**Derived counts:**

| Count | Rule |
|-------|------|
| `approved` | docStatus in (`passed`, `auto-approved`) OR roadmap `COMPLETED` |
| `atRisk` | approved phases where `portalItems` has an open question whose `docPath` matches that phase's artifactPath |
| `drafted` | docExists === true OR roadmap `PENDING_REVIEW` AND not approved |
| `notStarted` | totalPhases - approved - drafted |

**Bar widths (percentages):** Each segment's width = `(count / totalPhases) * 100`%.

### 2.3 Click → Popover

Clicking anywhere on the bar opens a small popover panel (positioned below the bar, right-aligned):

```
┌─────────────────────────────────┐
│  Project Status                 │
│                                 │
│  ● Approved       5  ████████░ │
│  ● Drafted        3  ▓▓▓▓░░░░ │
│  ● Not started    5  ░░░░░░░░ │
│                                 │
│  ◉ Open questions  3           │
│                                 │
│  ┌─────────────────────────┐   │
│  │ View full status report │   │
│  └─────────────────────────┘   │
└─────────────────────────────────┘
```

Each row shows a mini proportional bar + count. The Approved count in the popover is the raw count before open-question subtraction; the bar's green segment reflects the adjusted value. "View full status report" navigates to the Dashboard tab. Popover closes on click-outside or Escape.

### 2.4 Implementation

**New file:** `web/src/components/DocProgressBar.tsx`

**Props:**
```ts
interface DocProgressBarProps {
  phases: RoadmapPhase[];          // from fetchRoadmap
  docStatus: Record<string, string>; // from autopilotStatus.docStatus
  totalPhases: number;
  openQuestions: number;
  onNavigateToDashboard: () => void;
}
```

**Computation (pure function):**
```ts
function computeProgress(phases, docStatus, openQuestions): {
  approved: number;      // raw count before open-question subtraction
  drafted: number;       // count
  notStarted: number;    // count
  openQuestions: number; // count
  greenCount: number;    // max(0, approved - openQuestions) — drives bar width
}
```

**Bar rendering:** Three `<div>` children with `style={{ width: ...% }}` inside a flex-row container. The striped pattern uses `repeating-linear-gradient` CSS.

**Accessibility:** `role="progressbar" aria-valuenow={greenCount + drafted} aria-valuemin={0} aria-valuemax={totalPhases}`. The popover uses `role="dialog"` / `aria-label`.

---

## 3. Doc Header — Post-PhaseRail Layout

With the PhaseRail removed, the doc header (`h-12`) now contains:

```
[FileText icon] [selector dropdown] [flex-1 spacer] [Paperclip] [Start/Stop] [Refresh] [Edit] [collapse] [zen]
```

### 3.1 ResizeObserver Narrow Mode

Wrap the header in a `useRef` + `ResizeObserver`. When the available width drops below 500px:

- **Selector dropdown** collapses to icon-only (just the chevron button, no text label + status pill)
- **Action buttons** (Paperclip, Start/Stop, Refresh, Edit) remain visible as icons
- Below 360px: hide the Paperclip and Refresh (keep Start/Stop + Edit + collapse + zen)

This is Option A from the discussion — fully reactive, no breakpoint guesswork.

### 3.2 Implementation

```ts
const headerRef = useRef<HTMLDivElement>(null);
const [headerCompact, setHeaderCompact] = useState(false);
useEffect(() => {
  const el = headerRef.current;
  if (!el) return;
  const ro = new ResizeObserver(([entry]) => {
    setHeaderCompact(entry.contentRect.width < 500);
  });
  ro.observe(el);
  return () => ro.disconnect();
}, []);
```

---

## 4. Splitter — Remove CSS Clamps

### 4.1 Changes

Remove from BOTH pane `<section>` elements:

```
- lg:min-w-[340px] lg:max-w-[calc(100%-340px)]
- grow lg:grow-0
- transition-[flex-basis] duration-300 motion-reduce:transition-none
```

The PaneSplitter's JS `minPct`/`maxPct` (computed from container width) provides all the constraint needed. The `transition-[flex-basis]` class is removed entirely — the one-time 40/60 animation on first question focus can use a simple inline style or be dropped (the ResizeObserver + persistent split from localStorage handles the initial state).

**Side effect:** localStorage restore in `leftPct` initial state currently clamps to `[33, 67]`. Change to `[20, 80]` to match the new relaxed range.

### 4.2 Rationale

The CSS clamps served two purposes that are now handled better:
- **Minimum pane width:** The splitter's `minPct` recomputes on resize, keeping both panes above 200px
- **Maximum pane width:** `maxPct = 100 - minPct` naturally prevents either pane from pushing the other below its floor

---

## 5. Highlight Persistence

### 5.1 Change

In `web/src/lib/requirementAnchor.ts`, remove the auto-fade `setTimeout` from `applyAnchorHighlight`. The marker (ring + chip + background tint) stays until `clearAnchorHighlights` is called.

`clearAnchorHighlights` is already called on:
- Doc content change (the `doc` dependency effect)
- Edit mode enter
- Panel close (`surface` change)
- New highlight from a different question focus

### 5.2 Rationale

The 2.4s auto-fade was a conservative design choice from Workstream C. With the panel now covering the feed (not the doc), the highlight is the user's primary way of connecting a question to its source section. It should persist until they act on it.

---

## 6. Minimize → Close

### 6.1 Change

In `DevelopmentView.tsx`, `onMinimize` currently receives `() => setSurface('minimized')`. Change to `() => setSurface('closed')`.

The `minimized` surface value and its rendering branch in `QuestionPanel` can be kept or removed — it won't be reached from this call site. Keeping it avoids a breaking change for any other caller.

### 6.2 Rationale

In the old layout, minimize compressed the panel to a small strip. In the new layout, the panel covers the feed as an overlay — a mini-state doesn't make visual sense. Closing restores the feed, which is the natural "minimized" behavior.

---

## 7. Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 1 | Top bar shows a single colored bar + open-question ring | Visual inspection at all viewport widths |
| 2 | Bar segments reflect real doc status from the loaded project | Cross-reference with roadmap + docStatus |
| 3 | Clicking the bar opens a popover with per-segment breakdown + "View full status" link | Click test, popover close on Escape/outside |
| 4 | Doc header elements never overlap at any pane width | Resize splitter through full range, check for overflow |
| 5 | Splitter drag is smooth and continuous with no hard stops | Drag from 20% to 80% — no jumps, no snap points |
| 6 | Requirement-ID highlight persists until explicit clear | Focus a question, wait 5s — highlight still visible |
| 7 | Minimize restores the feed (no mini-panel) | Click minimize on an open question, feed is visible |
| 8 | Progress bar accessible: role="progressbar", aria-valuenow, popover role="dialog" | axe DevTools or manual ARIA inspection |
| 9 | All existing tests pass | `npm --prefix web run test` green |
| 10 | Build + tsc clean | `npm --prefix web run build` && `npx tsc --noEmit` |

---

## 8. Risks & Follow-Ups

- **Progress bar data staleness:** The bar reads from `autopilotStatus` and `portalItems`, both polled on the 15s timer. If the user just approved a doc, the bar might lag by up to 15s. Acceptable — the dashboard remains the real-time source of truth.
- **Popover position:** Below the top bar, right-aligned. On very narrow viewports (<640px), the popover should be full-width to avoid overflow. Use a `max-w-sm` with `right-0` and `left-0 sm:left-auto`.
