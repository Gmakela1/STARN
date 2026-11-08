# Engineering Studio Workspace Restructure — Design Spec

**Date:** 2026-11-03 · **Scope:** `web/` presentation layer only (layout, chrome, question surface, doc-pane highlighting, progress rail, dashboard deep-links) · **Stack:** React 18 + Tailwind 4 tokens (slate/sky/cyan/amber/rose/emerald) + lucide-react · **No new dependencies · No `src/` core, server, or HTTP/SSE contract changes** · **Test runner already present:** `web/vitest.config.ts` (vitest + jsdom + @testing-library, `include: src/**/*.test.{ts,tsx}`).

This document restructures the Engineering Studio from a fixed 50/50 two-pane into a measured, resizable workspace, moves the question surface back into the **left** pane, and connects the question queue to the document it is about. It adopts the concrete recommendations of the workspace research brief (6 areas).

---

## 0. Source truth (verified against code on 2026-11-03)

- `web/src/views/DevelopmentView.tsx` (1146 lines) — root layout is `grid h-full grid-cols-1 lg:grid-cols-2` (line ~757). Left `<section aria-label="Agent conversation">` holds the feed (`min-h-0 flex-1 overflow-y-auto p-4`), then `<QuestionBadge>` (line ~822), then the input `<footer>`. Right `<section aria-label="Document workspace" className="hidden min-h-0 flex-col lg:flex">` holds a doc `<header>` (selector + Edit/Save/Approve, line ~881), `<AutopilotHud>` (line ~978), a **quality-example drop-zone strip** (line ~994), then `relative min-h-0 flex-1` wrapping `docContentRef` (the scroll region) **and `<QuestionPanel>`** (line ~1097) — i.e. the question overlay currently sits **on the right**, over the doc.
- `surface: 'closed' | 'open' | 'minimized'` and `dismissedIds` live in `DevelopmentView` (D7). `answerStates` (`queued|applying|applied|failed`) also live there. `Ctrl/Cmd+.` toggles `surface` (line ~471). The doc content element is marked `inert` + `aria-hidden` while `surface === 'open'` (line ~538) — **this must flip to the feed, not the doc**, once the panel moves left.
- `web/src/components/QuestionPanel.tsx` (660 lines) — `absolute inset-0 z-20 flex flex-col bg-slate-950`; header (icon + count + origin-doc chip + `asked while {section}` + Blocking pill + `‹ n of m ›` pager + `Open document`), a horizontally-scrollable chip rail, the body, and a **docked composer** (`shrink-0 border-t`, line ~636). Selection is `activeId` (id-keyed, never index) with an advance-on-vanish rule.
- `web/src/components/QuestionBadge.tsx` — left-pane trigger. Full strip `min-h-[44px] border-l-2 bg-slate-900/80`, subdued `h-8` line during a checkpoint; `aria-expanded` / `aria-controls="question-panel"`.
- `web/src/components/AutopilotHud.tsx` — a single-row rail `flex items-center gap-1.5 px-3 py-1.5`, 13 dots each `w-2 h-2 rounded-full`, dots container `flex-1 min-w-0` (this is the excess empty space), then `Drafting: {name}`, then the status word **or** the `Start Auto-Drafting` button, then `Stop`. Real states used: `docStatus[phaseId] ∈ { passed, auto-approved, drafting, parked, idle }`.
- `web/src/layouts/AppShell.tsx` — **two stacked full-width bars**: `<header>` (brand + project, Stage/Reconnecting/**Agent Status** badge, line ~139) and the desktop hub `<nav role="tablist">` (line ~300, `hidden lg:flex`). Agent badge only distinguishes `Working…` (busy) vs `AI Ready` — the research brief calls this out as insufficient ("a top bar with only 'agent is working' fails this"). Also owns `tab`, `buildSubTab`, `vaultSubTab`, `studioPhase`, and the `key={projectRevision}` remount on `main`.
- `web/src/views/DashboardView.tsx` — "Open Actions" `renderActionPane` (line ~78) groups `portalSummary.topItems` into **4 tiers** (Blocking / Parked / Needs Input / Shop Floor Flags); each row is a `<li onClick>` that only calls `onNavigate(route)` — **no item id is carried, so clicking a question can't focus it**. Header shows tier counts.
- `web/src/types/api.ts` — `PortalItem` includes `docPath?`, `section?` (exists in the type, **never populated**), `status`, `createdAt`. `AutopilotStatusResponse` = `{ enabled, running, currentPhaseId?, docStatus, blocks, passedCount, totalPhases }`. `RoadmapPhase.status ∈ 'COMPLETED'|'IN_PROGRESS'|'PENDING_REVIEW'|'PENDING'|'LOCKED'` with `docExists`.
- `src/core/autopilot.ts` — `AutopilotDocStatus = 'idle'|'drafting'|'critic'|'revising'|'passed'|'auto-approved'|'parked'`. The question `onQuestions` item type (line ~36) is `{ type:'question'; severity:'normal'; docPath; title; detail?; source }` — **no `section`**, which is exactly why `PortalItem.section` is never set.
- `src/core/question-portal.ts:4` — `PortalItemInput = Omit<PortalItem, 'id'|'createdAt'|'updatedAt'|'status'>` **already accepts `section`**; the value just never reaches the call.
- Requirement IDs are real and formatted `SS-01`, `SS-01.a`, `ICD-E-01`, `WI-1`, `MECH-01`, `MVP-01`, `DD-01` (frequency-checked across `docs/`, `examples/`, `tests/`). The research brief's "9/9 real questions contain a requirement ID that exists in the doc" holds.
- `web/src/index.css` — keyframes `question-arrive`, `dialog-in`, `backdrop-in`, `answered-collapse`, `park-reveal`, `panel-in`; the `prefers-reduced-motion` block covers all of them. `*:focus-visible` is a global cyan ring; scrollbars are thin slate.

---

## 1. Intent and why (in the user's terms)

1. **The question surface is in the wrong pane.** Today it overlays the **right document pane** (`QuestionPanel` mounted inside the doc section) and it is "too cramped". The question is about a document, but the reader needs the question narrow and the document wide — the opposite of what a 50/50 grid plus a right-side overlay gives.
2. **The document pane is starved of space.** Two stacked top bars in `AppShell`, a ~32px autopilot rail, a ~32px drop-zone strip, and a doc header crowd the pane before any prose renders. Answering a question means scrolling the document to find the part the question is about.
3. **Clicking a question doesn't take you to the relevant part of the doc.** The question names a requirement (`SS-09.a`), the document contains it, but nothing links them. `PortalItem.docPath` is populated; `PortalItem.section` is in the type but never set; the app never scrolls the doc to the answer's subject.
4. **The 13-dot rail lies.** An **approved** document and a merely **drafted** one render identically, and "not started" is a barely-distinct gray. The user cannot read progress at a glance.
5. **Open questions don't reach the Dashboard's action surface.** "Open Actions" lists questions but clicking one just switches tab; the question isn't focused, and there is no path back to the queue.
6. **The tension to resolve:** the design consensus is "never let an interruption erase the feed — agent state must be visible at all times," yet the user explicitly wants the question panel to **cover the feed**. Resolution (§5.H): cover the feed, but the **persistent top bar carries real run state** (working / waiting-for-input / finished / failed + current phase + step), so state is never invisible; minimizing restores the feed instantly.

---

## 2. Goals / Non-goals / Anti-goals

### Goals
- G1 Move the question surface to the **left pane**, full-height, covering the chat/activity feed; same badge → open → minimize/close contract. When open it leaves the persistent top status bar visible and carries its own **docked composer**.
- G2 The **right document pane** gives up chrome (merged bar, slim rail, folded drop zone) and gains height; default split when a question is focused is **question 40 / document 60**.
- G3 Clicking a question opens its document in the right pane **scrolled to and highlighting the section the question is about** (primary: requirement-ID match; optional durable: heading match via populated `section`); **no-match fallback** = open the doc, no highlight. Highlight is temporary/fading and **never color-alone**.
- G4 The **global question set across all documents** is preserved; every item shows its **origin document**.
- G5 Open questions surface on the **Dashboard** as typed event rows grouped by phase, each deep-linking into the studio with that question focused; the studio offers a return path to the queue.
- G6 The 13-dot rail becomes a **5-state rail** (not started / in progress / drafted-awaiting-review / approved / error-parked) using **shape + icon + text** (never color alone), `aria-current="step"`, a per-dot accessible label, and a legend.
- G7 Merge the two stacked top bars into **one 48–56px bar** (brand + project left · nav tabs middle · agent status cluster right) with priority-based overflow; densify the autopilot rail.
- G8 **Pane sizing**: draggable divider with min/max clamps (≥340px/pane), collapse/restore per pane, and a focus/maximize (Zen) toggle for either pane.

### Non-goals
- Mobile/`<lg` parity. The document pane is `hidden lg:flex` today and stays a large-screen split; `<lg` gets a full-width question surface and (follow-up) a full-page document. (Research Area 6 uses the Material large/XL two-pane breakpoint; below it, single-pane.) [36]
- URL routing. The app uses **tab state**, not routes. G5 is specced as a **state-based jump** with URL routing noted as a follow-up (§10). Research Area 5's "the detail is a route" is explicitly deferred. [34]
- Changes to `src/` core, the portal HTTP/SSE contract, the answer-queue state machine, or `renderDetail`.
- `IssuesAndQuestionsView` ("Shop Floor Flags"): different data path (`GET /api/issues`), stays untouched.
- Populating `PortalItem.section` in the autopilot is **optional** (durable upgrade), not required for the primary highlight path.

### Anti-goals
- A second scroll region in the chat pane. The panel **replaces** the feed in place (one region at a time), it does not stack a new scrollbar beside it. (Carries over the activity-stream rule: "do not create a second scroll region".)
- New emoji in chrome. Existing emoji in *copy* (`✔ Uploaded`, `✅`) are out of scope; **no new** emoji in rail, rows, badges, or panel.
- Losing the feed's scroll position or `answerStates` across open/minimize/close (The panel keeps the existing "unmount resets on close, CSS-hide freezes on minimize" contract.)
- Re-introducing a modal. The composer is docked, not `fixed inset-0 z-50` (§8 of the 2026-10-27 spec retired `AnswerDialog`; keep it retired).
- Auto-opening the panel when a question arrives. The badge pulses; the user opens it (except for an explicit deep-link jump, G5).
- A 6th rail state. `LOCKED` and the auto-vs-human approval distinction are **sub-flags**, not states.

---

## 3. Locked constraints

- **Presentation only.** All work is in `web/src/components`, `web/src/views`, `web/src/layouts`, `web/src/lib`, `web/src/index.css`. No `src/*` import appears in core. `AGENTS.md` "Core logic stays I/O-agnostic" is honored: nothing here touches the agent loop, state, or tools.
- **No new npm dependencies.** `ResizeObserver`, `matchMedia`, `localStorage` are browser APIs. Icons come from the already-bundled `lucide-react`.
- **Component tests are in scope.** `web/vitest.config.ts` already runs `src/**/*.test.{ts,tsx}` in jsdom with `@testing-library/react` + `user-event` (existing: `Markdown.test.tsx`, `QuestionBadge.test.tsx`, `QuestionPanel.test.tsx`, `src/lib/portalDetail.test.ts`). Spec pure helpers + component tests where they add value; behaviors that need layout/paint stay live-browser checks.
- **Tokens already in the design system:** `slate-950/900/800/700/600/500/400/300/200/100`, `sky-*`, `cyan-*`, `amber-*`, `rose-*`, `emerald-*`. **No new hex values.**
- **Motion language:** reuse `animate-question-arrive`, `animate-panel-in`, `animate-park-reveal`, `animate-answered-collapse`; add **one** keyframe (`anchor-flash`); wire everything through `prefers-reduced-motion`.
- **Copy voice** (from the activity-stream spec): natural English, em-dash connector, lowercase doc names, no jargon, no emoji.
- **No new scroll regions**, no new top-level routes, no changes to the `answerStates` handoff (§1.6 of the 2026-11-02 spec stays as-is).
- **Directives A–I are locked user intent** and are treated as requirements, not options.

---

## 4. Current-state inventory (exact files + line refs)

| Surface | File | Anchor | Today |
|---|---|---|---|
| Two-pane root | `web/src/views/DevelopmentView.tsx` | `grid h-full grid-cols-1 lg:grid-cols-2` (~757) | Fixed 50/50, no divider, no collapse |
| Left feed | same | `<section aria-label="Agent conversation">` (~758) | Feed scroll region + badge + input footer |
| Question badge | `web/src/components/QuestionBadge.tsx` | full strip / `h-8` subdued | Left pane, below the feed |
| Question overlay | `web/src/components/QuestionPanel.tsx` | mounted in the **right** section (~1097) | `absolute inset-0 z-20` over the doc content |
| Doc header | `DevelopmentView.tsx` | (~881) | Selector + Refresh/Edit/Save/Cancel/Approve |
| Autopilot rail | `web/src/components/AutopilotHud.tsx` | rail row `px-3 py-1.5` | 13 × `w-2 h-2` dots, `flex-1` spacer, Start/Stop |
| Example drop zone | `DevelopmentView.tsx` | (~994) | ~32px strip above the doc |
| Top bar #1 | `web/src/layouts/AppShell.tsx` | `<header>` (~139) | Brand + project + Stage/Reconnecting/Agent badges |
| Top bar #2 | `web/src/layouts/AppShell.tsx` | `<nav role="tablist">` (~300) | 5 hub tabs (`hidden lg:flex`) |
| Dashboard actions | `web/src/views/DashboardView.tsx` | `renderActionPane` (~78) | 4 tiers, rows navigate by tab only, no id |
| Portal model | `web/src/types/api.ts` | `PortalItem` | `docPath?` set, `section?` never set |
| Real states | `src/core/autopilot.ts` | `AutopilotDocStatus` | `idle drafting critic revising passed auto-approved parked` |
| Roadmap states | `web/src/types/api.ts` | `RoadmapStatus` | `COMPLETED IN_PROGRESS PENDING_REVIEW PENDING LOCKED` |

Duplicate surfaces resolved by the 2026-10-27 spec (chat sticky park card, `QuestionBar`, HUD park cards) are **already gone** — do not resurrect them.

---

## 5. The design

### 5.A — Left-pane question surface (moved back, covers the feed)

**What moves:** `QuestionPanel` is mounted inside the **left** section, after the feed scroll region, as a sibling of `<QuestionBadge>` and the input `<footer>`. It keeps `absolute inset-0 z-20 flex flex-col bg-slate-950 animate-panel-in`, but its `inset-0` now fills the **chat pane** (which becomes `relative`).

**Mount shape (signature only):**

```tsx
{/* left pane, new wrapper */}
<section aria-label="Agent conversation" className="relative flex min-h-0 flex-col border-r border-slate-800">
  <div id="studio-feed" ref={feedScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">…</div>
  <QuestionBadge … onOpen={() => setSurface('open')} buttonRef={badgeRef} />
  <footer className="border-t …">… input bar …</footer>
  <QuestionPanel surface={surface} items={openItems} … onMinimize={…} onClose={…} onFocusDocument={focusDocOnQuestion} />
</section>
```

The right section stays `relative` only so the highlight scrim can be positioned; the panel no longer lives there.

**Cover semantics.** `surface === 'open'` marks the **feed** region inert, not the doc:

```tsx
// DevelopmentView — swaps the current docContentRef toggle
useEffect(() => {
  const el = feedScrollRef.current;                 // was docContentRef
  if (!el) return;
  if (surface === 'open') { el.setAttribute('inert',''); el.setAttribute('aria-hidden','true'); }
  else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
}, [surface]);
```

The doc region keeps `ref={docContentRef}` for the scroll/highlight logic but is **never** inert — it is exactly what the user reads while answering.

**Docked composer** is unchanged (`shrink-0 border-t … p-3`, `min-h-[96px]` textarea, Enter=send / Shift+Enter=newline guarded by `!e.nativeEvent.isComposing`). It stays at the panel's bottom edge.

**State contract preserved** (2026-10-27 §8.2/§8.5): `surface` and `dismissedIds` stay lifted in `DevelopmentView`; `activeId`, `drafts`, `showFull`, `retryText`, and the 8-second `Resolved ✓` dwell stay panel-local; close unmounts + resets; minimize freezes the mounted tree behind a `h-[44px]` strip.

**Run-state echo in the panel header.** Because the panel covers the feed, the panel header additionally shows a compact run-state echo so the pane is self-describing even if the eye misses the top bar: `[dot] {Working… | Waiting for your answer | Finished | Failed}` + `{phase name}`. This reuses the same `RunState` value the top bar renders (§5.H) — one source, two render sites.

**Interaction table (left-pane surface):**

| Trigger | Behaviour |
|---|---|
| Badge click / `Ctrl+.` | `closed → open`. Panel covers the feed; focus → composer (question) or first action button (parked). Top bar unchanged. |
| Item arrives while closed | No auto-open. Badge pulse (`animate-question-arrive`) + count + live-region announce. |
| Minimize | `open → minimized`. `h-[44px]` strip docks at the pane bottom; feed interactive; all panel state frozen; focus → `Expand`. |
| Close | `→ closed`. Unmount, reset; feed visible; focus → badge. |
| Click a chip / `‹ n of m ›` | `activeId` changes; the right doc **scrolls + highlights** that item's subject (§5.C) via `onFocusDocument`. |
| Focus a question (deep-link) | `surface → open`, `activeId` set, composer focused, doc scrolled + highlighted (§5.E). |
| Dismiss (X) | add to lifted `dismissedIds`, call `api.dismissPortalItem`; on failure roll back + announce; advance to next open item. |
| Last item resolved | Empty state (`CheckCircle2`, "All questions resolved") with focused `Return to document`; no auto-close. |
| `Ctrl+.` while typing | Guard `(ctrl||meta) && !alt && !shift && !repeat && !isComposing && key==='.'`; toggles `open ↔ minimized`. `Alt`-hold recording untouched. |
| Escape | Single owner, `surface === 'open'` only: non-empty draft clears first, second Escape closes. |

Research grounding: conversation + separate task-state panel, "state visible at all times" [1](https://jacar.es/en/ui-design-for-agents-principles-were-starting-to-understand/); interruption as an explicit persisted state machine [2](https://agentsurface.dev/docs/agentic-ui/session-control); bounded answer surface with a docked composer (Agentero bottom-dock, LibreChat composer popover) [11](https://github.com/danny-avila/LibreChat/pull/14737), [12](https://github.com/poco-ai/Agentero/blob/8aa1ed0c/src/components/agent/ask-user-question-form.tsx).

---

### 5.B — Right document pane: more reading space

Three chrome reductions, in order of size:

1. **Fold the example drop-zone strip into the doc header.** The whole strip disappears; `onDragOver`/`onDrop` move onto the doc body wrapper, and a single `Paperclip` icon button (`h-8 w-8`, `aria-label="Attach a quality example"`) joins the header action cluster next to Refresh. Reclaims ~32px. (`uploadNotice` renders as the existing `border-b … py-1.5` status line only when set — zero height when idle.)
2. **Densify the autopilot rail** (§5.G): the 13-dot rail collapses from a `px-3 py-1.5` stacked row into the doc-header line as a `h-8` cluster. Reclaims ~24–32px.
3. **Trim doc padding** in view mode: `p-5` → `px-6 py-4` and cap the measure for prose-only docs with `max-w-[72ch]` (only when the doc has no tables; tables keep full width via the existing `overflow-x-auto`). Base body text stays `text-sm`/`1.65` (`doc-prose`) — the readability gain is *width and vertical space reclaimed*, not smaller type.

Net: the document pane gains **~60–72px of height** and, when a question is focused, **~90px of width** (40/60) plus a centered highlighted section (§5.C) so the user reads the subject without hunting.

**"Side-by-side readability"** is the core win of A+C: the document is *never covered* by the question surface (the panel is on the left), so the question and its subject document are visible simultaneously. This directly satisfies b: "bigger/side-by-side readability, less scrolling when answering."

Research grounding: reclaim vertical space by merging chrome [24](https://www.sap.com/design-system/fiori-design-web/v1-71/foundations/integration-and-services/sap-fiori-launchpad/merged-header), [28](https://carbondesignsystem.com/components/data-table/usage/); two-pane for reading with a fixed default pane [36](https://m3.material.io/foundations/layout/breakpoints/large-extra-large); prefer horizontal splits for reading [40](https://create.tuvsud.com/latest/components/split-panel/usage-iRbgXMon).

---

### 5.C — Doc-pane section highlight mechanism

**Trigger.** `QuestionPanel`'s `onFocusDocument(item)` fires on (a) chip/pager selection, (b) panel open onto an item, (c) a deep-link focus (§5.E). `DevelopmentView` owns the highlight effect and the `highlightTarget: { docPath, requirementId } | null` state.

**Primary mechanism — requirement-ID match.**

1. **Extract** candidate IDs from the question (`item.title` then `item.detail`), in order:
   ```ts
   // web/src/lib/requirementAnchor.ts (signature only)
   const REQ_RE = /\b[A-Z]{2,6}(?:-[A-Z0-9]{1,4})?-\d{1,3}(?:\.[a-z0-9]{1,3})?\b/g;
   export function extractRequirementIds(text: string): string[];   // deduped, in order
   export function pickAnchorId(ids: string[], docContent: string): string | null; // first id present in doc
   ```
   The regex matches `SS-01`, `SS-09.a`, `ICD-E-01`, `WI-1`, `MECH-01`, `MVP-01`, `DD-01`. It can over-match tokens like `SHA-256`/`PDF-1.4`; **`pickAnchorId` rejects them because they are not in the doc**, which is exactly the no-match fallback (a false positive degrades safely, never mis-highlights).
2. **Resolve to the block** — pure, testable, on the raw content:
   ```ts
   export function findAnchorBlock(content: string, id: string): { blockText: string; headingText: string | null } | null;
   ```
   Splits the content into blocks on blank lines; finds the block whose text includes `id`; walks **up** to the nearest preceding heading line (`/^#{1,6}\s/`) for the section title (used for the announcement + the transient marker).
3. **Scroll + highlight** — a DOM helper applied after the doc renders:
   ```ts
   export function applyAnchorHighlight(root: HTMLElement, id: string, ms = 2400): HTMLElement | null;
   ```
   Searches `root` descendants (`.doc-prose`) for the **block-level** element (`H1..H6, P, LI, TD, TR` — preferably the closest block whose `textContent` contains `id`, never the whole `div.doc-prose`), then `el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })`, adds `data-studio-anchor` + `animate-anchor-flash`, and removes them on a timer. Returns the element or `null`.

**Effect wiring (signature only):**

```tsx
// DevelopmentView
const [highlight, setHighlight] = useState<{ id: string; docPath: string; token: number } | null>(null);
useEffect(() => {
  if (!highlight || editing) return;
  if (selectedDocName !== basename(highlight.docPath)) return;  // doc not loaded yet
  const root = docContentRef.current; if (!root) return;
  const ok = applyAnchorHighlight(root, highlight.id);
  setAnnouncement(ok
    ? `Jumped to ${highlight.id} in ${basename(highlight.docPath)}.`
    : `Opened ${basename(highlight.docPath)} — couldn't locate ${highlight.id} in this document.`);
}, [highlight, doc, editing, selectedDocName]);
```

**Temporary + fading + never color-alone.** The highlight is not just a tint:
- Shape/outline: `ring-2 ring-sky-400/70 ring-offset-2 ring-offset-slate-950` (a visible outline, not only a background).
- A transient text marker: a small chip pinned to the block's top-right reading the requirement ID (`SS-09.a`), rendered as a sibling span inserted by the helper and removed with the highlight.
- A live-region announcement (`role="status" aria-live="polite"`), so the change is announced in words.
- Auto-clears after ~2.4s (fade), and clears immediately on scroll-away, doc change, or entering edit mode.

So: outline (non-color) **+** text marker **+** announcement **+** background tint (the only color-only part, used decoratively). WCAG SC 1.3.3 satisfied. [20](https://www.w3.org/TR/WCAG22/)

**Optional durable upgrade — heading match via `section`.** If the autopilot is later changed to populate `PortalItem.section` (add `section?: string` to the `onQuestions` item type in `src/core/autopilot.ts` and pass it into `addPortalItem`; `PortalItemInput` already accepts it), then when no requirement ID matches, fall back to matching `item.section` against a rendered heading by text, and highlight from that heading to the next equal-or-higher heading. This is **out of scope for this pass** and flagged in §10.

**No-match fallback (required).** If `pickAnchorId` returns `null` **or** `applyAnchorHighlight` returns `null`: still **select the item's `docPath` phase and open the document**, no highlight, and announce `Opened {doc} — couldn't locate a requirement anchor in this document.` The card shows a muted inline note (`text-[11px] text-slate-500`) "No matching section found". Never block navigation on a failed anchor.

**Cross-doc correctness.** `selectPhaseByDocPath` already matches the roadmap phase by artifact filename suffix and calls `api.setActivePhase`; the highlight effect waits until `doc` for that phase has loaded (`selectedDocName === basename(docPath)`) before applying. If the item's doc differs from the current phase, the jump navigates first, then highlights.

---

### 5.D — Global question set (preserved)

`portalItems` from `useAutopilotEvents` remains the **single global set across all documents**. Nothing here regroups it into per-document buckets; the panel, the badge, and the Dashboard all read the same array.

- Each item keeps `item.docPath` and displays the **origin document** in: the panel header (`{docPath.split('/').pop()}` mono chip), the card header (`text-[11px] font-mono text-slate-500`), the chip rail (`title` attr), and the Dashboard row (§5.E).
- `visibleItems = portalItems.filter(i => !dismissedIds.has(i.id) && (status === 'open' || status === 'answered'))` stays the one derived pool (D7). The panel receives `openItems = visibleItems.filter(i => i.status === 'open')`.
- The 3-second poll **replaces** the array; cards/chips stay keyed by `item.id`; `activeId` (never index) with advance-on-vanish (§8.4 of the 2026-10-27 spec) is unchanged.

Research grounding: one unified queue across sources, provenance kept per item [32](https://uxpatternsguide.com/patterns/activity-feed/), [31](https://linear.app/docs/inbox).

---

### 5.E — Dashboard "needs input" rows + state deep-link

**Row shape — typed event row** (`Agent · needs input · <document> · 1-line summary · timestamp`), grouped by tier *then* by phase/document:

```
Needs Input                                            6
┌─────────────────────────────────────────────────────────────────────────┐
│ [MessageSquare amber] STARN · needs input · REQUIREMENTS.md              │
│   What operating voltage does the traction motor require?     2h ago  →  │
├─────────────────────────────────────────────────────────────────────────┤
│ [MessageSquare amber] STARN · needs input · ICD.md                       │
│   Which connector family does ICD-E-01 standardize on?        1d ago  →  │
└─────────────────────────────────────────────────────────────────────────┘
```

Exact tokens:
- Row = a real `<button className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-800/40 focus:outline-none focus:ring-2 focus:ring-sky-500/40">` (whole row is the target; ≥44px via `py-2` + two lines).
- Line 1: `text-[11px] font-mono text-slate-500` → `STARN · needs input · {basename(docPath)}`.
- Line 2: `truncate text-sm text-slate-200` → `item.title` (existing `extractLede` reused if a one-line summary is needed from `detail`).
- Right: relative timestamp (`text-[11px] text-slate-500 tabular-nums`, computed from `item.createdAt`) + `ArrowRight` `h-3 w-3 text-slate-600`.
- Tier headers unchanged (`text-xs font-bold uppercase tracking-wider` + count).

**Deep link (state-based, pragmatic).** `AppShell` gains:

```tsx
const [studioQuestionId, setStudioQuestionId] = useState<string | undefined>(undefined);
// DashboardView
onOpenQuestion={(id) => { setStudioQuestionId(id); setTab('development'); }}
// DevelopmentView
<DevelopmentView … initialQuestionId={studioQuestionId} />
```

`DevelopmentView` runs a one-shot effect on `initialQuestionId` change: `setSurface('open')`, `setActiveId(id)`, `focusDocOnQuestion(item)` (§5.C). Clearing `studioQuestionId` afterwards (or keying on `tab`) prevents re-triggering on unrelated re-renders.

**Return path to the queue.** Because there is no route, the studio provides an explicit **`Back to Open Actions`** control in the question panel header (`ArrowLeft` + label, `text-[11px] text-sky-400`) that calls `onNavigate('dashboard')` (passed down). This is the state-based stand-in for the browser Back. Real URL routing is a follow-up (§10).

**Inbox affordances adopted** (subset, presentational): an unread **count badge** on the `Engineering Studio` hub tab (`Needs Input {n}`), and **J/K** to move between Dashboard rows / question chips (`keydown` on the list container, guarded for inputs). **Snooze / mark-all-read / server-persisted seen-state** are deferred (§10) — they require a persistence contract change. Research: Linear Inbox Priority tab, J/K, badge count, cap [31]; typed actor-verb-object events with deep links and grouping [32]; notification-center badge semantics [33](https://completefrontend.com/system-design/problems/notifications-center).

---

### 5.F — 5-state progress rail

**Component split.** Extract the rail from `AutopilotHud.tsx` into a new `web/src/components/PhaseRail.tsx`; `AutopilotHud.tsx` becomes the thin wrapper that renders the rail + Start/Stop in the doc header (§5.G). A pure mapper lives in `web/src/lib/workflowState.ts`.

**Pure mapper (signature only):**

```ts
// web/src/lib/workflowState.ts
export type RailState = 'not-started' | 'in-progress' | 'drafted' | 'approved' | 'error-parked';
export interface PhaseRailView { state: RailState; auto: boolean; locked: boolean; label: string; }
export function railStateFor(input: {
  docStatus?: string;          // AutopilotDocStatus for this phase.id
  roadmapStatus?: RoadmapStatus;
  docExists?: boolean;
}): PhaseRailView;
```

**Mapping table (real states → 5 states):**

| 5-state | Marker shape | Icon (lucide) | Text / ARIA label | Sources mapped |
|---|---|---|---|---|
| **Not started** | hollow outlined circle, low contrast | `Circle` | "Not started" | `docStatus: idle` **and** `!docExists` **and** roadmap `PENDING`/absent. `LOCKED` → same shape + **lock sub-flag** ("Locked — reopen the upstream document"). |
| **In progress** | half-filled circle + spinner | `Loader2` (`animate-spin`, motion-safe) | "In progress — {phase}" (**`aria-current="step"`**) | `docStatus: drafting | critic | revising`; roadmap `IN_PROGRESS`. |
| **Drafted — awaiting review** | filled circle + hourglass | `Hourglass` | "Drafted — awaiting review" | `docExists` **and** roadmap `PENDING_REVIEW` (a draft exists, no human gate); `docStatus: passed` where no human approval yet. |
| **Approved** | filled circle + **checkmark** | `Check` | "Approved" (+ "auto" sub-flag) | roadmap `COMPLETED`; `docStatus: auto-approved` (sub-flag **auto**) or human `approved` (no sub-flag). |
| **Error — parked** | slashed circle + exclamation | `CircleSlash2` (fallback `TriangleAlert`) | "Error — needs attention" | `docStatus: parked`; `blocks > 0`. |

Rules of precedence (so a doc is never ambiguous): `parked` → error-parked → `drafting/critic/revising` → in-progress → `auto-approved/passed` or roadmap `COMPLETED` → approved → `docExists || PENDING_REVIEW` → drafted → roadmap `IN_PROGRESS` → in-progress → `LOCKED` → not-started(+lock) → not-started.

**This closes the exact gap the user named:** approved shows a **checkmark**, drafted shows an **hourglass**, not-started is a **hollow** circle, in-progress is a **spinner**. Shape + icon + text differ; color is reinforcement only.

**Rail markup (tokens):**
- Rail is an ordered list: `<ol role="list" className="flex items-center gap-[6px]">` with one `<li>` per phase (W3C multi-page: ordered list, one item per step [21](https://www.w3.org/WAI/tutorials/forms/multi-page/)).
- Each item is a small button (so it is focusable + labelled): `className="flex h-5 w-5 items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/40"`, `aria-label="{phaseName} — {label}"`, `title` mirrors it, and `aria-current="step"` **only** on the in-progress item. [22](https://www.w3.org/WAI/WCAG3/informative/layout/user-orientation/current-step-indicated/)
- Marker sizes by state: not-started `h-3 w-3 rounded-full border border-slate-600 bg-transparent`; in-progress `h-3 w-3 rounded-full border border-cyan-400 bg-cyan-500/20` with a `Loader2 h-2.5 w-2.5 text-cyan-300` overlay; drafted `h-3 w-3 rounded-full border border-amber-400 bg-amber-500/40` + `Hourglass h-2.5 w-2.5 text-amber-300`; approved `h-3 w-3 rounded-full border border-emerald-400 bg-emerald-500` + `Check h-2.5 w-2.5 text-emerald-950`; error-parked `h-3 w-3 rounded-full border border-rose-500 bg-rose-950/60` + `CircleSlash2 h-2.5 w-2.5 text-rose-300`.
- Clicking a dot selects that phase in the doc pane (reuses the doc-dropdown `onSelect` pattern: `setEditing(false); setSelectedPhase(id); api.setActivePhase(id); onProjectChanged()`), replacing the current dead `title`-only affordance (Atlassian: visited = clickable link [16](https://atlassian.design/components/progress-tracker/usage)).
- Keep the outer `role="progressbar" aria-valuenow={approvedCount} aria-valuemin={0} aria-valuemax={13} aria-label="{n} of 13 phases approved"` **outside** the `<ol>` (a `progressbar` cannot contain interactive buttons and be valid) — wrap both in a `<div>`, or drop the progressbar role in favor of the list semantics + an `aria-live` count. Choose the latter: `<div role="group" aria-label="Build phases">` + `<ol>` with per-dot labels + a `sr-only` "n of 13 approved" line. (Builder call BC-6.)

**Legend.** A `Legend` toggle (an `Info`/`CircleHelp` `h-8 w-8` button, `aria-expanded`) reveals a compact popover listing all five states with their glyph + label text. The legend is also rendered once, `sr-only`, at the end of the rail so screen readers get the vocabulary. (Pluma: the marker is decorative; the **text carries the state** [23](https://pluma.customer.io/components/stepper/accessibility).)

Research grounding for 5 states: Carbon progress indicator 7 states (completed/current/not-started/error…) with distinct glyphs [17](https://carbondesignsystem.com/components/progress-indicator/usage/); GitHub/Gitea status glyphs (hollow=waiting, spinner=running, check=success, X=failure) [18](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph), [19](https://github.com/go-gitea/gitea/pull/37206).

---

### 5.G — Merged single top bar + denser autopilot rail

**One bar, 56px.** Replace the two stacked `AppShell` bars with a single `<header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 backdrop-blur-md">`.

Layout, left→right:
1. **Brand + project** (`shrink-0`): keep the `Satellite` tile + `STARN` wordmark + project name (`truncate max-w-[220px]`). Drop the separate `Stage:` pill from bar #1 (it moves to the right cluster as the "active phase").
2. **Primary nav tabs** (`flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden`, `role="tablist"`): the 5 `HUBS`. Active `bg-cyan-500/15 text-cyan-300 border border-cyan-500/40`; inactive `text-slate-400 hover:bg-slate-800/60 border border-transparent`. Icon + label only (the two-line tagline is dropped to hold 56px; tagline becomes the `title` and the `aria-label`). Tagline reappears only at `xl` inside the tooltip, not the bar.
3. **Agent status cluster** (`shrink-0`, **always visible** — highest priority): `RunStateCluster` (§5.H) + the active-phase badge + the `Reconnecting…` badge when disconnected. This is the only element guaranteed to survive overflow.

**Priority-based overflow.** Nav tabs collapse before the status cluster:
- First pass (shippable): Tailwind breakpoints — hide the least-used tab labels below `xl` (icon-only with `aria-label`), and below `md` move the whole tablist into the existing mobile drawer (already the `<lg` behavior).
- Durable (Builder call BC-2): a `ResponsiveSlot` using a single `ResizeObserver` on the header, moving tabs that don't fit into a `MoreHorizontal` overflow menu (`aria-haspopup="menu"`), in ascending priority, exactly as Linear's header does. [25](https://pustelto.com/blog/reverse-engineer-linear-1-header/)

Keep the master/detail exception in mind (SAP keeps two bars when separating master from detail); this bar is global identity+nav, and the studio's own pane headers provide the master/detail separation, so the split-screen exception does not apply here. [24](https://www.sap.com/design-system/fiori-design-web/v1-71/foundations/integration-and-services/sap-fiori-launchpad/merged-header)

**Denser autopilot rail.** Inside the doc pane, fold the rail onto the doc-header line rather than giving it its own stacked row:
- The doc `<header>` becomes one `h-12` row: `[FileText] [selector] [PhaseRail (h-8 cluster)] …spacer… [Refresh][Paperclip][Edit/Approve][collapse][zen]`.
- `PhaseRail` renders at `h-8`; when the pane is narrow (`< ~560px`), it collapses to a **summary chip** — `[check] 6/13 · {current phase}` (`text-[11px] font-mono`) — that opens the same five-state legend/popover with the full dot list. This is the "dropdown or inline compaction" the directive asks for.
- `Start Auto-Drafting` / `Stop` move to the **far right** of the same row as `h-8` icon+label buttons (`Shrink-0`), so the empty `flex-1` spacer disappears.
- The `Drafting: {name}` text the HUD shows today is redundant with the `RunStateCluster` (§5.H) → removed; the current phase is shown once, in the run-state cluster.

Net: the doc pane loses one full rail row (~32px) and the app loses one full top bar (~44px of chrome above the panes).

Research grounding: SAP Fiori merged header merges two bars precisely for "redundant space due to multiple bars" [24]; Linear one-bar anatomy with title/tabs/side + priority `ResponsiveSlot` [25]; density as a first-class choice [28]; PatternFly overflow kebab [30](https://www.patternfly.org/components/toolbar/design-guidelines/).

---

### 5.H — Resolving the tension: cover the feed, but carry real run state

**The …but.** Research Area 1: "make agent state visible at all times — the user should never doubt whether it's working, waiting for input, or finished"; a top bar that only says "agent is working" **fails** this. The user wants the question panel to cover the feed. **Resolution:** cover the feed; the **persistent top bar** (which the panel never covers, because the panel is scoped to a pane) carries a real **4-state run state + current phase + step**. Minimizing restores the feed instantly; the run state never disappears.

**`RunStateCluster` (new `web/src/components/RunStateCluster.tsx`).** Derives a single value from signals already available:

```ts
// web/src/lib/runState.ts (signature only)
export type RunState = 'ready' | 'working' | 'waiting' | 'finished' | 'failed';
export function deriveRunState(i: {
  busy: boolean;                 // turnStream.busy
  checkpoint: boolean;           // turnStream.checkpoint !== null
  autopilotRunning: boolean;     // AutopilotStatusResponse.running
  openQuestions: number;
  blocks: number;                // AutopilotStatusResponse.blocks
  lastError?: string | null;
  passedCount: number;
}): RunState;
```

| Run state | Dot | Icon | Label / ARIA | Derivation |
|---|---|---|---|---|
| **Working** | `bg-cyan-400 motion-safe:animate-pulse` | `Loader2` (spin) | "Working…" | `busy` **or** (`autopilotRunning` && !waiting) |
| **Waiting for input** | `bg-amber-400` | `MessageSquare` | "Waiting for your answer" | `checkpoint` **or** (`autopilotRunning && openQuestions > 0`) |
| **Finished** | `bg-emerald-400` | `CheckCircle2` | "Finished" | not busy/running && `passedCount > 0` && no open questions/blocks |
| **Failed / parked** | `bg-rose-400` | `TriangleAlert` | "Needs attention" | `blocks > 0` **or** `lastError` |
| **Ready** | `bg-emerald-400` | (dot) | "AI Ready" | default (nothing running) |

The cluster renders `[icon][label] · [phase name] · [step]` in one line: label `text-xs font-semibold`; phase as a mono chip (`bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 uppercase`); step truncated `text-[11px] text-slate-400` (from `turnStream.status` or the newest activity text, `max-w-[180px]`). State is **never color-only**: distinct lucide icon + distinct word for each of the 5.

**Note on the current bug:** `AppShell`'s badge today is `Working…` vs `AI Ready` only, which cannot express "waiting for your answer" or "parked". To source `autopilotRunning`/`blocks`/`passedCount` without double-subscribing SSE, `AppShell` adds a lightweight `api.fetchAutopilotStatus()` poll (15s, alongside the existing `refreshProject` poll — or piggyback the existing `fetchProject`/dashboard payload). The existing `useAutopilotEvents` SSE hook **stays** in `DevelopmentView` for the feed; the top bar uses the REST snapshot only. (Builder call BC-1.)

Research grounding: interruption must not hide run state [1], [2]; Cursor OS notification on "run finishes or input required" as the canonical 4-state cue [9](https://cursor.com/changelog/1-5); SAP/Linear status pill in the bar [24], [25].

---

### 5.I — Pane sizing: divider, clamps, collapse, focus toggle

**Root.** Replace `grid h-full grid-cols-1 lg:grid-cols-2` with a flex row:

```tsx
<div className="flex h-full min-h-0">
  <section style={{ flexBasis: leftPct + '%' }} className="relative flex min-h-0 flex-col border-r border-slate-800" aria-label="Agent conversation">…</section>
  <PaneSplitter … />
  <section style={{ flexBasis: (100 - leftPct) + '%' }} className="relative flex min-h-0 flex-col" aria-label="Document workspace">…</section>
</div>
```

Both panes get `min-w-[340px] max-w-[calc(100%-340px)]` (clamp so no pane hits 0 — window-splitter requirement [37](https://uxpatternsguide.com/patterns/window-splitter/)). Below `lg`: the splitter is hidden and the doc pane is replaced by a full-width single-pane view (chat + panel); document becomes a full-page overlay (Notion "full page" analog [43](https://www.notion.com/releases/2022-07-20)) — **follow-up**, §10.

**`PaneSplitter` (new `web/src/components/PaneSplitter.tsx`).**

```tsx
<div
  role="separator" aria-orientation="vertical"
  aria-label="Resize question and document panes"
  aria-valuenow={leftPct} aria-valuemin={MIN} aria-valuemax={MAX}
  tabIndex={0}
  className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-slate-900 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
  onPointerDown={startDrag}
  onKeyDown={onKeyResize}
>
  <span className="h-8 w-0.5 rounded-full bg-slate-700 group-hover:bg-cyan-500/60" aria-hidden />
</div>
```

- **Pointer:** `pointerdown` → set `pointer capture`, track `clientX`, clamp to `[MIN, MAX]` (MIN = 340px expressed as a % of the pane width; MAX = `100 - MINpx%`).
- **Keyboard** (a11y): `ArrowLeft/ArrowRight` ±2%; `Home` → MIN, `End` → MAX; target ≥ 24px visual hit but keyboard is the fallback for dexterity. [37]
- **Collapse/restore per pane:** each pane header carries a `PanelLeftClose`/`PanelLeftOpen` (left) and `PanelRightClose`/`PanelRightOpen` (right) `h-8 w-8` button that sets that pane's basis to a `w-11` (44px) rail; the rail's expand button restores the previous `%`.
- **Focus/maximize (Zen) toggle:** each pane header carries `Maximize2` (enter Zen) / `Minimize2` (exit). Zen sets the other pane to collapsed and this pane to `flex-1`; `Esc` exits. VS Code Zen + Notion side-peek/full-page are the references. [42](https://code.visualstudio.com/docs/getstarted/userinterface), [43]
- **Persist:** `localStorage['starn.studio.splitPct']` on drag end (presentational only; not server state). Note `main` remounts on `key={projectRevision}` — the ratio is read on mount so it survives a project switch.

**Default ratios + the proportion question (directive I).**
- **Existing layout is a fixed 50/50** (`grid-cols-2`) with no divider, no clamps, no collapse, and no gap between panes.
- **Proposed baseline** (no question focused): **50/50** (unchanged visually, now draggable).
- **Proposed when a question is focused** (panel open on an item): **40/60** — question narrower, document wider. **This differs from the existing proportions** (which are always 50/50); the narrow left pane is what makes the doc "bigger/side-by-side". First focus of a question animates the ratio to 40/60 the first time only (respecting reduced motion), then respects any user drag. Research suggests a 35/65 list/detail default is also defensible; 40/60 is chosen to keep the question readable at the 340px clamp. [39](https://wiki.r-that.com/components/split-pane-layout/), [37]
- Clamp note: at a 1280px viewport, 40% = 512px and 60% = 768px — both well above 340px. At the 1024px `lg` floor, MIN 340px caps the left pane at 33% and the split effectively floors at ~33/67; the effect must clamp, not overflow.

---

## 6. Accessibility (WCAG 2.2)

- **Not color alone (SC 1.3.3 / 1.4.1).** Rail: every state carries a distinct **shape + lucide icon + text label** (`aria-label` per dot + the visible legend). Run-state cluster: distinct icon + word per state. Doc highlight: outline + transient ID marker + live-region announcement + tint. Dashboard rows: icon + text prefix (`STARN · needs input`), not a color.
- **`aria-current="step"`** on the single in-progress dot; the active question **chip** keeps `aria-current="true"`; the active nav tab keeps `role="tab" aria-selected`.
- **Focus management across pane changes.**
  - Panel open → focus the composer (question) or first action button (parked).
  - Minimize → focus the strip's `Expand`; Close → focus the question badge.
  - Deep-link jump (§5.E) → move focus to the focused question card's heading (`tabIndex={-1}` on the card, `focus()` on jump) and announce the doc jump.
  - Collapse a pane → focus that pane's restore button; Zen → focus the maximized pane's header; Esc → return focus to the Zen trigger.
  - Highlight → never steals focus; it only scrolls + announces.
- **Keyboard pane resizing.** The separator is focusable, `role="separator"`, with arrow/Home/End keys and `aria-valuenow/min/max` (§5.I). Drag is never the only way. [37]
- **Live-region announcements preserved.** Keep the existing single `role="status" aria-live="polite"` sr-only span in `DevelopmentView` (question arrived +N, queued, applying, applied, failed) and the newest-activity region in the feed. **Add** doc-jump announcements (`Jumped to {id} in {doc}` / `couldn't locate…`) and run-state transitions (`Waiting for your answer`, `Finished`) to the same polite region — one region, ordered phrases, no double-announce.
- **Covered-region a11y.** The covered feed is `inert` + `aria-hidden` (§5.A), so tab order can't wander into hidden content; the doc (which is *not* covered) stays fully operable — the inverse of today's behavior.
- **Contrast.** All text ≥ 4.5:1 on `slate-950` base (the activity-stream verified set: `slate-400` ≈ 7.5:1, `cyan-300`/`emerald-300`/`amber-300`/`rose-300` ≥ 8:1; rail glyphs as non-text ≥ 3:1). The ID marker text on `sky-950`/`slate-900` meets 4.5:1.
- **Targets.** Every interactive element ≥ 44×44 CSS px effective (icon buttons `h-8 w-8` inside a ≥44px row with 8px+ separation; rail dots are `h-5 w-5` visual inside a `h-5 w-5` button — bumped to a `min-h-[24px] min-w-[24px]` target with `px-0.5`, acceptable as a dense toolbar cluster with keyboard access; the legend/content is the primary path).
- **Motion.** `prefers-reduced-motion: reduce` → no pulse (spinner becomes a static half-fill glyph), no panel slide, highlight scroll uses `behavior:'auto'` and the tint remains as a static outline (no fade).
- **Forced colors.** Rail markers use border+glyph so they survive `forced-colors`; add `forced-color-adjust: none` **only** on the marker glyphs where the emerald check needs contrast against the system background. (Builder call BC-7.)

---

## 7. Visual + motion spec

- **Tokens only.** `slate-950/900/800/700/600/500/400/300/200/100`, `sky-*`, `cyan-*`, `amber-*`, `rose-*`, `emerald-*`. **No new hex values anywhere.**
- **Type scale unchanged:** base `text-sm` (`doc-prose` 0.875rem/1.65); chrome labels `text-xs`; micro-labels `text-[11px]`; the app floor is 11px (no body text below 12px).
- **Spacing in multiples of 4:** bar height `h-14` (56px) / `h-12` (48px); rail `h-8`; gaps `gap-1.5` (6px) / `gap-2` (8px); pane gutter `w-2` (8px).
- **Radii/borders:** reuse `rounded-full` (chips/dots), `rounded-lg` (buttons), `rounded-xl` (cards/dropdowns); borders `border-slate-800` / state accented borders.
- **Motion:**
  - Reuse `animate-question-arrive` (badge pulse), `animate-panel-in` (panel entrance, 160ms), `animate-park-reveal`, `animate-answered-collapse`.
  - **New keyframe** in `web/src/index.css`:
    ```css
    @keyframes anchor-flash {
      0%   { background-color: rgba(56,189,248,.18); box-shadow: 0 0 0 2px rgba(56,189,248,.7); }
      70%  { background-color: rgba(56,189,248,.10); box-shadow: 0 0 0 2px rgba(56,189,248,.5); }
      100% { background-color: transparent;          box-shadow: 0 0 0 0 rgba(56,189,248,0); }
    }
    .animate-anchor-flash { animation: anchor-flash 2400ms ease-out; }
    ```
    **Add `animate-anchor-flash` to the existing `prefers-reduced-motion` block.** (The ring is also a static `ring-2 ring-sky-400/70` while `data-studio-anchor` is present, so reduced-motion users still get a shape cue.)
  - Rail spinner: `Loader2` with `motion-safe:animate-spin` (static half-fill when reduced).
  - Run-state dot: `motion-safe:animate-pulse` for Working only.
- **No layout-shift animation.** Never animate `width`/`height` of text; divider drag is a real layout move (acceptable — it is direct manipulation). Panel entrance animates opacity+`translateY` only.

---

## 8. Builder calls (my decisions — overridable)

- **BC-1 — Top-bar run state sourced via REST poll, not a second SSE.** `AppShell` uses `api.fetchAutopilotStatus()` on a 15s interval (or the existing dashboard payload) for `running`/`blocks`/`passedCount`; `DevelopmentView` keeps the single `useAutopilotEvents` SSE for the feed. Rationale: avoid double-subscribing the SSE stream. Override if you prefer lifting the SSE hook to `AppShell`.
- **BC-2 — Overflow: breakpoints first, `ResizeObserver` durable.** Ship Tailwind breakpoints (icon-only tabs < `xl`, drawer < `lg`) in this pass; the `ResponsiveSlot` ResizeObserver is the follow-up. Override to do ResizeObserver now.
- **BC-3 — Focus-first ratio 40/60.** Chosen over the research's 35/65 [39] to keep the question readable at the 340px clamp. The ratio animates only on the **first** focus.
- **BC-4 — Rail is a group of buttons, not `role="progressbar"`.** A `progressbar` cannot contain interactive dot buttons; the rail becomes `role="group"` + `<ol>` with per-dot labels + an sr-only count. Override if you want to drop per-dot clickability and keep `progressbar`.
- **BC-5 — `Back to Open Actions` stand-in.** Until URL routing exists, the return path is an in-panel control, not the browser Back. (§10.)
- **BC-6 — Panel header run-state echo.** Beyond the directive, the panel repeats the run state in its own header (belt-and-suspenders for the covered-feed tension). Override if redundant.
- **BC-7 — `forced-color-adjust` scope.** Applied only to rail glyphs. Override if you prefer no forced-colors handling this pass.
- **BC-8 — `section` population deferred.** Primary highlight uses the requirement-ID path only; the heading-match upgrade is a core change (§10) and is not required.

---

## 9. Acceptance checks

### Component tests (vitest + jsdom + @testing-library — `web/src/**/*.test.tsx`)
- **`requirementAnchor.test.ts`** (new, pure):
  - `extractRequirementIds("… SS-09.a … ICD-E-01 …")` → `['SS-09.a','ICD-E-01']` (order preserved, deduped); `"SS-01"`, `"WI-1"`, `"MECH-01"` all match; `"SHA-256"` may match but…
  - `pickAnchorId(['SHA-256','SS-09.a'], contentWithoutEither)` → `null`; `pickAnchorId([...], contentWith('SS-09.a'))` → `'SS-09.a'` (false positives rejected by doc presence).
  - `findAnchorBlock(content, 'SS-09.a')` returns the block text + nearest preceding heading.
- **`applyAnchorHighlight`** (jsdom): render `<Markdown content={docWithId}/>` inside a container; assert the returned element is a block element containing the ID, gains `data-studio-anchor` + `animate-anchor-flash`, and (fake timers) loses them after the timeout; returns `null` for an absent ID.
- **`workflowState.test.ts`** (new, pure): table-driven — `{docStatus:'parked'}` → `error-parked`; `{docStatus:'auto-approved'}` → `approved` + `auto`; `{roadmapStatus:'COMPLETED'}` → `approved`; `{docExists:true, roadmapStatus:'PENDING_REVIEW'}` → `drafted`; `{docStatus:'drafting'}` → `in-progress`; `{roadmapStatus:'LOCKED'}` → `not-started` + `locked`; `{}` → `not-started`.
- **`runState.test.ts`** (new, pure): `deriveRunState` returns the 5 values for the documented input combinations.
- **`PhaseRail.test.tsx`** (new): renders 13 `<li>`; exactly one has `aria-current="step"`; each dot has an `aria-label` containing its phase name + state word; the legend lists all five state labels; clicking a dot calls the phase-select callback.
- **`RunStateCluster.test.tsx`** (new): each run state renders a **distinct icon + distinct word** (assert the word; assert the icon is not color-only by checking a `title`/label).
- **`QuestionPanel.test.tsx`** (extend existing): mounting in a left-pane wrapper keeps `role="region" aria-label="Questions from AI"`; `onFocusDocument` is called when a chip is clicked; the composer stays docked; minimize/close contracts unchanged.
- **`AppShell`/`TopBar`**: `<header>` contains brand + `role="tablist"` + the run-state cluster in **one** element; no second `border-b` nav row on `lg`. (Snapshot/DOM-query assertion; layout fit is a browser check.)
- **`DashboardView`**: a needs-input row calls `onOpenQuestion(item.id)` with the id (not just the tab).

### Live-browser checks (Playwright, dev server)
- **Split:** drag the divider; both panes clamp at ≥340px; `ArrowLeft/Right`/`Home`/`End` move it by keyboard; the ratio persists across reload; collapse/restore and Zen toggle work and `Esc` exits Zen.
- **Focused ratio:** opening a question animates the split to 40/60 once; the doc pane is **not** covered; the feed is `inert` while open.
- **Highlight:** click a question containing `SS-09.a` → the doc scrolls so the block is centered, it shows a ring + ID marker, fades after ~2.4s, and the live region announces the jump. A question with no in-doc ID → doc opens, no highlight, "No matching section found" + the fallback announcement.
- **Cover + run state:** with the run "working", open the panel → the feed is covered, the top bar still reads `Working… · {phase} · {step}`; minimize → feed returns **instantly** at its prior scroll position.
- **Rail:** approved shows a check, drafted an hourglass, not-started hollow, in-progress a spinner; keyboard-focusing a dot shows its label; the legend opens; clicking a dot selects that phase.
- **Top bar:** one bar at 1280/1024/900px; tabs overflow before the status cluster; the status cluster is never truncated.
- **Dashboard link:** click a needs-input row → tab switches to the studio, that question is active, the doc is scrolled+highlighted; `Back to Open Actions` returns to the Dashboard.
- **A11y sweep:** axe/no-contrast errors on the rail, run cluster, rows, and highlight marker; `prefers-reduced-motion: reduce` removes pulse/spin/slide and keeps the static outline on the highlight.

---

## 10. Risks + follow-ups

| Risk / follow-up | Detail | Mitigation / note |
|---|---|---|
| **No URL routing (follow-up)** | Dashboard → Studio deep links use tab state; browser Back does not return to the queue. Research: "the detail is a route." [34](https://completefrontend.com/system-design/problems/trello-jira) | State-based jump + in-panel `Back to Open Actions` (BC-5). Route work: `/studio?q={id}` when routing lands. |
| **`PortalItem.section` never populated (follow-up)** | The optional heading-match upgrade needs a core change: add `section?: string` to the `onQuestions` item type in `src/core/autopilot.ts` and pass it into `addPortalItem` (`PortalItemInput` already accepts it). | Primary ID path works without it; documented as BC-8. |
| **`docPath` casing mismatch** | Autopilot writes `docs/${phase.id.toUpperCase()}.md` (e.g. `RISK-REGISTER.md`) while `artifactPath` is `RISK_REGISTER.md`; the jump already matches by filename **suffix** in `selectPhaseByDocPath`, which is brittle for hyphen/underscore. | Keep suffix-match; add a normalization (`[-_]` → wildcard) in `selectPhaseByDocPath` if a mismatch is observed. |
| **Regex false positives** | `SHA-256`, `PDF-1.4`, `UTF-8`, `RS-485` can match the ID pattern. | `pickAnchorId` rejects any candidate not present in the doc → safe no-match, never a wrong highlight. |
| **`<lg` behavior** | The doc pane is `hidden lg:flex`; the split/divider/Zen don't apply below `lg`. The panel now covers the single chat pane full-width. | Follow-up: a full-page document overlay for `<lg` (Notion "full page" [43]); out of scope here. |
| **Poll vs SSE drift** | `AppShell`'s run-state REST poll (BC-1) can lag the SSE feed by up to 15s (e.g. "Waiting" shortly after a question arrives). | Acceptable: it is a coarse status; the panel + feed are instant. Tighten to 5s if it feels stale. |
| **Inbox affordances deferred** | Snooze / mark-all-read / server-persisted seen-state need a persistence contract. | Adopt only the count badge + J/K now; leave the rest to a follow-up tied to Area 1's persisted approval state. [2], [33] |
| **`inert` toggle moved** | The existing `docContentRef` inert effect must move to `feedScrollRef`; leaving both would make the doc uninteractive while answering. | Called out in §5.A; assert in the QuestionPanel test + the browser "feed covered / doc operable" check. |
| **Rail density** | 13 × 12px markers + glyphs is a dense target row. | Each dot is keyboard-focusable with a label; the summary-chip compaction (§5.G) is the narrow-pane path; legend carries meaning. |

### Follow-up queue (ordered)
1. URL routing for `?q={id}` deep links (Area 5's "detail is a route").
2. `PortalItem.section` population in the autopilot → heading-match highlight.
3. `ResponseSlot` ResizeObserver overflow (BC-2).
4. `<lg` full-page document overlay.
5. Inbox affordances: snooze, mark-all-read, persisted seen-state.

---

## Adopted sources (research brief, by area)

- **Area 1** — state visible at all times, persisted approval state machine: [1](https://jacar.es/en/ui-design-for-agents-principles-were-starting-to-understand/), [2](https://agentsurface.dev/docs/agentic-ui/session-control), [3](https://code.claude.com/docs/en/agent-sdk/user-input), [9](https://cursor.com/changelog/1-5).
- **Area 2** — bounded answer surface, pager + chip rail, docked composer, per-item drafts: [11](https://github.com/danny-avila/LibreChat/pull/14737), [12](https://github.com/poco-ai/Agentero/blob/8aa1ed0c/src/components/agent/ask-user-question-form.tsx), [13](https://www.nngroup.com/articles/progressive-disclosure/), [14](https://www.nngroup.com/articles/accordions-complex-content/).
- **Area 3** — multi-state progress indicator, shape+icon+text, `aria-current="step"`, legend: [15](https://m1.material.io/components/steppers.html), [16](https://atlassian.design/components/progress-tracker/usage), [17](https://carbondesignsystem.com/components/progress-indicator/usage/), [18](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph), [19](https://github.com/go-gitea/gitea/pull/37206), [20](https://www.w3.org/TR/WCAG22/), [21](https://www.w3.org/WAI/tutorials/forms/multi-page/), [22](https://www.w3.org/WAI/WCAG3/informative/layout/user-orientation/current-step-indicated/), [23](https://pluma.customer.io/components/stepper/accessibility).
- **Area 4** — merged single bar, priority slot, density: [24](https://www.sap.com/design-system/fiori-design-web/v1-71/foundations/integration-and-services/sap-fiori-launchpad/merged-header), [25](https://pustelto.com/blog/reverse-engineer-linear-1-header/), [26](https://www.mdui.org/en/design/1/layout/structure.html), [27](https://m3.material.io/components/toolbars/guidelines), [28](https://carbondesignsystem.com/components/data-table/usage/), [30](https://www.patternfly.org/components/toolbar/design-guidelines/).
- **Area 5** — task inbox, typed event rows, deep links, badge count: [31](https://linear.app/docs/inbox), [32](https://uxpatternsguide.com/patterns/activity-feed/), [33](https://completefrontend.com/system-design/problems/notifications-center), [34](https://completefrontend.com/system-design/problems/trello-jira), [35](https://drewdevault.com/blog/GitHub-notifications/).
- **Area 6** — two-pane readability, draggable clamped splitter, collapse/restore, focus mode: [36](https://m3.material.io/foundations/layout/breakpoints/large-extra-large), [37](https://uxpatternsguide.com/patterns/window-splitter/), [38](https://dialtone.dialpad.com/components/resizable.html), [39](https://wiki.r-that.com/components/split-pane-layout/), [40](https://create.tuvsud.com/latest/components/split-panel/usage-iRbgXMon), [41](https://developer.apple.com/design/human-interface-guidelines/split-views), [42](https://code.visualstudio.com/docs/getstarted/userinterface), [43](https://www.notion.com/releases/2022-07-20).

---

## Files this design would touch (for the worker, not this pass)

| File | Change |
|---|---|
| `web/src/views/DevelopmentView.tsx` | Left-pane panel mount; `feedScrollRef` inert swap; flex split root; `PaneSplitter`; highlight state + effect; `initialQuestionId`/`onFocusDocument`; drop-zone fold; doc-header rail cluster. |
| `web/src/components/QuestionPanel.tsx` | Header `Back to Open Actions` + run-state echo; emit `onFocusDocument(item)` on chip/pager/open; unchanged composer + state contract. |
| `web/src/components/QuestionBadge.tsx` | No behavior change (stays the left-pane trigger); optional `NeedsInput` count export for the nav tab. |
| `web/src/components/PhaseRail.tsx` | **New** — 5-state rail + legend + summary compaction. |
| `web/src/components/AutopilotHud.tsx` | Slim wrapper around `PhaseRail` + Start/Stop (moved to `h-8` buttons). |
| `web/src/components/PaneSplitter.tsx` | **New** — clamped, keyboard-resizable divider. |
| `web/src/components/RunStateCluster.tsx` | **New** — 4-state run indicator + phase + step. |
| `web/src/components/TopBar.tsx` | **New** — the merged 56px bar (brand · tabs · cluster). |
| `web/src/layouts/AppShell.tsx` | Render `TopBar`; lift `studioQuestionId`; autopilot status poll (BC-1); hub-tab needs-input badge. |
| `web/src/views/DashboardView.tsx` | Typed event rows grouped by phase/doc; `onOpenQuestion(id)`; J/K. |
| `web/src/lib/requirementAnchor.ts` | **New** — `extractRequirementIds` / `pickAnchorId` / `findAnchorBlock` / `applyAnchorHighlight`. |
| `web/src/lib/workflowState.ts` | **New** — `railStateFor` (5-state mapper). |
| `web/src/lib/runState.ts` | **New** — `deriveRunState`. |
| `web/src/index.css` | Add `anchor-flash` keyframe; extend the reduced-motion block. |

**Scope guard:** no `src/*` files change (except the optional, explicitly-deferred `section` population); the portal HTTP/SSE contract, `answerStates`, and `renderDetail` are untouched; `IssuesAndQuestionsView` untouched; no new dependencies.
