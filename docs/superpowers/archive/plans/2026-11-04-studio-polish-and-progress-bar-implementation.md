# Studio Polish + Progress Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five targeted fixes to the Engineering Studio layout + a new DocProgressBar in the top bar replacing the phase rail dots.

**Architecture:** All changes are in `web/src/` (React components, pure libs, CSS). No backend changes. The progress bar reads from `autopilotStatus.docStatus` and `portalItems` already polled by AppShell's 15s timer.

**Tech Stack:** React 18, TypeScript strict, Tailwind CSS, lucide-react, ResizeObserver API.

**Spec:** `docs/superpowers/designs/2026-11-04-studio-polish-and-progress-bar-design.md`

## Global Constraints

- No new runtime dependencies. Only React, Tailwind, lucide-react, and browser APIs.
- All components must be accessible: `role="progressbar"` with `aria-valuenow/min/max`, popover `role="dialog"`.
- Never rely on color alone — shape/icon/text alongside color for every state indicator.
- `prefers-reduced-motion` respected via `motion-reduce:transition-none`.
- All existing tests (148 web) must continue to pass.
- TypeScript strict — `npx tsc --noEmit` must pass with zero errors.

## Review Focus

The spec defines three bar segments (green/striped/grey) plus an open-question ring. No task's tests exercise these cases, but a reasonable user expects:

1. **Open questions exceed approved phases:** greenCount = max(0, 5 - 7) = 0, bar has only striped + grey. No negative width or blank bar.
2. **All phases approved, zero open questions:** greenCount = 13, bar is 100% green. Zero-width striped/grey segments should not render at all (no 0px divs).
3. **Autopilot disabled, no docStatus data:** fallback to all-grey bar with "?" open-question count. Must not crash on null/undefined.
4. **Popover on narrow viewport (<640px):** must not overflow viewport edges — full-width with max-w-sm and left/right positioning.
5. **Selector dropdown in narrow header mode:** pill + chevron must still open the full dropdown with all 13 doc names visible.

---

### Task 1: DocProgressBar Component + Top Bar Integration

**Files:**
- Create: `web/src/components/DocProgressBar.tsx`
- Create: `web/src/components/DocProgressBar.test.tsx`
- Modify: `web/src/components/TopBar.tsx` (import + render DocProgressBar, remove openQuestions badge from dev tab)
- Modify: `web/src/components/TopBar.test.tsx` (if exists) or add test
- Modify: `web/src/layouts/AppShell.tsx` (pass new props to TopBar)

**Interfaces:**
- Consumes: `TopBarProps` gains `progressPhases`, `progressDocStatus`, `progressTotalPhases`, `progressOpenQuestions`, `onNavigateToDashboard` (all from AppShell's existing state). `openQuestions` prop on TopBar is removed.
- Produces: `DocProgressBar` component with `computeProgress()` pure function.

- [ ] **Step 1: Write `computeProgress` pure function + tests**

```ts
// In DocProgressBar.tsx
function computeProgress(
  phases: RoadmapPhase[],
  docStatus: Record<string, string>,
  openQuestions: number
): {
  approved: number;
  drafted: number;
  notStarted: number;
  openQuestions: number;
  greenCount: number;
} {
  // approved = docStatus in (passed, auto-approved) OR roadmap COMPLETED
  // drafted = docExists === true OR PENDING_REVIEW AND not approved
  // notStarted = totalPhases - approved - drafted
  // greenCount = max(0, approved - openQuestions)
}
```

```ts
// In DocProgressBar.test.tsx
test('computeProgress subtracts open questions from greenCount', () => {
  const result = computeProgress(mockPhases(5 approved, 3 drafted), mockDocStatus, 2);
  expect(result.approved).toBe(5);
  expect(result.greenCount).toBe(3); // 5 - 2
  expect(result.drafted).toBe(3);
  expect(result.notStarted).toBe(5); // 13 - 5 - 3
});

test('greenCount floors at zero when openQuestions exceed approved', () => {
  const result = computeProgress(mockPhases(3 approved), mockDocStatus, 7);
  expect(result.greenCount).toBe(0);
  expect(result.notStarted).toBe(10); // 13 - 3
});

test('all approved, zero open questions — greenCount equals total', () => {
  const result = computeProgress(mockPhases(13 approved), mockDocStatus, 0);
  expect(result.greenCount).toBe(13);
  expect(result.drafted).toBe(0);
  expect(result.notStarted).toBe(0);
});

test('null docStatus does not crash', () => {
  const result = computeProgress(mockPhases(0), {}, 0);
  expect(result.approved).toBe(0);
  expect(result.greenCount).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web run test DocProgressBar`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `computeProgress` in `DocProgressBar.tsx`**

```ts
export function computeProgress(
  phases: RoadmapPhase[],
  docStatus: Record<string, string>,
  openQuestions: number
): { approved: number; drafted: number; notStarted: number; openQuestions: number; greenCount: number } {
  const totalPhases = phases.length || 13;
  let approved = 0;
  let drafted = 0;
  for (const p of phases) {
    const ds = docStatus[p.id];
    if (ds === 'passed' || ds === 'auto-approved' || p.status === 'COMPLETED') {
      approved++;
    } else if (p.docExists === true || p.status === 'PENDING_REVIEW') {
      drafted++;
    }
  }
  const notStarted = totalPhases - approved - drafted;
  const greenCount = Math.max(0, approved - openQuestions);
  return { approved, drafted, notStarted, openQuestions, greenCount };
}
```

- [ ] **Step 4: Implement `DocProgressBar` component**

Renders:
```tsx
<div className="flex items-center gap-2 cursor-pointer" onClick={togglePopover} role="progressbar" aria-valuenow={greenCount + drafted} aria-valuemin={0} aria-valuemax={totalPhases}>
  <div className="h-6 w-28 sm:w-36 rounded-full overflow-hidden flex bg-slate-700">
    {greenCount > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(greenCount / totalPhases) * 100}%` }} />}
    {drafted > 0 && <div className="h-full bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(56,189,248,0.5)_4px,rgba(56,189,248,0.5)_8px)] bg-sky-600/60" style={{ width: `${(drafted / totalPhases) * 100}%` }} />}
  </div>
  <span className="inline-flex items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 text-[10px] font-bold text-amber-300 tabular-nums">{openQuestions}</span>
</div>
```

Popover (conditionally rendered):
```tsx
{popoverOpen && (
  <div role="dialog" aria-label="Project status details" className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-slate-700 bg-slate-950 p-3 shadow-2xl">
    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Project Status</h3>
    {renderRow('Approved', approved, approved / totalPhases * 100, 'bg-emerald-500')}
    {renderRow('Drafted', drafted, drafted / totalPhases * 100, 'bg-sky-600/60 stripe')}
    {renderRow('Not started', notStarted, notStarted / totalPhases * 100, 'bg-slate-700')}
    <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
      <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 text-[10px] font-bold text-amber-300">{openQuestions}</span>
      Open questions
    </div>
    <button onClick={onNavigateToDashboard} className="mt-3 w-full rounded-lg border border-slate-700 py-2 text-xs font-bold text-sky-400 hover:bg-slate-800 transition-colors">View full status report →</button>
  </div>
)}
```

Popover closes on click-outside (ref-based) and Escape keydown.

- [ ] **Step 5: Write DocProgressBar component tests**

```tsx
test('renders bar with three segments when all states present', () => { /* ... */ });
test('clicking opens popover, Escape closes it', () => { /* ... */ });
test('zero-width segments are not rendered (no 0px divs)', () => {
  render(<DocProgressBar phases={allApproved} docStatus={{}} openQuestions={0} totalPhases={13} onNavigateToDashboard={() => {}} />);
  // Only one segment div inside the bar (green), no striped or grey
  expect(screen.getByRole('progressbar').querySelectorAll('.h-full').length).toBe(1);
});
test('null docStatus does not crash render', () => { /* ... */ });
test('aria-valuenow reflects greenCount + drafted', () => { /* ... */ });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix web run test DocProgressBar`
Expected: PASS

- [ ] **Step 7: Integrate into TopBar + AppShell**

In `TopBar.tsx`:
- Add `DocProgressBar` import
- Replace the `{badgeVisible && (...)}` badge on the development tab with `DocProgressBar`
- Add props: `progressPhases`, `progressDocStatus`, `progressTotalPhases`, `progressOpenQuestions`, `onNavigateToDashboard`
- Remove `openQuestions` prop (no longer needed for badge)

In `AppShell.tsx`:
- Pass `progressPhases={roadmap}`, `progressDocStatus={autopilotStatus?.docStatus ?? {}}`, `progressTotalPhases={autopilotStatus?.totalPhases ?? 13}`, `progressOpenQuestions={openQuestions}`, `onNavigateToDashboard={() => setTab('dashboard')}` to TopBar

Remove the old `openQuestions` prop from `TopBar` interface and callsite.

- [ ] **Step 8: Run all tests + build + tsc**

Run: `npm --prefix web run test` (expect 148+ tests, all pass)
Run: `npm --prefix web run build` (expect clean)
Run: `npx tsc --noEmit` (expect 0 errors)

- [ ] **Step 9: Commit**

```bash
git add web/src/components/DocProgressBar.tsx web/src/components/DocProgressBar.test.tsx web/src/components/TopBar.tsx web/src/layouts/AppShell.tsx
git commit -m "feat(web): add DocProgressBar in top bar replacing phase-rail badge"
```

---

### Task 2: Remove PhaseRail from Doc Header + ResizeObserver Narrow Mode

**Files:**
- Modify: `web/src/views/DevelopmentView.tsx` (remove PhaseRail/AutopilotHud from doc header, add ResizeObserver)
- Modify: `web/src/components/AutopilotHud.tsx` (optionally: keep but hideControls is already handled)
- Test: existing tests must pass (no new tests for this task)

**Interfaces:**
- Consumes: DevelopmentView's `headerRef`, `headerCompact` state
- Produces: narrower doc header with reactive compact mode

- [ ] **Step 1: Remove AutopilotHud from doc header**

In `DevelopmentView.tsx`, find the section:
```tsx
{/* §5.G — 5-state rail folds onto the doc-header line (h-8 cluster) */}
<div className="flex min-w-0 flex-1 items-center">
  <AutopilotHud ... hideControls />
</div>
```

Replace with a simple `<div className="flex-1 min-w-0" />` spacer.

- [ ] **Step 2: Add ResizeObserver to doc header**

```tsx
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

Add `ref={headerRef}` to the `<header>` element.

- [ ] **Step 3: Add compact mode styling to the selector dropdown**

When `headerCompact` is true, the selector button shows only the status pill + chevron (no doc name text):

```tsx
className={`flex min-h-[40px] items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-900 transition-colors cursor-pointer ${headerCompact ? 'w-10 justify-center' : ''}`}
```

In compact mode: hide the `<span className="truncate ...">` with the doc name, keep the status pill and chevron. The `title` on the button already shows the doc name.

- [ ] **Step 4: Run tests + build + tsc**

Run: `npm --prefix web run test` (expect all 148+ existing tests to pass — no new tests)
Run: `npm --prefix web run build` (expect clean)
Run: `npx tsc --noEmit` (expect 0 errors)

- [ ] **Step 5: Commit**

```bash
git add web/src/views/DevelopmentView.tsx
git commit -m "fix(web): remove PhaseRail from doc header, add ResizeObserver narrow mode"
```

---

### Task 3: Remove Splitter CSS Clamps

**Files:**
- Modify: `web/src/views/DevelopmentView.tsx`

- [ ] **Step 1: Remove CSS clamps from left pane section**

Remove `lg:min-w-[340px] lg:max-w-[calc(100%-340px)]` and `grow lg:grow-0` and `transition-[flex-basis] duration-300 motion-reduce:transition-none` from the left pane `<section>`.

- [ ] **Step 2: Remove CSS clamps from right pane section**

Same removals from the right pane `<section>`.

- [ ] **Step 3: Remove ratioTransition state and all references**

Delete `ratioTransition` state, `setRatioTransition`, `ratioAnimatedRef`, `userDraggedRef`. The first-focus 40/60 animation is replaced by direct localStorage read (the splitter starts at whatever position the user last set).

Also remove the `ratioTransition` ternary in both pane className strings.

- [ ] **Step 4: Relax localStorage restore clamp**

In `leftPct` initial state, change the clamp from `n >= 33 && n <= 67` to `n >= 20 && n <= 80`.

- [ ] **Step 5: Remove handleFocusDocument ratio animation**

In `handleFocusDocument`, remove the `userDraggedRef`/`ratioAnimatedRef`/`ratioTransition` block. Keep the `selectPhaseByDocPath` and highlight logic — only remove the ratio animation part.

- [ ] **Step 6: Run tests + build + tsc**

Run: `npm --prefix web run test` (expect all 148+ tests to pass)
Run: `npm --prefix web run build` (expect clean)
Run: `npx tsc --noEmit` (expect 0 errors)

- [ ] **Step 7: Commit**

```bash
git add web/src/views/DevelopmentView.tsx
git commit -m "fix(web): remove splitter CSS clamps and transition for continuous drag"
```

---

### Task 4: Persistent Highlight + Minimize Restores Feed

**Files:**
- Modify: `web/src/lib/requirementAnchor.ts` (remove auto-fade timeout)
- Modify: `web/src/views/DevelopmentView.tsx` (onMinimize → setSurface('closed'))

- [ ] **Step 1: Remove auto-fade from applyAnchorHighlight**

In `web/src/lib/requirementAnchor.ts`, find `applyAnchorHighlight` and remove the `setTimeout` that calls `clearAnchorHighlight`. The marker div (ring + chip + background) is already cleaned up by `clearAnchorHighlights` calls on doc change, edit, panel close, and new focus.

- [ ] **Step 2: Change onMinimize to close**

In `DevelopmentView.tsx`, change:
```tsx
onMinimize={() => setSurface('minimized')}
```
to:
```tsx
onMinimize={() => setSurface('closed')}
```

- [ ] **Step 3: Run tests + build + tsc**

Run: `npm --prefix web run test` (expect all 148+ tests to pass)
Run: `npm --prefix web run build` (expect clean)
Run: `npx tsc --noEmit` (expect 0 errors)

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/requirementAnchor.ts web/src/views/DevelopmentView.tsx
git commit -m "fix(web): persistent doc highlight, minimize restores feed"
```

---

### Task 5: Final Review + Push

- [ ] **Step 1: Run full test suite**

Run: `npm --prefix web run test`
Expected: 148+ tests, all green

- [ ] **Step 2: Run web build**

Run: `npm --prefix web run build`
Expected: clean

- [ ] **Step 3: Run root type check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Review diff**

Run: `git log --oneline -10`
Expected: 4 new commits on top of `78815d3`

- [ ] **Step 5: Push**

```bash
git push origin master
```
