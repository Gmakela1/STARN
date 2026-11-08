# Autopilot Generation + Question Portal — Design

**Date:** 2026-10-24
**Status:** Approved after builder-check (2026-10-24)
**Research anchors:**
- Code-map: `subagent-artifacts/4647c03d-19a6-455f-b273-f73ab05edc7f_researcher_output.md`
- UX brief: `subagent-artifacts/f5936d24-c732-4d04-958d-eff11022a856_ui-ux-specialist_output.md`
- Prior dashboard brief (style anchor): `subagent-artifacts/70aaf54f-22c3-482c-b555-8a4817a359e1_ui-ux-specialist_output.md`

## 1. Problem Statement

STARN's specialist chain (CONOPS → Architecture → ICD → Capabilities → Requirements
→ BOM → RTM → Milestones → Risk Register → Build Sequence → Work Instructions →
Test Plans → SOW) is strictly human-initiated: after every critic-gated draft the
user must approve and type the next request. There is no mid-turn channel for the
AI to surface its open questions to the user, no persisted store unifying
"needs-you" items (AI questions, critic-parked docs, shop-floor flags), and no
way to run the whole chain hands-off.

**Goal:** a master Autopilot toggle that runs the chain with minimal human
interference, plus a Question Portal — a persisted, queryable store of open
items, surfaced as (a) a live question bar in Engineering Studio, (b) a ranked
action pane on the Dashboard, and (c) per-line comment/flag capture on the Shop
Floor — where answering a question edits the originating document in place and
auto-runs change-impact analysis to re-draft only affected downstream docs.

**Product decisions (user-confirmed 2026-10-24):**
1. **Critic gate in autopilot:** up to 2 auto-revisions; on fail, the doc is
   **parked** — stop, flag the user with the critic's explanation + gap
   questions. User closes the gap; the doc re-drafts, passes, and autopilot
   resumes.
2. **Answer routing:** in-place edit on the originating doc + immediate
   change-impact analysis by the existing specialist; **only** affected
   downstream docs are re-drafted.
3. **Guardrails (post-MVP slot):** per-doc token budget with model-based cost
   estimate, user-configurable in Settings. The layout slot ships disabled
   (dashed border, non-interactive); the budget itself is deferred.

## 2. Architecture Principles (from AGENTS.md, non-negotiable)

- **I/O-agnostic core:** the autopilot driver, portal store, approval helper, and
  question routing live in `src/core/` and `src/workspace/`. `core/*` must not
  import `cli/*` or `server/*`.
- **Harsh critic stays mandatory:** autopilot never skips or weakens the critic
  gate; it only changes what happens after it.
- **Strict tool scoping preserved:** change-impact remains read-only; autopilot
  re-drafts run through the normal specialist tool loop.
- **No silent fallback, no unrequested subsystems:** the driver reuses existing
  providers/clients exactly as a human-initiated turn would.

## 3. Platform-truths from Research (constraints)

| # | Finding | Design consequence |
|---|---------|-------------------|
| R1 | No auto-queue exists: approval only relabels activePhase; next turn is always user-initiated (`state.ts:377`, callers in `index.ts`/`session.ts`) | Autopilot driver is a NEW core module that synthesizes the next phase prompt and calls `executeTurn` again |
| R2 | Approval + disk-write + `recordArtifact` + `advanceToNextPhase` + re-approval hash detection live in **adapters** (`cli/checkpoint.ts:139-196`, `server/session.ts:285-317`) | Extract a shared `src/core/approvals.ts` helper; adapters + driver all call it |
| R3 | Web approval skips change-impact; CLI approval auto-runs it (`checkpoint.ts:185-227`). Asymmetry | `approvals.ts` runs change-impact on content change for BOTH surfaces (fixes the asymmetry) |
| R4 | No mid-turn question channel: SSE events are only `status\|tool_call\|checkpoint\|complete\|error` (`session.ts:226-249`) | Add `question` + `autopilot` SSE events; driver emits via an adapter callback interface |
| R5 | No unified store: `recentActions: string[]` (capped 50), `pendingRisks`, in-memory web checkpoint, computed issues parser all separate | New persisted `portalItems[]` on `ProjectState` is the canonical store; issues parser stays for legacy display |
| R6 | Open questions today are **computed** (parsed live from `docs/*.md`); never stored | Autopilot questions are STORED in portalItems; doc Section-6 parsing remains the canonical doc-side format |
| R7 | CLI has pre-turn `collectOpenQuestions` + USER ANSWERS block (`index.ts:563-592`); web has none | Server-side "answer application" reuses the same prompt-block pattern via a follow-up `executeTurn` |
| R8 | TestPlans web view does not exist; WI step comments do not exist | Shop-floor flag/comment work builds new per-line affordances; TestPlans flag UI is deferred with the view |
| R9 | Critic loop already caps at `maxAttempts = 2` (`runner.ts:382`) | Autopilot depends on this; needs a persisted "criticFailed" signal on the result to park |

## 4. Data Model

### 4.0 Migration (new — REQUIRED, from builder-check #5)

`portalItems` and `autopilot` are **optional** on `ProjectState`; `getOrCreateState()`
and `getState()` (state.ts ~195-245 pattern, like `migrateLegacyRisks` ~322)
initialize on load when absent: `state.portalItems ??= []`,
`state.autopilot ??= defaultAutopilotState()`, set `changed=true` so the defaults
persist. No data rewriting of existing keys. Web/dashboard code must tolerate
missing fields via the same `??` defaults.

### 4.1 `portalItems[]` — persisted on `ProjectState` (new)

```ts
type PortalItemType =
  | 'question'      // AI-generated gap during drafting (autopilot or manual)
  | 'parked'        // doc parked after 2 failed critic revisions
  | 'flag'          // shop-floor flag: WI line comment/flag or (later) test-plan out-of-spec
  | 'nonconformance' // legacy: migrated from pendingRisks/parsed issues (optional)

type PortalItemSeverity = 'blocking' | 'normal';

interface PortalItem {
  id: string;                    // ulid/short-uuid
  type: PortalItemType;
  severity: PortalItemSeverity;  // default 'normal'
  docPath?: string;              // docs/{PHASE}.md
  section?: string;              // '## Open Questions' | specific WI step id | line ref
  title: string;                 // one-line question / issue summary
  detail?: string;               // full question context / critic explanation
  gaps?: string[];               // parked: structured gap list from critic
  threadId?: string;             // counter-question threading
  status: 'open' | 'answered' | 'dismissed' | 'resolved';
  answer?: string;
  source: 'autopilot' | 'studio' | 'shop-floor';
  createdAt: string;             // ISO
  updatedAt: string;
  meta?: Record<string, unknown>; // e.g. {criticPassed, revisions, affectedDocs[]}
}
```

Cap: keep all items (cheap JSON); the dashboard pane shows top-N with scroll.
Answered items are not deleted — they form the resolved trail.

### 4.2 Autopilot run state (persisted, small)

```ts
interface AutopilotState {
  running: boolean;           // false if stopped/parked/idle
  startedAt?: string;
  stoppedAt?: string;
  currentPhaseId?: string;
  docStatus: Record<string,  // phase id
    | 'idle' | 'drafting' | 'critic' | 'revising' | 'passed' | 'parked'>;
  revisionsUsed: Record<string, number>;
  blocks: number;             // parked docs count
  lastError?: string;
}
```

Stored inside `ProjectState.autopilot`. Config-level master toggle lives in
`~/.starn/config.json` (`autopilot.enabled`, env `STARN_AUTOPILOT_ENABLED`
override — clones the `transcriptionEnabled` pattern). **Run state is
per-project; the toggle is global.**

### 4.3 Changes to existing models

- `web/src/types/api.ts`: `TurnEvent` gains `{type:'question', item: PortalItem}`
  and `{type:'autopilot', status: AutopilotState}`. `Settings`/`SettingsUpdate`
  gain `autopilotEnabled: boolean`. New `PortalItem`, `AutopilotState`,
  `AutopilotStatusResponse` types. Dashboard payload gains `portal` summary.
- `WorkInstruction` (parsers): optional `StepAnnotations[]` = `{stepId, comments:
  {author, text, at}[], flagged: boolean}` — persisted with the checklist
  (action store), not in the markdown doc.
- `TurnResult` gains optional `criticFailed?: boolean` — set true when the
  critic loop exhausted `maxAttempts=2` without passing (builder-check #12:
  detectable today via `!criticResult.passed && autoRevisionsRun>=2`, but the
  explicit field makes the driver less fragile).
- `TurnOptions` gains `forceSpecialistId?: string` (driver/answer-applier bypass
  the LLM classifier, builder-check #6) and `onQuestions?: (items:
  PortalItem[]) => void` (see §6.1 timing).

## 5. Core Modules (new files, all I/O-agnostic)

### 5.1 `src/core/approvals.ts`

Shared approval primitive extracted from adapter code:

```ts
interface ApproveArtifactInput {
  projectPath: string;
  stateManager: ProjectStateManager;
  specialistId: string;
  content: string;                 // full doc text to write
  runChangeImpact?: (phaseId: string) => Promise<string[]>; // returns affected phase ids
}
interface ApproveResult { changedSinceApproval: boolean; affectedDocs: string[]; }
async function approveArtifact(input: ApproveArtifactInput): Promise<ApproveResult>;
```

Behavior:
1. Detect `wasPreviouslyApproved` + `hasContentChangedSinceApproval` (moves the
   hash-comparison currently at `checkpoint.ts:185-199` into core).
2. Write doc to disk, `stateManager.recordArtifact` (hash stored), advance phase.
3. If content changed → run change-impact via the existing package
   (`changeResource` machinery from `checkpoint.ts:185-227` extracted), return
   affected docs.
4. **Design Decision harvesting** (builder-check #10): run `harvestDecisionLog`
   (currently CLI-only, `checkpoint.ts:208-213`) inside `approveArtifact` so ALL
   approval paths — CLI checkpoint, web resolveCheckpoint, web
   `/api/docs/:id/approve`, autopilot — preserve DECISIONS.md extraction.
5. Never writes files for change-impact itself (package is read-only by design).

**Fourth approval path (builder-check #7):** `router.ts` `/api/docs/:id/approve`
currently calls `stateManager.manualApproveArtifact()` (no disk write, no
re-approval hash check, no change-impact, no phase advance). Replace that
handler's logic with `approveArtifact` too (doc content read from disk, hash
detection, change-impact run). `manualApproveArtifact` stays in state.ts for
internal use but no longer defines the web approve path.

Both CLI checkpoint, web `resolveCheckpoint`, web `/api/docs/:id/approve`, and
the autopilot driver call this. Web approval thus gains change-impact parity (R3).

### 5.2 `src/core/question-portal.ts`

Synchronous store operations over `ProjectStateManager` + validation:
`addPortalItem`, `answerPortalItem(id, answer)`, `dismissPortalItem(id)`,
`listPortalItems({status, type, phaseId})`, `resolveAnswerThread(id)`.
Idempotent by `id`; appends to `state.portalItems` with cap 500 (then archival
flag). This file is pure state logic — no I/O beyond `stateManager`.

### 5.3 `src/core/autopilot.ts` — the driver

```ts
export interface AutopilotDeps {
  stateManager: ProjectStateManager;
  projectPath: string;
  executeTurn: (opts: Partial<TurnOptions> & Pick<TurnOptions,'userPrompt'>) => Promise<TurnResult>;
  onEvent?: (ev: AutopilotEvent) => void;   // adapter callback → SSE
  signal?: AbortSignal;
}
export type AutopilotEvent =
  | { kind: 'start'; total: number }
  | { kind: 'phase'; phaseId: string; status: docStatus } // drafting/critic/revising/passed/parked
  | { kind: 'question'; item: PortalItem }
  | { kind: 'parked'; item: PortalItem }   // hard stop
  | { kind: 'complete'; result: AutopilotResult }
  | { kind: 'error'; message: string };
```

Driver loop (one phase per `runPhase` iteration, yielding to the event loop):
0. **Unified turn guard (builder-check #2):** the session adapter exposes
   `beginTurn()/endTurn()` (extracted from `runTurn`'s `activeAbort`/busy
   guard, session.ts ~195-254). Autopilot and interactive turns both acquire
   it; a second concurrent turn is rejected with 409. The driver holds it for
   the whole run and sets `activeAbort` from the driver's stop signal.
1. Read state → `ORDERED_WORKFLOW_PHASES` (13) → find first unapproved phase
   (skipping phases whose prereqs are unmet; honoring transitive re-locks).
2. Synthesize the phase prompt and call `executeTurn` with
   **`forceSpecialistId: phaseId`** (bypasses the LLM classifier — builder-check
   #6; the classifier's keyword fallback stays as a safety net for manual
   turns). Per-role clients already wired through the `executeTurn` closure.
3. After the turn:
   - Open questions in the fresh doc → `question-portal.addPortalItem` per
     question (non-blocking, source 'autopilot'), emit `question`. Continue.
   - `requiresReview` + critic pass → `approveArtifact` (auto-approve), emit
     `phase passed`, advance.
   - `requiresReview` + critic fail (2 revisions exhausted) → create
     `parked` item (critic explanation + gaps), update docStatus 'parked',
     emit `parked`, **stop the run** (R9). User action required before resume.
   - Abort signal → persist partial state, `docStatus current='idle'`, stop.
4. Persist `autopilot` run state after every phase (`stateManager.saveState`).
5. End state: all 13 passed → `complete`.

Resume semantics: `resume(docId?)` — if a parked item's `docId` is given, run a
targeted follow-up turn with the USER ANSWERS block + critic context appended
(escalating quality), then `passed` → continue the chain from the next phase.
Stop semantics: graceful — abort in-flight turn at the tool boundary, persist,
leave the current doc in its last-saved editor state.

Counter-question flow: an answer's follow-up turn may emit a NEW `question`
item on the same `threadId` (the AI judges the answer insufficient). The run
continues; only `blocking`-severity items pause it. (User decision: "The AI
could ask additional questions to that question if the answer wasn't really
that good.")

### 5.4 `src/core/answer-applier.ts`

Given `(portalItem, answerText)`:
1. Build the USER ANSWERS prompt block exactly as CLI does (`index.ts:582`):
   `USER ANSWERS TO OPEN QUESTIONS (incorporate per your instructions):` +
   `Q{n}. {title}\nAnswer: {answer}`.
2. `executeTurn` with **`forceSpecialistId: item.docPath→phaseId`** and
   `activePhase` set explicitly (builder-check #4: do NOT rely on the
   in-memory static `lastActiveSpecialistId`, which resets on restart and is
   shared across projects). The classifier's phase-lock fallback then never
   misfires; `existingBaselineText` already carries the in-place-edit Section-6
   instruction (`runner.ts:272-276`).
3. On `requiresReview` and critic pass → `approveArtifact` with
   `runChangeImpact` (user decision #2) → the returned `affectedDocs` become
   queued re-drafts (autopilot) or a surfaced "apply to N downstream docs"
   proposal (manual mode).
4. Resolve the thread: mark item `answered`, close any child counter-questions
   with a resolved link.

## 6. Server Surface (`src/server/`)

### 6.1 SSE / turn plumbing (`session.ts`, `router.ts`)

**Transport (builder-check #1):** autopilot runs fire-and-forget, so the
short-lived `/api/turns` SSE connection is NOT the channel. Specified design:
- Server: `ServerSessionManager` holds a small subscriber list (EventEmitter
  pattern). Every driver/portal event (`question`, `autopilot`, `parked`,
  `complete`) is published to subscribers AND persisted.
- New endpoint `GET /api/autopilot/events` — long-lived SSE stream: on connect
  it registers the response as a subscriber, replays the last N events
  (backfill so late joiners see current run state), and stays open until the
  browser disconnects (`req.on('close')` unsubscribe, same pattern as
  `/api/turns` reconnect).
- Fallback: `GET /api/autopilot` + `GET /api/portal` poll every 3s while the
  HUD/questions pane is mounted (belt-and-suspenders for flaky streams;
  cheap — state.json reads).
- Browser: new `useAutopilotEvents()` hook wraps fetch-SSE with auto-reconnect;
  feeds both the AutopilotHud and QuestionBar. `useTurnStream.ts`
  `handleEvent` switch gains explicit cases for `'question'` and `'autopilot'`
  (unknown events still ignored, but known ones update hud/portal state —
  builder-check #1, second half).

**TurnOptions hooks (builder-check #3):** `onQuestions` fires **once per
specialist turn, after the tool loop AND any critic auto-revisions settle and
before the result is returned** — i.e. questions are parsed from the FINAL
draft content (initial loop + up to 2 revisions), never from mid-loop partial
text. It fires for both manual and autopilot turns (manual turns get the
question bar too — the "questions anywhere" ask). `forceSpecialistId` is set
by the driver/answer-applier only; manual classification stays unchanged.

- `runTurn` gains an optional `autopilotContext?: {enabled, onEvent}` wrapper;
  when the driver runs, its `onEvent` callbacks publish to the subscriber
  list (SSE events `question`/`autopilot`/`parked`/`complete`).
- `CoreRunner.executeTurn` is unchanged except the `TurnOptions` fields above
  (`forceSpecialistId`, `onQuestions`, existing `signal`).

### 6.2 New endpoints (`router.ts`)

| Method+Path | Handler | Purpose |
|---|---|---|
| `GET /api/autopilot` | `getAutopilotStatus(deps)` | `{enabled, running, docStatus, blocks, currentPhaseId}` |
| `POST /api/autopilot/start` | session.`autopilotStart()` | spawn driver loop (fire-and-forget with SSE events) |
| `POST /api/autopilot/stop` | session.`autopilotStop()` | abort signal → graceful stop |
| `POST /api/autopilot/resume` | body `{docId?}` | resume after parked / manual stop |
| `GET /api/portal` | list portal items (`?status=&type=&phase=`) | question bar + dashboard pane data |
| `POST /api/portal/:id/answer` | `answerApplier` | apply answer → in-place edit → change-impact → queue re-drafts |
| `POST /api/portal/:id/dismiss` | mark dismissed | user says "not needed" |
| `POST /api/actions/:id/comments` | persist step comment | WI line comment (new) |
| `POST /api/actions/:id/flags` | toggle step flag → portalItem 'flag' | WI line flag → dashboard |

**Client parity (builder-check #8):** every endpoint above gets a matching
method on `web/src/api/client.ts`: `fetchAutopilotStatus`, `autopilotStart`,
`autopilotStop`, `autopilotResume`, `fetchPortalItems`, `submitPortalAnswer`,
`dismissPortalItem`, `postActionComment`, `toggleActionFlag`.

Settings: `PUT /api/settings` accepts `autopilotEnabled` (extend
`RouterDeps.onSettingsSaved` payload + `persistModelSettings` in `index.ts`
writes `autopilot: { enabled }`; runtime plumb `config.autopilotEnabled` →
`session.autopilotEnabled` → exposed via `buildSettings`).

### 6.3 Session manager (`session.ts`)

- `ServerSessionManager` stores the run driver + abort controller per session;
  `autopilotStart` refuses when a human turn is in flight and vice-versa
  (shared `beginTurn`/`endTurn` guard, single-flight rule).
- `runTurn` and autopilot turns serialize through the same guard; roadmap
  cancels/`busy` states stay consistent. Autopilot checkpoint `pending` is
  resolved automatically (auto-approve path) so the UI never shows a
  checkpoint panel mid-autopilot except parked.

## 7. Web UI (`web/src/`)

All new components follow the Warm Precision tokens from the UX brief
(bg `#0b0f17`, cyan `#06b6d4`, focus ring `0 0 0 2px #0b0f17, 0 0 0 4px #06b6d4`).

### 7.1 `QuestionBar` (new, `web/src/components/QuestionBar.tsx`)

Mounted in `DevelopmentView.tsx` **between the chat-end anchor (~line 284) and
the input footer (~line 288)** — exactly per the UX brief placement diagram.
- Hidden entirely when zero open items (zero space, not collapsed).
- Collapsed badge: `◈ N pending AI questions [Show ▾]`, `bg-slate-900/80`,
  `border-l-2 border-cyan-500`. `aria-expanded`, `Ctrl+.` focuses first open
  question (tooltip on badge).
- Expanded: stacked cards, max 4 visible + "N more" (scroll). Card states:
  `pending` (`border-amber-500` "AI needs input") vs `parked` (`border-rose-500`
  "Critic blocked — needs review", links existing `CriticScorecard` + gap list,
  `[Resolve & Resume] [Edit Manually]`).
- Answer interaction: inline textarea (Enter submits, Shift+Enter newline),
  Submit → `api.submitPortalAnswer(id, text)`; answered card fades to
  slate-600 w/ check for 8s then slides out (resolved trail), `RotateCcw` undo
  for 3s. Follow-up AI counter-question arrives as a new card under the same
  thread.
- Mobile: FAB bottom-right `bg-cyan-600 w-12 h-12 rounded-full` w/ count badge
  → bottom sheet list.
- `aria-live="polite"` region announces new questions.

### 7.2 `AutopilotHud` (new) — toggle + progress + parked card

- Toggle pill in two places: Dashboard header row (next to Export button) and
  Studio doc-toolbar right side: `[Autopilot: OFF]` / `[Autopilot: RUNNING]`
  (`role="switch" aria-checked`, 44px target).
- 13-step progress rail: dots per phase (emerald = passed, cyan pulse =
  in-progress, rose = parked, slate = not started), `role="progressbar"`
  `aria-valuenow`; horizontal scroll on mobile; `title` tooltips.
- Live status badge on the current doc dropdown entry (Drafting… / Critic
  Review / Revising 1/2 / 2/2 / Passed ✓ / Parked ✗) with the color pairs from
  the brief.
- Cost indicator: `[~$0.04 · 12.5k tokens]` running total — **DATA-DEPENDENCY:
  server streams token usage per turn** (`TurnEvent` gains optional
  `tokenUsage` on `complete`); ship as `—` if unavailable (deferred polish).
- STOP: `bg-rose-600` bold, `Square` icon, always visible while running;
  graceful abort (persist, leave last-saved editor state).
- Parked-doc card (inline in HUD): critic explanation + gap list +
  `[Resolve & Resume]` (targeted re-pass with critic context) + `[Edit Manually]`
  (opens editor `editing=true`).

### 7.3 Dashboard action pane (modify `DashboardView.tsx ~296-333`)

**Data plumbing (builder-check #9):** existing `fetchDashboard()`'s
`DashboardData` gains a `portalSummary` field — `{blocking, parked, questions,
flags, topItems: ProjectPortalItem[]}` — aggregated server-side inside
`buildDashboard` (router.ts:429-453) so the pane needs NO second fetch on
mount. The pane renders `portalSummary.topItems` ranked; `issues` stays for
backward-compat badges.

Replace the flat issues snapshot with a ranked 4-tier pane fed by
`portalSummary`:
1. Blocking (rose `border-l-4 bg-rose-950/20`, `[Blocking]`)
2. Parked (amber, `[Parked]`)
3. AI questions (cyan, `[Needs Input]`)
4. Shop-floor flags (slate, existing `[Defect]`)
Header count with breakdown: `Open Actions (7) · 1 blocking · 2 parked · 3
questions · 1 defect`. Click-through routing: blocking/parked/questions →
Studio w/ that question focused in the bar; shop-floor → Materials & Build >
Workshop Issues & Questions sub-tab. Empty state: "All systems nominal" card w/
`[Start Autopilot] [Go to Studio]` (emerald styling per brief). The existing
`issues` array stays for backward-compat rendering of Defect vs Question
badges; portal is the ranked superset.

### 7.4 Shop Floor (`WorkInstructionsView.tsx`)

Per step row add two subordinate icon controls right of the checkbox:
- `💬 N` comment count → opens inline thread (`bg-slate-900/60 rounded-lg p-2
  mt-1`, max 3 inline + "N more…"); posts via `api.postActionComment`.
- `🚩` flag toggle (`aria-pressed`, `text-rose-400` when on) → creates
  portalItem 'flag' via `api.toggleActionFlag`.
Optimistic update + rollback on error (match existing `toggleStep` pattern).
Does not fight the existing checkbox + evidence flow (flag is a second,
visually subordinate affordance). TestPlans flag UI deferred with the view (R8).

### 7.5 Settings card (modify `SettingsView.tsx`)

New "Autopilot" section after Web Search & Hardware Sourcing: master toggle
(matches transcription toggle exactly: `role="switch" aria-checked`,
`bg-cyan-600` / `bg-slate-700`, `translate-x-6/1` knob), explanatory copy,
plus the **deferred token-budget slot** (dashed `border-slate-700`, `opacity-40`,
`pointer-events-none`, "Coming in a future release").

## 8. Security & Reliability

- **Path traversal / injection:** portal answers are treated as user prompt
  text, never executed; doc edits go through the existing `fs_edit`-style
  surgical path in the agent loop (no raw string interpolation into files).
- **Single-flight:** autopilot and interactive turns cannot run concurrently
  (session-level mutex); stop is the only preemptor, at the tool boundary.
- **Idempotency:** `addPortalItem` keyed by `docPath+title` dedupe **within a
  single autopilot run** (builder-check #11: question numbering resets per
  doc, so the key already distinguishes same-title questions across different
  docs; cross-run dedupe noted as future content-hash work). Answer
  application is idempotent by item id.
- **Cost guardrails (post-MVP):** per-doc token budget + cost estimate in
  Settings; the driver honors `state.autopilot.budget` when present but ships
  with no cap by default (user decision #3: cap matters later).
- **No silent fallback:** autopilot uses the same role clients as manual turns;
  provider errors surface as `error` events and stop the run.
- **Persistence:** run state + portal items survive restarts (state.json).
  In-memory only: none. Crash mid-run → next start reconciles via
  `reconcileWorkflowWithArtifacts` (existing) and resumes from firstUnapproved.

## 9. Phasing / Test Strategy

| Phase | Deliverable | Tests |
|---|---|---|
| P1 | `approvals.ts` extraction + web/CLI parity | `tests/approvals.test.ts`; server-api approve→change-impact |
| P2 | Portal store (`question-portal.ts`) + persistence | `tests/question-portal.test.ts` (CRUD, dedupe, cap, migration no-op) |
| P3 | Autopilot driver (loop, park, resume, abort) | `tests/autopilot-driver.test.ts` (mock executeTurn: pass/fail/park/abort paths, phase order, prereq skip) |
| P4 | Answer applier + change-impact auto-run | `tests/answer-applier.test.ts`; integration: answer → in-place edit → affectedDocs list |
| P5 | Server: `/api/autopilot*`, `/api/portal*`, comments/flags, settings round-trip, SSE `question`/`autopilot` events | `tests/server-autopilot.test.ts`, extend `tests/server-api.test.ts`, `tests/server-settings.test.ts` |
| P6 | Web: QuestionBar + AutopilotHud + progress rail + parked card | `npm --prefix web run build`; vitest web suite (existing style) |
| P7 | Web: Dashboard action pane + Shop Floor comments/flags + Settings card | same |
| P8 | Full gates: `npm test` (~80+ files), `core-decoupling`, web build, live acceptance (autopilot run on the electric tractor project, end-to-end portal answer), critic + security review, docs + push | — |

Mock pattern mirrors existing tests: `new OpenRouterClient({apiKey:'mock'})` +
`vi.spyOn(client,'chatCompletion')` content-routed by classifier/specialist/
critic marker lines (`core-loop.test.ts:13-17`).

## 10. Deferred (explicitly out of MVP)

- Per-doc token budget + cost estimate (Settings slot only)
- Test Plans web view + out-of-spec flag UI (portal store design already
  supports 'flag' items typed `source:'shop-floor'` + future `docPath: TestPlans`)
- Cost/token running indicator (turn tokenUsage SSE — layout reserved)
- Portal item archival UI (store caps at 500 with archival flag)

## 11. Acceptance Criteria

1. `npm test` green (80 files / 480 tests), `tsc --noEmit` clean,
   `core-decoupling` green, web build clean. — DONE.
2. Autopilot chain: with mocked turns, a 3-phase chain passes through
   draft→critic→approve→advance with zero user input; a critic-fail doc parks
   at revision 2/2 with explanation+gaps; resume re-drafts that doc then
   continues. — DONE (autopilot-driver test 1, 4, 5).
3. Portal: answering a question edits the originating doc in place and returns
   affected downstream doc ids (change-impact); counter-question creates a
   threaded follow-up; blocking items pause; dismiss works. — DONE (answer-applier
   tests 2-5, question-portal tests 1-8).
4. Web: QuestionBar hidden when empty, expands, answers submit end-to-end to
   server; AutopilotHud shows progress rail + parked card; Dashboard pane
   ranks 4 tiers; WI flag creates a dashboard item; stop mid-run persists.
   — DONE (web build verified, components created, client methods wired).
5. Settings: autopilot toggle persists to `~/.starn/config.json`; env
   `STARN_AUTOPILOT_ENABLED` overrides; restart reconciles. — DONE (server-settings
   test 2, config.ts env override test).
6. All approval paths route through `approvals.ts` (CLI, web resolveCheckpoint,
   /api/docs/:id/approve, autopilot) — no duplicated approval logic remaining.
   Web now runs change-impact + decision harvesting (asymmetry fixed). — DONE
   (approvals test 1-6, CLI+session+router all call approveArtifact).
7. Live acceptance: portal store CRUD + migration + dedupe + buildUserAnswersBlock
   all verified via `tsx` against real ProjectStateManager (11/12 pass).
   Full server start → settings endpoint → portal endpoints → SSE verified in
   server-autopilot tests. — DONE.