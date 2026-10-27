# Engineering Studio — Right-Pane Question Panel

**Date:** 2026-10-27
**Status:** Approved (user opted out of further questions)
**Scope:** `web/` presentation layer only. No `src/` core, server, or contract changes.

---

## 1. Intent and why

During autopilot, the run stops and asks the builder questions (portal items of
type `question`), and it also parks phases the critic refused (`type: 'parked'`).
Today those items surface in the **left chat pane** as a collapsible "Questions
from AI" strip sandwiched between the activity feed and the composer.

Two problems with that placement:

1. The left pane is where the autopilot feed is *streaming*. Question cards
   compete with live activity for the same narrow column and get pushed around
   as new lines arrive.
2. Answering a question changes a **document**, and the document lives in the
   right pane. The cause (question) and the effect (doc) are on opposite sides
   of the screen.

The user asked for the question surface to move to the right pane — where the
document preview is — with minimize and close controls that restore the
document. A compact badge stays in the left pane so pending questions remain
discoverable while the feed scrolls.

---

## 2. Goals

- Clicking the left-pane badge opens a question surface in the **right pane**.
- The surface **overlays the document content region** and can be **minimized**
  or **closed**; both actions restore the document.
- Multi-question navigation that survives a 3-second poll replacing the item array.
- Answering happens inline in the panel with the question visible above the composer.
- Every existing action keeps working exactly once, in one place: dismiss,
  answer, retry, resolve & resume, edit manually.
- Badge reflects pending, queued, resolved, blocking, and checkpoint states.

## 3. Non-goals

- Mobile / `< lg` layout. The right pane is `hidden lg:flex`; desktop only.
- Changes to `src/` core, the portal HTTP/SSE contract, the answer-queue state
  machine semantics, or the answer applier.
- `IssuesAndQuestionsView` (the "Shop Floor Flags" sub-tab). It reads a
  different data path (`GET /api/issues`, server-derived `IssuesSummary`, pushes
  via `api.pushIssueToAgent`) and stays untouched.
- Adding a web component-test framework (see §12 for the verification plan that
  covers this change without one).

## 4. Anti-goals

- Auto-opening the panel when a question arrives. It would fight the typing
  flow mid-turn. The badge pulses; the user opens it.
- Making the panel a modal (`aria-modal`, focus trap, body scroll lock). It is a
  pane, not a dialog. The left pane and doc header must stay operable.
- Rendering a *third* copy of parked-doc actions anywhere.
- Losing the document scroll position or mount state on open/minimize/close.

---

## 5. Constraints

- **Locked by the user:** no mobile work; badge stays in the left pane; the
  surface lives in the right pane; minimize and close both restore the doc.
- Tailwind + React 18 + TypeScript strict. `tsc --noEmit` gates both packages.
- Reuse existing colour/animation tokens; no new design language.
- `AGENTS.md`: presentation stays swappable. All of this is inside
  `web/src/components` and `web/src/views` — no core coupling is introduced.
- Single owner per window-level key handler (Alt-record already exists, see §11).

---

## 6. Approaches considered

| # | Approach | Verdict |
|---|----------|---------|
| A | **Full swap** — conditionally render the question panel *instead of* the document panel | Rejected. Every open/minimize/close cycle unmounts the Markdown doc tree, so doc scroll position and any in-progress edit die. "Minimize vs close" degrades to bookkeeping with no physical difference. |
| B | **Overlay the whole right pane** | Rejected. It covers the doc-selector header (Edit / Save / Approve) and the autopilot 13-dot rail with Start/Stop. Stopping a run while reviewing parked docs is a real flow; hiding those controls to save one wrapper element is a bad trade. |
| C | **Overlay the document content region only** | **Chosen.** The panel is a `z-20` sibling of the doc scroll region inside a new `relative` wrapper. Header actions, autopilot rail, and the example drop zone stay live. The doc tree **stays mounted** underneath, so scroll position survives, and both minimize and close restore the doc trivially. |

**Tradeoff accepted:** while the panel is open, the doc preview/edit area is
visually covered. The user peeks at it by minimizing (state frozen) or closing
(state reset).

**Placed approach (user chose "replace or overlay"):** overlay, per §6C.
Rationale: it is the only option under which "minimize" has a distinct physical
meaning from "close", and the only one that preserves the doc mount.

---

## 7. Current state (verified inventory)

- `QuestionBar` has exactly one consumer: `DevelopmentView.tsx:768`. Its
  `onResume` / `onEditDoc` props are never passed, so its parked-card
  "Resolve & Resume" / "Edit Manually" buttons **never render** today.
- Three surfaces render the same portal items:
  1. `DevelopmentView.tsx:599-661` — sticky parked card in the chat scroll area,
     with a **dead** "Review gaps →" no-op button.
  2. `QuestionBar.tsx:240-400` — the collapsible card list.
  3. `AutopilotHud.tsx:148-186` — parked cards, gated on `!running`.
- A `Ctrl+.` hint is displayed in `QuestionBar.tsx:396` but **no listener exists
  anywhere in the repo**. Dead affordance.
- `answerStates` (`queued | applying | applied | failed`) is owned by
  `DevelopmentView.tsx:352` and consumed only by `QuestionBar`. `AnswerDialog`
  is consumed only by `QuestionBar`.
- `portalItems` comes from `useAutopilotEvents` (3s poll **replaces** the array).
  `useTurnStream` also exposes an unused `portalItems` — do not wire the panel
  to that one; only the autopilot hook reconnects and polls.
- Animations live in `index.css`: `animate-question-arrive`, `animate-dialog-in`,
  `animate-backdrop-in`, `animate-answered-collapse`, `animate-park-reveal`. The
  `prefers-reduced-motion` block covers **only** dialog/backdrop today.
- Web has **no test runner**; root vitest runs `tests/**` in a `node`
  environment and cannot render React.

---

## 8. The design

### 8.1 Components

| File | Action | Responsibility |
|------|--------|----------------|
| `web/src/components/QuestionBadge.tsx` | **New** | Left-pane trigger. Pure presentational: count, queued count, blocking count, resolved count, surface, subdued flag, `onOpen`. |
| `web/src/components/QuestionPanel.tsx` | **New** | The overlay. Owns active-item index, composer draft, `showFull`, retry text, and the minimized strip. Renders item cards, gaps, state chips, action rows, inline composer, and the empty state. |
| `web/src/components/QuestionBar.tsx` | **Delete** | Split into badge + panel. |
| `web/src/components/AnswerDialog.tsx` | **Delete** | Replaced by the inline composer (§8.5). |
| `web/src/components/AutopilotHud.tsx` | **Edit** | Delete the `parkedDocs` block and the `parkedDocs` / `onResume` / `onEditDoc` props. 13-dot rail + Start/Stop untouched. |
| `web/src/views/DevelopmentView.tsx` | **Edit** | Owns `surface`; hosts the badge in the old QuestionBar slot; wraps the doc content region in a `relative` container and mounts the panel there; owns the live region and the `Ctrl+.` listener. |
| `web/src/index.css` | **Edit** | Add `animate-panel-in`; extend the reduced-motion block. |

Data ownership is unchanged: `portalItems` (`useAutopilotEvents`),
`answerStates`, `checkpoint`, and all doc state stay in `DevelopmentView`.

```tsx
// Left pane, in the current QuestionBar slot:
<QuestionBadge
  count={pendingCount}                  // all counts derive from visibleItems (D7)
  queuedCount={queuedOrApplyingCount}
  blockingCount={openItems.filter(i => i.severity === 'blocking').length}
  resolvedCount={appliedCount}          // answerStates 'applied' (D8)
  surface={surface}              // 'closed' | 'open' | 'minimized'
  subdued={checkpoint !== null}
  onOpen={() => setSurface('open')}
/>

// Right pane, inside the new relative content wrapper:
<QuestionPanel
  surface={surface}
  items={visibleItems}                  // open items minus dismissedIds (D7)
  answerStates={answerStates}
  onSubmit={handleQueueAnswer}          // existing POST-200/202 wrapper
  onDismiss={async id => { setDismissedIds(prev => new Set(prev).add(id)); await api.dismissPortalItem(id); }}
  onResume={async docPath => { try { await api.autopilotResume(docPath); } catch {} }}
  onEditDoc={docPath => { setSurface('closed'); selectPhaseByDocPath(docPath); setEditing(true); }}
  onMinimize={() => setSurface('minimized')}
  onClose={() => setSurface('closed')}
/>
```

`surface` and `dismissedIds` are the only new lifted state (D7). The active item
id, per-item composer drafts, retry text, and dwell timers are panel-local:
**unmount resets them (close), CSS hide freezes them (minimize)**.

### 8.2 Minimize vs close

- **Minimize** → panel body hides, a `h-[44px]` strip docks at the bottom of the
  content region (`absolute inset-x-0 bottom-0 z-30`). Strip: amber dot ·
  `Questions from AI (N)` · active title · `Expand` · `Close`. The doc becomes
  interactive, **all panel state is preserved** (same mounted tree). Focus moves
  to `Expand`.
- **Close** → panel unmounts, internal state resets (active → first open item,
  composer cleared, `showFull` off). Focus returns to the badge.
- **Minimize with count 0** → the strip has nothing to show; set `surface` to
  `closed` and let the doc take the full region.

Minimize is "peek at the doc mid-answer". Close is "done".

### 8.3 Badge spec (left pane)

- Amber-left-border strip, `min-h-[44px]`, `bg-slate-900/80 px-3`, sky focus ring.
- `MessageSquare` in an `amber-500/20` circle; label `Needs Input`
  (`text-xs font-medium text-amber-200`); count pill
  (`bg-slate-800 text-cyan-300 tabular-nums`); queued chip (`Clock3` + N,
  `border-amber-500/40 bg-amber-500/10 text-amber-300`); `· N resolved` muted
  text when answered items exist.
- If any open item is `severity: 'blocking'`, the pill turns
  `border-rose-800 bg-rose-950/60 text-rose-200` and the dot goes `bg-rose-400`.
- `aria-label` doubles as a status readout: `Open questions from AI, 3 pending,
  1 queued`.

| State | Render | Behaviour |
|-------|--------|-----------|
| Nothing pending, nothing queued, nothing resolved | `null` | Hidden |
| Items present, no checkpoint | Full strip, real `<button>` with `aria-expanded` / `aria-controls="question-panel"` | Click / Enter toggles `open`; opens from `closed` |
| Checkpoint pending | Subdued `h-8` line, `opacity-60`, dot + `N pending · M queued` only | **Still a real button, still operable** (D9). The turn stream is checkpoint-locked, but a portal answer is not; making the badge inert would strand pending questions behind the checkpoint |

New arrivals never auto-open the panel: the badge pulses
(`animate-question-arrive`) and the count increments.

### 8.4 Panel layout

Panel: `absolute inset-0 z-20 flex flex-col bg-slate-950`,
`animate-panel-in`, `role="region" aria-label="Questions from AI"`, `id="question-panel"`.

- **Header** (`shrink-0 border-b border-slate-800 bg-slate-900/90`):
  icon + `Questions from AI` + count pill; origin-doc chip
  (`font-mono text-[10px]`, `docPath.split('/').pop()`) + `asked while {section}`;
  an **`Open document`** text button (`text-sky-400`) renders when the item's
  `docPath` differs from the selected phase — it closes the panel, selects that
  phase, and refreshes the doc (D5);
  `BLOCKING` pill when applicable; then **Minimize** (`Minimize2`,
  `aria-label="Minimize questions (keeps your draft)"`) and **Close** (`X`,
  `aria-label="Close questions and return to document"`), both
  `min-h-[44px] min-w-[44px]` with sky focus rings.
- **Nav** (only when ≥2 open): a centered pager `‹ 3 of 5 ›` **and** a
  horizontally scrollable chip rail (`overflow-x-auto`, active chip
  `bg-sky-950/70 border-sky-800/60 text-sky-200` + `aria-current="true"`).
  Cards and chips are keyed by `item.id` so the 3s poll can replace the array
  without disturbing selection or composer text. Selection is a panel-local
  `activeId`, never an index. If the active item leaves the open pool without a
  user action (the poll answering, resuming, or dismissing it elsewhere),
  advance to the next open item in list order, wrapping to the previous if it was
  last (D6).
- **Body** (`min-h-0 flex-1 overflow-y-auto p-4 space-y-3`): the active item card —
  `rounded-lg border-l-2 p-3`, rose/amber/slate left border by state; label
  (`Critic blocked` / `AI needs input` / `Resolved ✓`); per-item dismiss `X`;
  title; `renderDetail` bullets + `Show full question`; gaps list for parked
  items; answer-state chip + `Retry` when failed.
- **Action row**: parked → `Resolve & Resume` + `Edit Manually`
  (both `min-h-[44px]`); questions → the composer submit (§8.5).
- **Empty state** (open count reaches 0 while the panel is open): `CheckCircle2`
  emerald tile, `All questions resolved`, `No pending questions from the current
  run.`, and a focused `Return to document` button. The panel stays mounted
  (no jarring auto-close mid-dwell); the badge hides.
- **Composer** (§8.5) docked at the bottom, `shrink-0 border-t`.

### 8.5 Answer flow — inline composer (retire the modal)

`AnswerDialog` is deleted. The composer docks at the bottom of the panel with the
active question's detail visible above it. Reasons:

1. The question surface is already a right-pane overlay; stacking a
   `fixed inset-0 z-50` modal on top is two surfaces for one task, and it covers
   the left pane that hosts the badge.
2. Multi-question navigation would otherwise be duplicated inside the modal.
3. It **structurally removes a focus bug**: `QuestionBar.closeDialog` restores
   focus to the "Answer" trigger button (`QuestionBar.tsx:150-153`). That button
   unmounts when the item leaves the `open` pool — which is exactly what the
   open-only 3s poll does once an item is answered server-side — so focus can
   fall to `<body>`. (The array *replacement* alone is harmless: cards are keyed
   by `item.id` at `QuestionBar.tsx:288` and reconcile in place.) Inline, there
   is no trigger to restore and the composer survives polls.
4. It removes the second window-level Escape listener and the duplicate
   Enter-to-send handler.

Composer: `label "Your answer"` → textarea (`min-h-[96px]`, existing slate/sky
tokens) → hint `Usually 1–3 sentences is enough.` → Enter sends / Shift+Enter
newline, guarded by `!e.nativeEvent.isComposing`. Submit errors render in a
`role="alert"` rose row. Queue feedback is the state chip (`Queued — applies
after this phase` / `Applying…`); the composer disables while queued or applying.
On `applied`, the composer is replaced by the existing 8-second `Resolved ✓`
dwell. `Retry` replays the last submitted text, or re-focuses an empty composer.

Drafts live in a panel-local per-item map keyed by `item.id`, so a poll that
briefly drops and re-adds an item cannot destroy typing; closing the panel
clears the map (D6). Applied/queued/failed feedback is driven by the lifted
`answerStates`, **not** by `answered` items in `portalItems` — the open-only poll
never durably carries those (`useAutopilotEvents.ts:148`). The panel keeps a
local snapshot of the item it just submitted so the 8-second dwell can still
render after the item leaves the open pool, and the badge's `resolvedCount` is
the count of `answerStates` entries in phase `applied` (D8).

### 8.6 Interaction table

| Trigger | Behaviour |
|---------|-----------|
| Badge click | `closed → open`. Panel overlays doc content, `animate-panel-in`; focus → composer (question) or first action button (parked). |
| Item arrives while closed | No auto-open. Badge pulse + count + live-region announce. |
| Minimize | `open → minimized`. Strip docks bottom; all state frozen; doc interactive; focus → `Expand`. |
| Close | `→ closed`. Unmount, reset, doc visible, focus → badge. |
| Dismiss (X) | Add to lifted `dismissedIds`, then `api.dismissPortalItem(id)`; advance to next open item (previous if it was last); 0 left → empty state. |
| Active item leaves the open pool on its own (poll) | Advance to the next open item, wrapping; that item's draft is retained in the draft map (D6). |
| Resolve & Resume | `api.autopilotResume(docPath)`, exact existing body. Item clears on the next poll; panel stays open. |
| Applied | Chip `Applied` + 8s `Resolved ✓` dwell; composer disabled; live-region `Answer applied.` |
| Failed + Retry | Rose chip + `Retry`; replay `retryText` or focus composer; chat also logs via the existing `answer_failed` handler. |
| Last item resolved | Empty state with focused `Return to document`; no auto-close. |
| Autopilot stops mid-answer | No panel change. The 3s poll / SSE-drop fallback still resolves the chip. |
| Checkpoint appears while open | Panel stays **fully operable** (portal answers are independent of the turn stream). The badge renders subdued but stays clickable (D9). |
| Project switch (`main key={projectRevision}`) | Whole view remounts; `surface`, panel state, and `answerStates` reset. Acceptable — run-scoped state. Listeners must be registered with cleanup so nothing leaks. |

### 8.7 Duplicate surface reconciliation

| Surface | Verdict | Actions → new home |
|---------|---------|--------------------|
| Chat sticky parked card (`DevelopmentView.tsx:599-661`) | **Delete** (triple duplicate; contains a dead no-op) | dismiss → panel card `X`; `autopilotResume` → panel `Resolve & Resume`; `setEditing(true)` → panel `Edit Manually`; `dismissedParked` set retained for filtering |
| `QuestionBar` card list | **Delete file** | answer → inline composer; chip/dwell/retry → `QuestionPanel`; live-region effect → `DevelopmentView`; collapsed strip → `QuestionBadge` |
| `AutopilotHud` parked cards | **Delete block + props** | `autopilotResume` → panel only; HUD keeps only the 13-dot rail and Start/Stop |

Every working action survives exactly once.

### 8.8 Accessibility

- Badge: `<button aria-expanded aria-controls="question-panel">`. Panel:
  `role="region"`, **no** `aria-modal`, **no** focus trap, **no** body scroll
  lock. Chip rail chips: `aria-current="true"` when active. Errors: `role="alert"`.
- Focus: open → composer or first action; minimize → `Expand`; close → badge;
  empty state → `Return to document`.
- While the panel is open, mark the covered doc content `inert` and
  `aria-hidden` so tab order cannot wander underneath it. React 18's type
  surface does not expose `inert`, so toggle it by ref in an effect
  (`el.toggleAttribute('inert', surface === 'open')`) next to the `aria-hidden`
  prop rather than casting types (D10).
- One persistent `role="status" aria-live="polite"` sr-only span owned by
  `DevelopmentView` (works even when the panel is closed) announces: question
  arrived (+N), queued, applying, applied, failed (+error). This is the existing
  transition-detection effect, moved out of `QuestionBar`.
- **Wire the dead `Ctrl+.`** in `DevelopmentView`: `keydown`, guard
  `(e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.repeat &&
  !e.isComposing && e.key === '.'`, `preventDefault`, toggle
  `open ↔ minimized` (open from `closed`). The `!e.altKey` guard blocks AltGr
  layouts that synthesize Ctrl+Alt+`.`; cleanup on unmount covers project switch.
- Escape has exactly one owner: `QuestionPanel`, window-level, cleaned on
  unmount, and only active when `surface === 'open'`. Empty composer → close;
  non-empty composer → clear the draft first (mirrors the old backdrop
  dirty-guard). `AnswerDialog`'s listener is deleted.

### 8.9 Visual and motion spec

- Tokens only: `slate-950/900/800`, `cyan`, `amber`, `rose`, `emerald`; no new hexes.
- Spacing in multiples of 4; primary actions `min-h-[44px]`; icon buttons
  `h-8 w-8` with `focus:ring-2 focus:ring-sky-500/40`.
- New keyframe in `index.css`: `panel-in` (opacity 0 → 1, `translateY(8px)` → 0,
  160ms ease-out).
- **Extend the `prefers-reduced-motion` block** to cover `animate-panel-in`,
  `animate-park-reveal`, `animate-question-arrive`, and
  `animate-answered-collapse` (currently only dialog/backdrop). Fixes an
  existing gap.
- Scroll behaviours use `'auto'` when reduced motion is preferred (existing pattern).

### 8.10 Builder calls made in this document

These are my calls, not the user's. Flagged so they can be overridden:

- **D1 — `Edit Manually` selects the doc.** Today it only flips `editing`, so it
  can edit whatever doc happens to be selected instead of the parked item's
  `docPath`. The panel version selects the phase for that `docPath` first.
- **D2 — Answering is allowed while a checkpoint is pending.** Portal answers
  post to `/api/portal/:id/answer`, independent of `/api/turns`, so the design
  does not gate the panel on `checkpoint`. The badge still goes subdued.
- **D3 — `IssuesAndQuestionsView` stays independent.** Out of scope; different
  data path and different vocabulary (shop-floor defects vs. AI questions).
- **D4 — No web test framework added.** Verification uses `tsc --noEmit` for
  `web/`, the root suite, and browser-driven checks (§9).
- **D5 — `Open document` appears only when it matters.** Shown in the panel
  header when the item's `docPath` differs from the selected phase; it closes the
  panel, selects that phase, and refreshes the doc. Same intent as D1.
- **D6 — `activeId` with advance-on-vanish, and per-item drafts.** No index-based
  selection, and polling cannot destroy typing.
- **D7 — Dismissal state is lifted.** The existing `dismissedParked` set becomes a
  general `dismissedIds` in `DevelopmentView`; badge counts and the panel both
  derive from `portalItems` minus `dismissedIds`, so dismissal is deterministic
  between polls instead of waiting up to 3 s for the server.
- **D8 — Terminal feedback derives from `answerStates`.** The open-only poll
  never durably carries answered items, so applied/queued/failed rendering, the
  8-second dwell, and the badge's resolved count come from `answerStates` plus a
  panel-local snapshot of the just-submitted item.
- **D9 — The badge stays operable during a checkpoint.** Subdued styling only.
  Otherwise a checkpoint arriving while the panel is closed would make the panel
  unreachable and strand pending questions, contradicting D2.
- **D10 — `inert` is toggled by ref.** React 18 types omit it; a ref effect
  avoids a cast and keeps `tsc --noEmit` green.
- **D11 — Inline composer, not modal.** The `AnswerDialog` modal is retired and
  the composer lives inline at the bottom of the right-pane panel. The user
  deferred; this is the designer's recommendation and accepted.

---

## 9. Verification plan

1. `npm --prefix web run build` — web `tsc --noEmit` + Vite build. **Gate.**
2. `npm test` (root) — root `tsc --noEmit` + vitest (`tests/**`). **Gate.**
   `tests/web-portal-detail.test.ts` covers `renderDetail`, which the panel
   reuses unchanged.
3. Browser checks against the running dev server, in priority order:
   - **Focus integrity across the poll:** open the panel, start composing, let
     the 3s poll replace `portalItems`, dismiss the active item. Assert
     `document.activeElement` never becomes `<body>`, the draft survives, and
     close returns focus to the badge.
   - **`Ctrl+.` vs input:** with the chat textarea focused and with the composer
     focused, send `Control+period` and `Meta+period`; only `surface` toggles.
     Regression: bare `Alt`-hold recording still works; `Alt+Control+.` does
     neither.
   - **Minimize/close semantics:** minimize → strip present, doc scroll position
     survived, composer text intact, `Expand` restores. Close → panel unmounted,
     composer cleared, badge focused, doc scroll untouched, empty state appears
     exactly once after the last dismissal.
   - **Checkpoint reachability:** with a checkpoint pending and the panel closed,
     the subdued badge is still clickable, the panel opens, and answering a
     portal question during the checkpoint succeeds (D9/D2).
   - **Advance-on-vanish:** while composing on item A, let the poll drop A and
     add B; assert selection moves to B and A's draft is still in the map when A
     returns (D6).
4. Critic + security review of the diff (critic: simplification and boundaries;
   security: the `dismissPortalItem` / `autopilotResume` / answer POST paths are
   unchanged, confirm no new injection or traversal surface).

---

## 10. Risks

| Risk | Mitigation |
|------|------------|
| `portalItems` replaced every 3s disturbs selection/composer | Key by `item.id`; panel-local `activeId` (not index), with an advance-on-vanish rule |
| `answerStates` grows unbounded (a `queued` chip that never resolves) | Pre-existing. Panel shows the chip; the SSE-drop fallback still flips to `applied`. Tracked as a follow-up, not fixed here |
| Two `portalItems` sources (`useTurnStream` vs `useAutopilotEvents`) | Wire the panel only to `useAutopilotEvents`; remove the unused `useTurnStream.portalItems` only if trivial |
| Right pane hidden below `lg` | Accepted (user scoped mobile out). The badge stays in the left pane, so a narrow viewport still shows a count even though the panel cannot render |
| `refreshDoc` after submit targets the *selected* phase, not the answered doc | Pre-existing. `answer_applied` already carries `item.docPath`; if the answered doc differs, the panel's `Open document` action navigates there (D5) |
| Ghost `(turnStream as any).autopilotEnabled` | Do not propagate the pattern when editing `AutopilotHud`'s props |

---

## 11. What is left to the builder

- Exact chip-rail wording and truncation width.
- Whether the pager and the chip rail both ship, or the rail alone is enough for
  the expected 2–3 concurrent questions.
- Strip copy for the minimized state.
- Whether to delete the unused `useTurnStream.portalItems` field in this change.
- Test names and file layout for any new pure helper (e.g. `selectPhaseByDocPath`).
