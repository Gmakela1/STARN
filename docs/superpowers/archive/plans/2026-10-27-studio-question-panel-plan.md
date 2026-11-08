# Studio Question Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the AI open-question surface from the left chat pane to an overlay panel in the right document pane.

**Architecture:** A new `QuestionPanel` component renders as an overlay over the document content region inside the right pane. Questions are surfaced via left-pane `QuestionBadge` trigger and inline composer in `QuestionPanel`. `QuestionBar`, `AnswerDialog`, and the `AutopilotHud.parkedDocs` block are retired. One new lifted state (`surface` + `dismissedIds`) in `DevelopmentView` orchestrates the two panes.

**Tech Stack:** React 18, TypeScript strict, Tailwind v3, lucide-react, Vite.

**Spec:** `docs/superpowers/specs/2026-10-27-studio-question-panel-design.md`

## Global Constraints

- All new components in `web/src/components/`. All new state types in `web/src/types/api.ts` (none needed — existing types suffice).
- Zero new hex colours or design tokens. Use existing `slate-*`, `cyan-*`, `amber-*`, `rose-*`, `emerald-*`, `sky-*` throughout.
- Desktop `lg+` only. Right pane is `hidden lg:flex` — no mobile fallback.
- `tsc --noEmit` **must pass** for both `web/` and root after every task. Web build gate: `npm --prefix web run build`.
- `npm test` (root suite) must stay green; it covers `tests/web-portal-detail.test.ts` (portalDetail logic, unchanged) and backend contracts.
- All animations: keyframes in `web/src/index.css`. Existing naming convention retained; extend the `prefers-reduced-motion` block.
- `window`/`document` keydown listeners must be registered with `useEffect` cleanup to survive project-switch remounts.

## Review Focus

| Input/condition | Expected behaviour | Owning task |
|---|---|---|
| Items arrive while panel is closed (SSE or poll) | Badge count increments, badged pulses; panel **never auto-opens** | Task 1 |
| 3s poll replaces `portalItems` while composer has text | Draft survives because it lives in a per-item map keyed by `item.id` | Task 2 |
| Escape key while panel is open | Empty composer → close panel; non-empty composer → clear draft first, second Escape → close | Task 2 |
| AltGr layout (Ctrl+Alt+.) on a keyboard | Does NOT toggle panel and does NOT trigger recording | Task 3 |
| Badge receives count changes while checkpoint is pending | Badge is subdued but still focusable and operable | Task 1 |
| All counts reach 0 (open, queued, applied dwell expired) | Badge renders `null` (hidden) | Task 1 |

---

### Task 1: CSS, QuestionBadge, AutopilotHud trim, file retirements

**Files:**
- Create: `web/src/components/QuestionBadge.tsx`
- Modify: `web/src/index.css`
- Modify: `web/src/components/AutopilotHud.tsx`
- Delete: `web/src/components/QuestionBar.tsx`
- Delete: `web/src/components/AnswerDialog.tsx`

**Interfaces:**
- Consumes: `PortalItem`, `AnswerPhase`/`AnswerState` from `web/src/types/api.ts` (existing)
- Produces: `<QuestionBadge>` component (see Interface spec below); `animate-panel-in` keyframe + extended reduced-motion block in `index.css`; `AutopilotHudProps` loses `parkedDocs`, `onResume`, `onEditDoc`

**QuestionBadge interface:**
```typescript
interface QuestionBadgeProps {
  count: number;
  queuedCount: number;
  blockingCount: number;
  resolvedCount: number;
  surface: 'closed' | 'open' | 'minimized';
  subdued: boolean;
  onOpen: () => void;
}
```

- [x] **Step 1: Add `animate-panel-in` keyframe and extend reduced-motion block in `index.css`**

Insert after the existing `animate-park-reveal` block (ca. index.css:215-220):

```css
@keyframes panel-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}
.animate-panel-in { animation: panel-in 160ms ease-out; }
```

Extend the `prefers-reduced-motion` media query (ca. index.css:199-204) to also suppress:
`.animate-panel-in, .animate-park-reveal, .animate-question-arrive, .animate-answered-collapse { animation: none; }`

- [x] **Step 2: Run typecheck to verify**

Run: `npm --prefix web run build` (or `npx tsc --noEmit` in `web/`)
Expected: PASS (no errors)

- [x] **Step 3: Create `QuestionBadge.tsx`**

Component renders a button strip (or null/status-only when counts are zero or subdued):
- `min-h-[44px]`, left-amber-border, `bg-slate-900/80`,
  `focus:ring-2 focus:ring-sky-500/40`, `aria-expanded`, `aria-controls="question-panel"`
- `MessageSquare` in `h-5 w-5 rounded-full bg-amber-500/20` (amber-400 icon)
- Label `Needs Input` (`text-xs font-medium text-amber-200`)
- Count pill (`bg-slate-800 text-cyan-300 tabular-nums text-[11px] font-bold px-2 py-0.5`)
- Queued chip: `Clock3` + N (`border-amber-500/40 bg-amber-500/10 text-amber-300 text-[11px] px-2 py-0.5`)
- `· N resolved` muted text (`text-[11px] text-slate-400`) when resolvedCount > 0
- If blockingCount > 0: pill switches to `border-rose-800 bg-rose-950/60 text-rose-200`, dot to `bg-rose-400`
- `ChevronDown` on the right, `rotate-180` when surface !== 'closed'
- `aria-label` computed status string: `"Questions from AI, N pending..."`

**Three states:**
1. count > 0, `subdued: false` — full button, all chips visible, `aria-expanded`, click → `onOpen`
2. `subdued: true` — `h-8` line, `opacity-60`, dot + `N pending · M queued` only. Still a real `<button>` (not disabled), still operable.
3. count === 0 AND queuedCount === 0 AND resolvedCount === 0 — render `null` (hidden entirely)

- [x] **Step 4: Run typecheck**

Run: `npx tsc --noEmit` in `web/`
Expected: PASS

- [x] **Step 5: Edit `AutopilotHud.tsx` to remove parkedDocs block and props**

Delete:
- The `parkedDocs` prop from `AutopilotHudProps` interface (ca. line 12)
- The `parkedDocs` default parameter value (ca. line 46)
- The entire `{parkedDocs.length > 0 && !running && ( <div>...) }` JSX block (ca. lines 148-186)
- Remove `onResume` and `onEditDoc` props from the interface and usage.

The 13-dot rail, Start/Stop, and status Word remain.

- [x] **Step 6: Delete `QuestionBar.tsx` and `AnswerDialog.tsx`**

Delete both files from `web/src/components/`.

- [x] **Step 7: Run typecheck + check no remaining imports**

Run: `npx tsc --noEmit` in `web/`
Expected: FAIL — the `DevelopmentView.tsx:769` import of `QuestionBar` and any other import of these files will error. **Accept the failure** — Task 3 fixes them.

- [x] **Step 8: Commit**

```bash
git add web/src/index.css web/src/components/QuestionBadge.tsx web/src/components/AutopilotHud.tsx
git add -A web/src/components/QuestionBar.tsx web/src/components/AnswerDialog.tsx  # deletes tracked
git diff --cached --stat
git commit -m "feat: add QuestionBadge, panel-in keyframe, trim AutopilotHud, retire QuestionBar/AnswerDialog"
```

---

### Task 2: QuestionPanel — the right-pane overlay

**Files:**
- Create: `web/src/components/QuestionPanel.tsx`

**Interfaces:**
- Produces: `<QuestionPanel>` component
- Consumes: `portalItems` (open items), `answerStates`, submit/dismiss/resume/editDoc handlers, `surface`, `onMinimize`, `onClose`
- Uses: `renderDetail` from `web/src/lib/portalDetail.ts` (existing, unchanged)

**QuestionPanel interface:**
```typescript
interface QuestionPanelProps {
  surface: 'closed' | 'open' | 'minimized';
  items: PortalItem[];                // open items minus dismissed, from DevelopmentView
  answerStates: Record<string, AnswerState>;
  onSubmit: (id: string, text: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onResume: (docPath: string) => Promise<void>;
  onEditDoc: (docPath: string) => void;
  onMinimize: () => void;
  onClose: () => void;
}
```

When `surface === 'closed'` → render nothing.
When `surface === 'minimized'` → render the minimized strip.
When `surface === 'open'` → render the full overlay panel.

Panel-local state:
- `activeId: string` — currently selected item's id; defaults to first in `items`
- `drafts: Record<string, string>` — per-item composer drafts, keyed by item id
- `showFull: string | null` — which item's detail is fully expanded (id or null)
- `retryText: Record<string, string>` — last submitted text per item (for Retry)
- `recentlyResolved: Record<string, { item: PortalItem; until: number }>` — snapshot of just-submitted items for dwell rendering after they leave the open pool
- Dwell timers in a ref, cleaned on unmount

- [x] **Step 1: Write the internal state hook**

`questionPanelState()` — a thin hook or inline state in the component. Not a separate file; keep in `QuestionPanel.tsx`.

- [x] **Step 2: Implement the overlay layout**

```
absolute inset-0 z-20 flex flex-col bg-slate-950 animate-panel-in
role="region" aria-label="Questions from AI" id="question-panel"
```

**Header** (`shrink-0 border-b border-slate-800 bg-slate-900/90 px-3 py-2`):
- `MessageSquare` + `Questions from AI` (text-sm font-bold) + count pill (`bg-slate-800 text-cyan-300 text-[11px] font-bold px-2 tabular-nums`)
- Origin-doc chip: `({font-mono text-[10px] bg-slate-800 rounded px-1.5 py-0.5})` from `item.docPath.split('/').pop()`
- `asked while {item.section}` badge (existing pattern)
- `Open document` text button (`text-sky-400 text-xs cursor-pointer`) when item.docPath differs from the selected phase. On click → `onClose()` then navigate the phase selector. (DevelopmentView provides a compatible callback.)
- `BLOCKING` pill when `item.severity === 'blocking'`
- **Minimize** (`Minimize2`, `min-h-[44px] min-w-[44px]`, `aria-label="Minimize questions"`)
- **Close** (`X`, `min-h-[44px] min-w-[44px]`, `aria-label="Close questions"`)
- Both with `focus:ring-2 focus:ring-sky-500/40`

**Nav** (only when `items.length >= 2`):
- A horizontally scrollable chip rail (`overflow-x-auto flex gap-1.5 px-3 py-1.5 border-b border-slate-800`). One chip per open item.
- Active chip: `bg-sky-950/70 border-sky-800/60 text-sky-200` with `aria-current="true"`
- Inactive chip: `bg-slate-900 border-slate-800 text-slate-400`
- Titles truncated to `max-w-[140px]`, severity dot indicator
- **AND** a simple visual pager: `‹ 3 of 5 ›` in the header (icon buttons h-8 w-8)

**Body** (`min-h-0 flex-1 overflow-y-auto p-4 space-y-3`):
- The card for the active item:
  - `rounded-lg border-l-2 p-3` — rose-l for parked, amber-l for pending, slate-l for resolved
  - Label row: `Critic blocked` / `AI needs input` / `Resolved ✓` with icon and colour
  - Dismiss `X` button per item
  - Title `text-sm font-bold text-slate-200`
  - `renderDetail(item.detail)` bullets + `Show full question` expander (reuse existing `renderDetail` + `showFull` pattern)
  - Parked gaps list: `Missing requirements:` + `text-[11px] list-disc pl-3.5`
  - Answer-state chip: reuse the `stateChip` record pattern verbatim (queued amber / applying cyan+spin / applied emerald / failed rose) + `Retry` button when failed
- Action row:
  - Parked items: `Resolve & Resume` (`RotateCcw`, `min-h-[44px]`, `border-rose-700 bg-rose-950/60`) + `Edit Manually` (`min-h-[44px]`, `border-slate-700 bg-slate-900`)
  - Question items: the **inline composer** (Step 3 below)

**Empty state** (when `items.length === 0` and no in-flight saved item dwell):
- `CheckCircle2 h-8 w-8 text-emerald-400` in `h-14 w-14 rounded-2xl border border-emerald-800/60 bg-emerald-950/40`
- `All questions resolved` (text-sm font-medium)
- `No pending questions from the current run.` (text-xs text-slate-500)
- `Return to document` button (`border-slate-700 bg-slate-900 min-h-[44px]`) — auto-focused via `useEffect`, on click calls `onClose()`

- [x] **Step 3: Implement the inline composer**

A `shrink-0 border-t border-slate-800 bg-slate-900/60 p-3` footer:
- `label "Your answer"` (text-xs font-semibold text-slate-300)
- `textarea` (`min-h-[96px] resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/30 disabled:opacity-50`)
- Hint: `Usually 1–3 sentences is enough.` (text-xs text-slate-500)
- Enter sends (guarded by `!e.nativeEvent.isComposing`); Shift+Enter newline
- Submit error row: `role="alert"`, rose-300 text
- Composer disables while the active item's answerState is `queued` or `applying`
- On `applied`: swap to 8-second dwell (`Check` + `Resolved ✓`), then re-enable or advance

**Draft map:** `drafts[activeId]` is read/written on every keystroke; entire map is cleared by a `useEffect` when `surface` becomes `'closed'`. When `items` loses the active id (poll): advance to next open item (wrap around); that item's draft from the map is restored.

**Advance-on-vanish:** a `useEffect` watching `items` and `activeId`. If `items.find(i => i.id === activeId)` is undefined and `items.length > 0`, set `activeId` to the first item; if 0, show empty state.

- [x] **Step 4: Add panel-level Escape handler**

A `useEffect` on `surface === 'open'`:
- If composer text is non-empty AND `activeId` is a question → clear the draft for that item (set `drafts = prev => { const next = {...prev}; delete next[activeId]; return next; }`), set submitError to null.
- If composer is empty → call `onClose()`.
- If the item is parked (no composer) → `onClose()`.
- Single owner: `window.addEventListener('keydown', handler)`, cleaned on unmount. Guard `if (surface !== 'open') return` using a ref.

- [x] **Step 5: Run typecheck**

Run: `npx tsc --noEmit` in `web/`
Expected: PASS (the component itself is self-contained; DevelopmentView still broken)

- [x] **Step 6: Commit**

```bash
git add web/src/components/QuestionPanel.tsx
git diff --cached --stat
git commit -m "feat: add QuestionPanel overlay with inline composer and multi-question nav"
```

---

### Task 3: Integrate into DevelopmentView

**Files:**
- Modify: `web/src/views/DevelopmentView.tsx`

**Interfaces:**
- Consumes: `<QuestionBadge>` (Task 1), `<QuestionPanel>` (Task 2)
- Produces: Working Engineering Studio with the right-pane question panel

- [x] **Step 1: Import QuestionBadge and QuestionPanel; remove QuestionBar import and AnswerDialog import**

Replace:
```typescript
import QuestionBar from '../components/QuestionBar';
// (AnswerDialog was not imported in DevelopmentView — it was only in QuestionBar)
```
With:
```typescript
import QuestionBadge from '../components/QuestionBadge';
import QuestionPanel from '../components/QuestionPanel';
```

- [x] **Step 2: Add lifted state `surface` and `dismissedIds`**

```typescript
const [surface, setSurface] = useState<'closed' | 'open' | 'minimized'>('closed');
const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
```

Replace the existing `dismissedParked` set with `dismissedIds` they share a type.

**Derived values:**
```typescript
const visibleItems = useMemo(
  () => portalItems.filter(i => !dismissedIds.has(i.id) && (i.status === 'open' || i.status === 'answered')),
  [portalItems, dismissedIds]
);
const pendingCount = visibleItems.filter(i => i.status === 'open').length;
const queuedOrApplyingCount = Object.values(answerStates).filter(s => s.phase === 'queued' || s.phase === 'applying').length;
const blockingCount = visibleItems.filter(i => i.severity === 'blocking' && i.status === 'open').length;
const appliedCount = Object.values(answerStates).filter(s => s.phase === 'applied').length;
```

- [x] **Step 3: Replace QuestionBar in the JSX**

Old (ca. line 768):
```tsx
<QuestionBar
  items={portalItems}
  onSubmit={handleQueueAnswer}
  answerStates={answerStates}
  onDismiss={async (id) => { await api.dismissPortalItem(id); }}
  checkpointVisible={checkpoint !== null}
/>
```

New:
```tsx
<QuestionBadge
  count={pendingCount}
  queuedCount={queuedOrApplyingCount}
  blockingCount={blockingCount}
  resolvedCount={appliedCount}
  surface={surface}
  subdued={checkpoint !== null}
  onOpen={() => setSurface('open')}
/>
```

- [x] **Step 4: Add Ctrl+. and Escape key listeners in DevelopmentView**

Ctrl+. listener (in a `useEffect` with cleanup):

```typescript
const handleKeyDown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.repeat && !e.isComposing && e.key === '.') {
    e.preventDefault();
    setSurface(s => s === 'open' ? 'minimized' : 'open');
  }
};
window.addEventListener('keydown', handleKeyDown);
```

No Escape listener in DevelopmentView — Escape is owned by QuestionPanel internally.

- [x] **Step 5: Wrap the doc content region and mount QuestionPanel**

Locate the JSX for the right-pane document section (ca. line 857 — `hidden min-h-0 flex-col lg:flex`). Inside its `min-h-0 flex-1 overflow-y-auto` area, wrap the doc content in a `relative` container:

```tsx
<div className="relative min-h-0 flex-1">
  {/* Existing doc content: editing textarea or Markdown view or empty loader */}
  ... existing doc content ...

  {/* Question panel overlay */}
  <QuestionPanel
    surface={surface}
    items={visibleItems.filter(i => i.status === 'open')}
    answerStates={answerStates}
    onSubmit={handleQueueAnswer}
    onDismiss={async (id) => {
      setDismissedIds(prev => new Set(prev).add(id));
      await api.dismissPortalItem(id);
    }}
    onResume={async (docPath) => { try { await api.autopilotResume(docPath); } catch {} }}
    onEditDoc={(docPath) => {
      setSurface('closed');
      // If selectPhaseByDocPath logic exists — use it; otherwise setEditing(true)
      setEditing(true);
    }}
    onMinimize={() => setSurface('minimized')}
    onClose={() => setSurface('closed')}
  />
</div>
```

Also toggle `inert` + `aria-hidden` on the doc content element (the immediate child of the relative wrapper) when the panel is open:

```typescript
const docContentRef = useRef<HTMLDivElement>(null);
// In an effect:
useEffect(() => {
  const el = docContentRef.current;
  if (!el) return;
  if (surface === 'open') {
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
  } else {
    el.removeAttribute('inert');
    el.removeAttribute('aria-hidden');
  }
}, [surface]);
```

- [x] **Step 6: Move the announcement live-region effect from QuestionBar into DevelopmentView**

Locate the existing `announcement` state/effect in QuestionBar (the one that tracks `answerStates` phase transitions and sets `announcement` text), and move it to DevelopmentView. Keep a single `<span aria-live="polite" role="status" className="sr-only">` that reads from the moved state.

- [x] **Step 7: Run typecheck + build**

Run: `npm --prefix web run build`
Expected: PASS

- [x] **Step 8: Run root test suite**

Run: `npm test`
Expected: PASS (all backend + portalDetail tests)

- [x] **Step 9: Commit**

```bash
git add web/src/views/DevelopmentView.tsx
git diff --cached --stat
git commit -m "feat: integrate QuestionBadge and QuestionPanel into DevelopmentView; remove stale imports"
```

---

### Task 4: Verification

**Files:** none (read-only checks)

- [x] **Step 1: Typecheck + build**

Run: `npm --prefix web run build`
Expected: PASS

- [x] **Step 2: Root test suite**

Run: `npm test`
Expected: PASS

- [x] **Step 3: Lint / orphan check**

Run: `grep -rn 'QuestionBar\|AnswerDialog\|parkedDocs' web/src --include='*.tsx' --include='*.ts' | grep -v node_modules | grep -v '.d.ts'`
Expected: zero remaining references (only the deleted file paths in git history).

- [x] **Step 4: Verify the five review-focus scenarios**

Using Playwright (MCP tool `mcp__playwright`) or manual:
1. SSE question arrives while panel is closed → badge pulses, count increments, panel does NOT auto-open.
2. Start typing in composer, wait 3s for poll → text survives.
3. Focus composer, press Escape → draft clears if non-empty, second Escape closes panel.
4. Send `Ctrl`+`.` with chat textarea focused → panel opens (or toggles). Send `Meta`+`.` → same.
5. Subdue badge by calling API checkpoint, badge is still clickable.

- [x] **Step 5: Roll-up commit**

```bash
git add -A
git commit -m "feat: studio question panel — full integration [skip ci]"
```

If no uncommitted changes remain, skip.

- [x] **Step 6: Final summary**

```
Build:   PASS (web + root)
Tests:   PASS (root suite, 80+ files)
Removed: QuestionBar.tsx, AnswerDialog.tsx
Created: QuestionBadge.tsx, QuestionPanel.tsx
Modified: index.css, AutopilotHud.tsx, DevelopmentView.tsx
```