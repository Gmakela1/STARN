# Engineering Studio Workspace Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Engineering Studio into a measured, resizable two-pane workspace — question surface moved back to the left pane (covering the feed, with real run state in the top bar), a single merged top bar, an honest 5-state progress rail, requirement-ID doc highlighting on question focus, and Dashboard deep-links into the question queue.

**Architecture:** Presentation-layer only. Five workstreams with a full verification gate between each: (A) pure libs + the 5-state rail, (B) merged top bar + run-state cluster, (C) left-pane question surface + splitter + doc highlight, (D) Dashboard rows + deep link, (E) review + ship. Each workstream is independently testable and commits on its own.

**Tech Stack:** React 18, Tailwind 4 (existing token palette), lucide-react, vitest + jsdom + @testing-library (already configured in `web/vitest.config.ts`), Playwright for live checks.

**Spec:** `docs/superpowers/designs/2026-11-03-studio-workspace-restructure-design.md` (574 lines — read it first; §5.A–5.I are the directive-by-directive design, §8 builder calls, §9 acceptance checks, §10 risks). Research brief: `C:/Users/makel/.pi/agent/sessions/--C--Users-makel-vscode-STARN--/subagent-artifacts/c615153c-b49c-4e6a-9a5b-8b745089d074_researcher_output.md`.

## Global Constraints

- **Presentation only.** Work happens in `web/src/{components,views,layouts,lib}` + `web/src/index.css`. No `src/*` changes. The optional `PortalItem.section` population in `src/core/autopilot.ts` is **deferred** (design BC-8, §10 follow-up 2).
- **No new dependencies.** `ResizeObserver`, `matchMedia`, `localStorage` are browser APIs; icons come from the bundled `lucide-react`.
- **Tokens only, no new hexes.** `slate/sky/cyan/amber/rose/emerald` as already used. Reuse existing keyframes; add exactly **one** (`anchor-flash`) and wire it into the existing `prefers-reduced-motion` block.
- **Never color alone** (WCAG 2.2 SC 1.3.3): every state carries shape + icon + text label.
- **No second scroll region in the chat pane.** The panel *replaces* the feed in place; minimize restores it.
- **State contracts preserved:** `surface`/`dismissedIds` stay lifted in `DevelopmentView`; `activeId`/`drafts`/`showFull`/`retryText`/8s dwell stay panel-local; close unmounts+resets, minimize freezes. `answerStates` handoff unchanged. `renderDetail` unchanged.
- **TDD per task:** failing test first → minimal implementation → workstream gate.
- **Gate for every workstream:** `npm --prefix web run test` green · `npm --prefix web run build` clean · `npx tsc --noEmit` clean.
- **TOOLS for workers:** read + edit/write + bash (npm/vitest/tsc only). NO python, NO sed extraction scripts, NO `/tmp`, NO npm install.

## Review Focus

1. **Inert swap correctness (design §5.A):** while `surface === 'open'`, the **feed** is `inert` + `aria-hidden` and the **document stays fully operable** — the exact inverse of the current behavior (today the doc is inert). Getting this backwards silently breaks the core "read the doc while answering" goal.
2. **Handler contract preservation:** `QuestionPanel`'s existing props/behaviors (composer, Escape dirty-guard, advance-on-vanish, dwell, dismiss rollback, `onExpand`/`onMinimize`/`onClose`) must not regress while adding `onFocusDocument`, `Back to Open Actions`, and the run-state echo. The existing 15 panel tests must stay green.
3. **Highlight safety (design §5.C):** false-positive IDs (`SHA-256`, `PDF-1.4`, `RS-485`) must degrade to "no highlight" via doc-presence checking — never scroll to a wrong block. Highlight must never steal focus and must clear on edit-mode/doc-change/unmount.
4. **Rail state precedence (design §5.F):** the mapping table's precedence order must be implemented literally, so a doc is never ambiguous (e.g. `parked` beats `passed`; `COMPLETED` beats `docExists`).
5. **No chat-pane regressions:** the feed keeps its scroll position across open/minimize; `Ctrl+.`, Escape ownership, Alt-hold recording, and the live-region announcements all survive the layout move.

---

## Workstream A — Pure libs + 5-state rail (no layout risk)

### A1. `web/src/lib/workflowState.ts` — rail state mapper

```ts
export type RailState = 'not-started' | 'in-progress' | 'drafted' | 'approved' | 'error-parked';
export interface PhaseRailView { state: RailState; auto: boolean; locked: boolean; label: string; }
export function railStateFor(input: { docStatus?: string; roadmapStatus?: string; docExists?: boolean }): PhaseRailView;
```
Precedence (literal, design §5.F): `parked` → error-parked; `drafting|critic|revising` → in-progress; `auto-approved|passed` or roadmap `COMPLETED` → approved (+`auto` flag for `auto-approved`); `docExists` or `PENDING_REVIEW` → drafted; roadmap `IN_PROGRESS` → in-progress; `LOCKED` → not-started(+`locked`); else not-started.

**Test first:** `web/src/lib/workflowState.test.ts` — table-driven over every row of the design's mapping table plus precedence conflicts (`parked`+`COMPLETED` → error-parked).

### A2. `web/src/lib/runState.ts` — run-state derivation

```ts
export type RunState = 'ready' | 'working' | 'waiting' | 'finished' | 'failed';
export function deriveRunState(i: { busy: boolean; checkpoint: boolean; autopilotRunning: boolean; openQuestions: number; blocks: number; lastError?: string | null; passedCount: number }): RunState;
```
Order (design §5.H): `blocks>0 || lastError` → failed; `busy || (autopilotRunning && !waiting)` → working; `checkpoint || (autopilotRunning && openQuestions>0)` → waiting; `!busy && !running && passedCount>0 && no open questions/blocks` → finished; default → ready.

**Test first:** `web/src/lib/runState.test.ts` — every documented combination, including the waiting-over-working precedence when both are plausible.

### A3. `web/src/lib/requirementAnchor.ts` — doc anchor helpers

```ts
const REQ_RE = /\b[A-Z]{2,6}(?:-[A-Z0-9]{1,4})?-\d{1,3}(?:\.[a-z0-9]{1,3})?\b/g;
export function extractRequirementIds(text: string): string[];              // ordered, deduped
export function pickAnchorId(ids: string[], docContent: string): string | null; // first id present in doc
export function findAnchorBlock(content: string, id: string): { blockText: string; headingText: string | null } | null;
export function applyAnchorHighlight(root: HTMLElement, id: string, ms?: number): HTMLElement | null;
```
- `findAnchorBlock`: split content on blank lines; find the block containing `id`; walk up to the nearest preceding `/^#{1,6}\s/` heading.
- `applyAnchorHighlight`: search `root` block elements (`H1..H6,P,LI,TD,TR`) for the closest one whose `textContent` contains `id` (never the whole `.doc-prose` div); `scrollIntoView({ block:'center', behavior: reduced ? 'auto' : 'smooth' })`; set `data-studio-anchor`, add `animate-anchor-flash` + `ring-2 ring-sky-400/70 ring-offset-2 ring-offset-slate-950`; insert a transient ID marker span; auto-remove after `ms` (default 2400). Return the element or `null`.

**Test first:** `web/src/lib/requirementAnchor.test.ts` — ID extraction order/dedupe across `SS-01`/`SS-09.a`/`ICD-E-01`/`WI-1`/`MECH-01`; `pickAnchorId` rejects `SHA-256` when absent and accepts `SS-09.a` when present; `findAnchorBlock` returns text + nearest heading; jsdom test rendering `<Markdown>` asserting the highlighted element gains/loses the attributes (fake timers) and `null` for an absent ID.

### A4. `web/src/components/PhaseRail.tsx` + slim `AutopilotHud.tsx`

New `PhaseRail`: `<ol role="list">` with one focusable `<button>` per phase (`h-5 w-5` target, marker `h-3 w-3` by state, lucide glyph per the design table: `Circle` / `Loader2` motion-safe spin / `Hourglass` / `Check` / `CircleSlash2`), `aria-label="{phaseName} — {label}"`, `aria-current="step"` only on in-progress, `role="group" aria-label="Build phases"` wrapper + sr-only "n of 13 approved", a `Legend` toggle popover listing all five states, and a summary-chip compaction when narrow (`[check] 6/13 · {phase}`). Clicking a dot selects that phase.
`AutopilotHud` becomes the thin wrapper: `PhaseRail` + `Start Auto-Drafting`/`Stop` as `h-8` buttons (dead `Drafting: {name}` text removed).

**Test first:** `web/src/components/PhaseRail.test.tsx` — 13 items rendered; exactly one `aria-current="step"`; each dot's `aria-label` contains phase name + state word; legend lists all five labels; clicking a dot calls the select callback.

### A5. Workstream A gate

- [ ] `npm --prefix web run test` — all green (existing 39 + new)
- [ ] `npm --prefix web run build` clean · `npx tsc --noEmit` clean
- [ ] Commit: `feat(web): 5-state phase rail + workflow/run/anchor pure libs`

---

## Workstream B — Merged top bar + run-state cluster

### B1. `web/src/components/RunStateCluster.tsx`

Renders `[icon][label] · [phase chip] · [step]` from `RunState` (design §5.H table): Working (`Loader2` spin, cyan), Waiting (`MessageSquare`, amber), Finished (`CheckCircle2`, emerald), Failed (`TriangleAlert`, rose), Ready (dot, emerald). Distinct icon **and** word per state; label `text-xs font-semibold`; phase as mono chip; step `max-w-[180px] truncate` from `turnStream.status`/newest activity.

**Test first:** `web/src/components/RunStateCluster.test.tsx` — each state renders its distinct word; the icon is not the only differentiator (assert label text + a `title`/`aria-label`).

### B2. `web/src/components/TopBar.tsx` (new) + `AppShell.tsx` rewire

One `<header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 backdrop-blur-md">` containing, in order: brand+project (shrink-0) · `role="tablist"` nav tabs (min-w-0 flex-1, icon+label, tagline → `title`+`aria-label`) · status cluster (shrink-0, always visible: `RunStateCluster` + active-phase badge + `Reconnecting…` when disconnected).
`AppShell`: remove the second `<nav>` row (keep the `<lg` mobile drawer), add the `Needs Input {n}` count badge on the Engineering Studio tab, add the autopilot status REST poll (design BC-1: `api.fetchAutopilotStatus()`, 15s) to source `running`/`blocks`/`passedCount`, lift `studioQuestionId` state + pass `initialQuestionId` to `DevelopmentView`.

**Test first:** `web/src/components/TopBar.test.tsx` — a single `<header>` contains brand + `role="tablist"` + the run-state cluster; exactly one `border-b` nav row at `lg` (i.e. no separate nav element); the cluster is never inside the overflow container.

### B3. Workstream B gate

- [ ] Web tests all green (incl. existing AppShell-adjacent tests) · build clean · tsc clean
- [ ] Commit: `feat(web): merged 56px top bar with run-state cluster`

---

## Workstream C — Left-pane question surface + splitter + doc highlight

### C1. `web/src/components/PaneSplitter.tsx`

`role="separator" aria-orientation="vertical"`, `aria-valuenow={leftPct}` + min/max, `tabIndex={0}`, pointer-drag with capture and clamping (`MIN=340px` expressed as %, `MAX=100-MIN%`), keyboard `ArrowLeft/Right` ±2% / `Home`→MIN / `End`→MAX, visual `h-8 w-0.5` grip. Emits `onChange(leftPct)`.

**Test first:** `web/src/components/PaneSplitter.test.tsx` — keyboard arrows change the value by 2%; Home/End clamp to MIN/MAX; the separator exposes the documented ARIA roles/values.

### C2. `DevelopmentView.tsx` — layout move + highlight + chrome reclaim

Per design §5.A/§5.B/§5.C/§5.I:
- Root: `grid … lg:grid-cols-2` → `flex h-full min-h-0` with `flexBasis: leftPct%` panes, both `min-w-[340px] max-w-[calc(100%-340px)]`, `PaneSplitter` between, `leftPct` persisted to `localStorage['starn.studio.splitPct']`.
- Move `<QuestionPanel>` from the right doc section into the **left** section (after the feed, sibling of badge + footer); make the left section `relative`.
- **Inert swap:** the existing `docContentRef` inert/aria-hidden effect moves to `feedScrollRef` (feed inert when open; doc never inert).
- Highlight state + effect: `highlight` state; on `onFocusDocument(item)` → extract/pick ID → `selectPhaseByDocPath` if the doc differs → wait for `selectedDocName` → `applyAnchorHighlight` → announce jump/no-match; clear on edit-mode/doc-change/unmount.
- Drop-zone fold: remove the strip; add a `Paperclip h-8 w-8` header button; `uploadNotice` renders only when set.
- Doc header becomes one `h-12` row: selector + `AutopilotHud`(PhaseRail) + Refresh/Paperclip/Edit/Approve + collapse/Zen buttons.
- Focus-first ratio: on the first question focus, animate `leftPct` to 40 (reduced-motion: jump).
- Collapse/restore + Zen per pane (design §5.I).
- `initialQuestionId` one-shot effect (with `AppShell`): open panel, set activeId, focus doc.

### C3. `QuestionPanel.tsx` — additive props

Add `onFocusDocument: (item: PortalItem) => void` (emit on chip/pager click and on open-onto-item), `onBackToQueue?: () => void` (`ArrowLeft` + `Back to Open Actions` in the header), and the compact run-state echo in the header (reusing `RunState`). **No changes** to the composer, Escape, dwell, dismiss rollback, advance-on-vanish, `onExpand`/`onMinimize`/`onClose`.

**Test first:** extend `web/src/components/QuestionPanel.test.tsx` — `onFocusDocument` fires with the item on chip click; the panel keeps `role="region" aria-label="Questions from AI"` when mounted in a left-pane wrapper; the composer stays docked; all 15 existing tests stay green.

### C4. Workstream C gate

- [ ] Web tests all green (existing 39 + A/B/C additions) · build clean · tsc clean
- [ ] `grep -n "feedScrollRef" web/src/views/DevelopmentView.tsx` shows the inert swap; `grep -c "docContentRef.*inert" …` == 0
- [ ] Commit: `feat(web): left-pane question surface, resizable panes, doc-id highlighting`

---

## Workstream D — Dashboard rows + deep link

### D1. `DashboardView.tsx`

`renderActionPane` rows become typed event rows (design §5.E): whole-row `<button className="flex w-full items-start gap-2.5 px-3 py-2 text-left …">`; line 1 `STARN · needs input · {basename(docPath)}` (`text-[11px] font-mono text-slate-500`); line 2 `truncate text-sm text-slate-200` title; right: relative timestamp + `ArrowRight h-3 w-3`. Rows call `onOpenQuestion(item.id)`; tier headers/counts unchanged; J/K moves between rows (guarded for inputs).

**Test first:** `web/src/views/DashboardView.test.tsx` — a needs-input row click calls `onOpenQuestion` with the item id (not just a tab name); rows render the doc provenance + a timestamp.

### D2. Deep-link round trip

`AppShell` → `DevelopmentView initialQuestionId` → panel opens with that item active + doc highlighted (C2/C3). `QuestionPanel`'s `Back to Open Actions` calls `onNavigate('dashboard')`.

**Test first:** covered by C3's `onBackToQueue` assertion + a live browser check.

### D3. Workstream D gate

- [ ] Web tests all green · build clean · tsc clean
- [ ] Commit: `feat(web): dashboard needs-input rows deep-link into the question panel`

---

## Workstream E — Review, verify, ship

### E1. Live browser verification (Playwright, dev server on the tractor project)
Per design §9 live checks: splitter drag + keyboard + persist; focused 40/60 + feed inert while doc operable; highlight scroll/ring/ID marker/fade + no-match fallback; cover + run-state bar; rail glyphs (check/hourglass/hollow/spinner) + legend + dot click; one bar at 1280/1024/900; dashboard row → studio jump → `Back to Open Actions`; reduced-motion sweep.

### E2. Critic + security review of the full diff
Dispatch `critic` (design fidelity §5.A–5.I, spec compliance, simplifier rubric) and `security` (new DOM helpers — `applyAnchorHighlight` writes DOM/attributes; regex input from LLM text; deep-link id handling; localStorage) in parallel. Fix findings, re-verify.

### E3. Final gate + ship

- [ ] `npx tsc --noEmit` && `npm test` && `npm --prefix web run test` && `npm --prefix web run build` all green
- [ ] `git log --oneline` — 4 workstream commits + any review fixes
- [ ] Push to `origin/master`

## Follow-ups (not in this plan — design §10)
1. URL routing (`/studio?q={id}`) replacing the state-based deep link.
2. `PortalItem.section` population in `src/core/autopilot.ts` → heading-match highlight.
3. `ResponsiveSlot` ResizeObserver overflow for the top bar (BC-2).
4. `<lg` full-page document overlay.
5. Inbox affordances: snooze, mark-all-read, persisted seen-state.
