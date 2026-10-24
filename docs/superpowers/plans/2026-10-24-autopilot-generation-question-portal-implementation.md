# Autopilot Generation + Question Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A master Autopilot toggle that runs the 13-document specialist chain hands-off (critic gate: 2 auto-revisions then park), plus a persisted Question Portal — a live question bar in Engineering Studio, a ranked action pane on the Dashboard, and per-line comment/flag capture on the Shop Floor — where answering a question edits the originating doc in place and auto-runs change-impact to re-draft only affected downstream docs.

**Architecture:** New I/O-agnostic core modules (`approvals.ts`, `question-portal.ts`, `autopilot.ts`, `answer-applier.ts`) plus a persisted `portalItems[]` + `autopilot` run-state on `ProjectState`. The server (`session.ts`/`router.ts`) adapts them: a unified turn guard, an SSE subscriber list with a long-lived `/api/autopilot/events` stream, and new REST endpoints. Web gains `QuestionBar` + `AutopilotHud` components, a ranked dashboard pane, and shop-floor affordances.

**Tech Stack:** TypeScript strict, Node HTTP (no framework), React+Vite + Tailwind, vitest, OpenRouterClient mock pattern (same as existing tests).

**Spec:** `docs/superpowers/specs/2026-10-24-autopilot-generation-question-portal-design.md` (approved after builder-check; 12 findings fixed). The plan argues from the spec — executors read both.

## Global Constraints

(From spec; every task implicitly includes these.)

- `core/*` must NOT import `cli/*` or `server/*` — the driver, store, approvals, and answer-applier are all core modules. `core-decoupling.test.ts` must stay green.
- Critic gate stays mandatory and capped at `maxAttempts = 2` (`runner.ts:382`); autopilot never skips or weakens it.
- change-impact remains read-only (no fs_write/fs_edit for that package; `change-impact/index.ts:41-43`).
- Mock pattern everywhere: `new OpenRouterClient({apiKey:'mock'})` + `vi.spyOn(client,'chatCompletion')` content-routed by marker lines (classifier `'Request Classifier for STARN'`, specialist name, critic `'Harsh Critic'`; see `core-loop.test.ts:13-17`).
- Tests must mirror existing style: temp project dirs under `os.tmpdir()` with recursive teardown; server tests via `ServerSessionManager` + `clientFactory: () => mockClient` + ephemeral `createHttpServer` + `listen(0)`.
- Worker gates per task: `npx tsc --noEmit`, `npx vitest run <task tests>`, full `npm test` before commit, `npm --prefix web run build` when web files touch.
- No new dependencies. No silent provider fallback.
- Portal items and autopilot state are OPTIONAL on ProjectState (migration defaults, §4.0).

## Review Focus

Input classes / failure modes the spec implies but no single task's happy-path tests:

1. **Old state.json** without `portalItems`/`autopilot` keys must load and run (migration defaults, never crash) → test in T1.
2. **Autopilot start while a human turn is in flight** (and reverse) → 409, never concurrent execution → test in T6.
3. **Browser reloads mid-autopilot**: run state survives, `/api/autopilot/events` backfills, poll fallback shows status → test in T6 (server) + T7 (hook reconnect).
4. **Same-title questions in DIFFERENT docs** must not dedupe away (`docPath+title` key is per-doc) → test in T1.
5. **`onQuestions` timing**: must parse from the FINAL draft (after critic revisions), never mid-loop partial text → test in T2.

---
---

### Task 1: Portal data model + store

**Files:**
- Modify: `src/workspace/types.ts` (ProjectState + new PortalItem/AutopilotState types)
- Modify: `src/workspace/state.ts` (`getOrCreateState`/`getState` migration defaults ~195-245; add `defaultAutopilotState()`)
- Create: `src/core/question-portal.ts`
- Test: `tests/question-portal.test.ts`

**Interfaces:**
- Consumes: nothing new (existing `ProjectStateManager`, `saveState` `state.ts:357`).
- Produces:
  - Types (exported from `src/workspace/types.ts`): `PortalItemType = 'question'|'parked'|'flag'|'nonconformance'`, `PortalItemSeverity = 'blocking'|'normal'`, `PortalItem { id, type, severity, docPath?, section?, title, detail?, gaps?, threadId?, status: 'open'|'answered'|'dismissed'|'resolved', answer?, source: 'autopilot'|'studio'|'shop-floor', createdAt, updatedAt, meta? }`, `AutopilotState { running, startedAt?, stoppedAt?, currentPhaseId?, docStatus: Record<string,string>, revisionsUsed: Record<string,number>, blocks, lastError? }`.
  - `ProjectState.portalItems?: PortalItem[]` and `ProjectState.autopilot?: AutopilotState` (optional).
  - From `src/core/question-portal.ts`: `addPortalItem(manager, item: Omit<PortalItem,'id'|'createdAt'|'updatedAt'|'status'>): PortalItem` (idempotent on `docPath+title` + same run), `answerPortalItem(manager, id, answer): PortalItem`, `dismissPortalItem(manager, id, reason?): PortalItem`, `listPortalItems(manager, filter?: {status?, type?, phaseId?}): PortalItem[]`, `clearResolvedThread(manager, threadId)`.
  - `defaultAutopilotState(): AutopilotState` exported from `src/workspace/state.ts`.

- [ ] **Step 1: Write failing tests** (`tests/question-portal.test.ts`)

```ts
// 1. add → list round-trip; fields persisted (id/createdAt set)
// 2. same docPath+title within one run → returns existing item (dedupe)
// 3. same title, DIFFERENT docPath → two distinct items (Review Focus #4)
// 4. answerPortalItem sets answer + status 'answered' + updatedAt
// 5. dismissPortalItem sets 'dismissed'
// 6. listPortalItems filters by status/type
// 7. MIGRATION: state.json WITHOUT portalItems/autopilot loads, getState()
//    returns [] / defaultAutopilotState(); saveState writes them back (RF #1)
// 8. clearResolvedThread marks children of a thread 'resolved'
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/question-portal.test.ts` → FAIL (module/types missing).

- [ ] **Step 3: Implement** — add optional `portalItems`/`autopilot` to `ProjectState`; migration in `getOrCreateState` (`state.portalItems ??= []`, `state.autopilot ??= defaultAutopilotState()`, `changed=true`). Implement `question-portal.ts` per Interfaces. Cap `portalItems` at 500 then set `meta.archived=true` instead of pushing.

- [ ] **Step 4: Verify.** `npx vitest run tests/question-portal.test.ts` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit.**

```bash
git add src/workspace/types.ts src/workspace/state.ts src/core/question-portal.ts tests/question-portal.test.ts
git commit -m "feat(portal): persisted portal item store with ProjectState migration and dedupe"
```

---

### Task 2: Runner hooks — `forceSpecialistId`, `onQuestions`, `criticFailed`

**Files:**
- Modify: `src/core/runner.ts` (`TurnOptions` ~22-53, `TurnResult` ~55-65, classification ~171-183, critic loop ~375-576)
- Modify: `src/openrouter/types.ts` if needed (no — TurnResult is runner-local)
- Test: `tests/runner-autopilot-hooks.test.ts`

**Interfaces:**
- Consumes: `parseOpenQuestionsFromContent` from `src/core/open-questions-parser.ts:57-70`; `ORDERED_WORKFLOW_PHASES` from `src/workspace/state.ts:12`; `PortalItem`/`defaultAutopilotState` from T1.
- Produces: `TurnOptions.forceSpecialistId?: string`, `TurnOptions.onQuestions?: (items: Omit<PortalItem,'id'|'createdAt'|'updatedAt'|'status'>[]) => void`, `TurnResult.criticFailed?: boolean`.

- [ ] **Step 1: Write failing tests** (`tests/runner-autopilot-hooks.test.ts`, mock clients per Global Constraints)

```ts
// 1. forceSpecialistId:'bom' routes directly — classifier NEVER called
//    (spy on the classifier's chatCompletion: expect 0 classifier calls)
// 2. forceSpecialistId still classifies open-questions correctly and
//    produces a normal TurnResult for specialist 'bom'
// 3. onQuestions fires EXACTLY ONCE per turn, AFTER critic revisions
//    (draft has 3 unresolved questions → items length 3; fired once)
// 4. onQuestions parses FINAL content: a doc revised by critic 1× →
//    questions come from the revision, not the initial draft (RF #5)
// 5. criticFailed === true only when critic loop exhausted 2 revisions
//    without passing; false when passed on revision 1 or 2
// 6. manual turn (no forceSpecialistId) unchanged: classifier still called
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/runner-autopilot-hooks.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `runner.ts`:
- Classification: when `forceSpecialistId` set, resolve via `specialistRegistry.get(forceSpecialistId)` and short-circuit `classifyRequest` (set `lastActiveSpecialistId` from it).
- After the critic loop settles (post auto-revisions, pre-result-assembly ~578): if the specialist produced a doc file and `onQuestions` set, parse final doc content via `parseOpenQuestionsFromContent`, map each parsed question to a `PortalItem`-shaped object, call `onQuestions` once.
- Set `criticFailed: autoRevisionsRun >= 2 && criticResult && !criticResult.passed` (mirror spec §4 criticFailed semantics; also set when critic loop hit max).

- [ ] **Step 4: Verify.** `npx vitest run tests/runner-autopilot-hooks.test.ts` → PASS; `npx tsc --noEmit` clean; `npx vitest run tests/core-loop.test.ts` (regression).

- [ ] **Step 5: Commit.**

```bash
git add src/core/runner.ts tests/runner-autopilot-hooks.test.ts
git commit -m "feat(runner): forceSpecialistId routing, post-critic onQuestions hook, criticFailed flag"
```

---

### Task 3: Shared approval core — `approvals.ts` + 4-path rerouting

**Files:**
- Create: `src/core/approvals.ts`
- Modify: `src/cli/checkpoint.ts` (approve path ~139-227 → call core helper)
- Modify: `src/server/session.ts` (`resolveCheckpoint` ~264-321 → call core helper)
- Modify: `src/server/router.ts` (`/api/docs/:id/approve` ~532-535 → call core helper)
- Modify: `src/workspace/state.ts` (export existing `hasContentChangedSinceApproval` ~568 if not exported)
- Test: `tests/approvals.test.ts` + extend `tests/reopen-and-reapprove.test.ts` (no behavior regression)

**Interfaces:**
- Consumes: `ProjectStateManager`, `harvestDecisionLog` (currently in `src/cli/checkpoint.ts:208-213` — MOVE it to core, e.g. `src/core/decision-log.ts`, re-export from a compat spot for CLI), change-impact package via existing machinery (`runAgentToolLoop`, `changeImpactPackage` — the current import at `checkpoint.ts:208-227`).
- Produces: `approveArtifact(input: { projectPath, stateManager, specialistId, content, runChangeImpact?: (phaseId) => Promise<string[]> }): Promise<{ changedSinceApproval: boolean; affectedDocs: string[]; decisionCount: number }>`.

- [ ] **Step 1: Write failing tests** (`tests/approvals.test.ts`)

```ts
// 1. approveArtifact writes content to docs/{ID}.md, recordArtifact (hash), advances phase
// 2. first approval: changedSinceApproval true (no prior hash), runChangeImpact CALLED
// 3. re-approval with IDENTICAL content: changedSinceApproval false, runChangeImpact NOT called
// 4. re-approval with CHANGED content: changedSinceApproval true, affectedDocs returned
//    (runChangeImpact mock returns ['icd','requirements'])
// 5. harvestDecisionLog runs: DECISIONS.md gets entries from doc's Decision/Design
//    sections (build a doc with a "### Decision:" block, assert file written)
// 6. phase advancement: activePhase moves to next unapproved in canonical order
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/approvals.test.ts` → FAIL.

- [ ] **Step 3: Implement** `approvals.ts` per Interfaces. Move decision harvesting into core (`src/core/decision-log.ts`); CLI imports it from there (delete the CLI-local copy; keep CLI call sites working — verify `checkpoint.ts` compiles). Replace the three adapter approve paths to call `approveArtifact`; `/api/docs/:id/approve` now reads current doc content from disk, supports re-approval hash detection + change-impact + phase advance (spec §5.1 finding #7). CLI path stays behaviorally identical (tests prove it).

- [ ] **Step 4: Verify.** `npx vitest run tests/approvals.test.ts tests/reopen-and-reapprove.test.ts tests/checkpoint-ui.test.ts tests/server-api.test.ts` → PASS; `npx tsc --noEmit` clean; full `npm test`.

- [ ] **Step 5: Commit.**

```bash
git add src/core/approvals.ts src/core/decision-log.ts src/cli/checkpoint.ts src/server/session.ts src/server/router.ts src/workspace/state.ts tests/approvals.test.ts
git commit -m "feat(core): shared approveArtifact with change-impact + decision harvesting; web approval parity"
```

---

### Task 4: Autopilot driver (core)

**Files:**
- Create: `src/core/autopilot.ts`
- Test: `tests/autopilot-driver.test.ts`

**Interfaces:**
- Consumes: T1 store (`addPortalItem`, `answerPortalItem`, `listPortalItems`), T2 (`forceSpecialistId`, `onQuestions`, `criticFailed`), T3 (`approveArtifact`), `ORDERED_WORKFLOW_PHASES` + `firstUnapproved`/`isArtifactApproved` (state.ts), `CoreRunner.executeTurn` via a closure (driver never constructs its own runner).
- Produces:

```ts
export interface AutopilotDeps {
  stateManager: ProjectStateManager;
  projectPath: string;
  executeTurn: (opts: { userPrompt: string; forceSpecialistId: string; signal?: AbortSignal; onQuestions?: TurnOptions['onQuestions'] }) => Promise<TurnResult>;
}
export type AutopilotEvent =
  | { kind: 'start'; total: number }
  | { kind: 'phase'; phaseId: string; status: 'drafting'|'critic'|'revising'|'passed'|'parked' }
  | { kind: 'question'; item: PortalItem }
  | { kind: 'parked'; item: PortalItem }
  | { kind: 'complete'; result: { passed: string[]; parked: string[] } }
  | { kind: 'error'; message: string };
export class AutopilotDriver {
  constructor(deps: AutopilotDeps);
  start(): void;                 // begins async run (fire-and-forget)
  stop(): void;                  // abort signal → graceful phase-boundary stop
  resume(docId?: string): void;  // re-draft parked doc (or continue from firstUnapproved)
  getState(): AutopilotState;    // live snapshot from state.autopilot
}
```

- [ ] **Step 1: Write failing tests** (`tests/autopilot-driver.test.ts`, mock executeTurn closure: resolve via a fake that returns canned TurnResults)

```ts
// 1. 3-phase chain (conops→architecture→icd) with mock passes → start()
//    yields phase events drafting/critic/passed in order, complete() with
//    passed=['conops','architecture','icd']; state.autopilot.docStatus updated
// 2. forceSpecialistId passed to executeTurn per phase (assert opts)
// 3. onQuestions from T2 → driver stores items via addPortalItem + emits
//    'question' event per item (non-blocking: run CONTINUES)
// 4. phase with criticFailed TurnResult → 'parked' event; run STOPS;
//    parked item persisted with gaps; blocks=1
// 5. resume(docId) → re-drafts that doc (executeTurn called with that
//    phase's forceSpecialistId), then CONTINUES the chain to completion
// 6. stop() mid-run → current phase aborted, docStatus 'idle', state
//    persisted, no further phases started (RF #2-adjacent)
// 7. prereq skip: if architecture unapproved but ICD somehow first, driver
//    follows canonical order from firstUnapproved (no out-of-order)
// 8. auto-approve path: every passing phase calls approveArtifact (spy)
// 9. AbortSignal from stop propagates into executeTurn opts.signal
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/autopilot-driver.test.ts` → FAIL.

- [ ] **Step 3: Implement** `autopilot.ts` per Interfaces + spec §5.3 (loop, synthesize prompt "Generate the {phaseName} deliverable for this project now (autopilot run)...", honor `transcriptionEnabled`/role clients via executeTurn closure, persist `state.autopilot` after every phase, park on `criticFailed`, stop/abort semantics, `blocks` count, `lastError`).

- [ ] **Step 4: Verify.** `npx vitest run tests/autopilot-driver.test.ts tests/question-portal.test.ts` → PASS; `npx tsc --noEmit` clean; full `npm test`.

- [ ] **Step 5: Commit.**

```bash
git add src/core/autopilot.ts tests/autopilot-driver.test.ts
git commit -m "feat(autopilot): core chain driver with park/resume/stop and portal question capture"
```

---

### Task 5: Answer applier (core)

**Files:**
- Create: `src/core/answer-applier.ts`
- Test: `tests/answer-applier.test.ts`

**Interfaces:**
- Consumes: T1 store, T2 (`forceSpecialistId`, `onQuestions`), T3 (`approveArtifact` + `runChangeImpact`), T4 event types.
- Produces:

```ts
export interface AnswerApplierDeps {
  stateManager: ProjectStateManager;
  projectPath: string;
  executeTurn: (opts: { userPrompt: string; forceSpecialistId: string; signal?: AbortSignal; onQuestions?: TurnOptions['onQuestions'] }) => Promise<TurnResult>;
}
export async function applyAnswer(deps: AnswerApplierDeps, itemId: string, answerText: string): Promise<{
  updatedItem: PortalItem;        // status 'answered'
  affectedDocs: string[];         // change-impact findings
  counterQuestions: PortalItem[]; // new 'question' items on same threadId
}>;
// also exported: buildUserAnswersBlock(item: PortalItem, answer: string): string
```

- [ ] **Step 1: Write failing tests** (`tests/answer-applier.test.ts`)

```ts
// 1. builds the exact USER ANSWERS block: prompts include
//    "USER ANSWERS TO OPEN QUESTIONS (incorporate per your instructions):"
//    and "Q{n}. {title}\nAnswer: {answer}" (spy on executeTurn's userPrompt)
// 2. routes via forceSpecialistId = phase of item.docPath (conops→'conops')
// 3. mock turn returns critic pass → approveArtifact called with
//    runChangeImpact; affectedDocs from its result returned
// 4. a follow-up 'question'-type item created when mock turn output contains
//    unresolved questions → same threadId, source 'autopilot' (counter-ask)
// 5. item marked 'answered'; child counter-questions stay 'open' until
//    answered or clearResolvedThread
// 6. answer to already-answered item with changed text: re-applies (idempotent
//    by item id; status stays 'answered', updatedAt bumped)
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/answer-applier.test.ts` → FAIL.

- [ ] **Step 3: Implement** `answer-applier.ts` per Interfaces + spec §5.4 (explicit `forceSpecialistId`, never rely on `lastActiveSpecialistId`).

- [ ] **Step 4: Verify.** `npx vitest run tests/answer-applier.test.ts tests/autopilot-driver.test.ts` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit.**

```bash
git add src/core/answer-applier.ts tests/answer-applier.test.ts
git commit -m "feat(portal): answer applier with in-place edit + change-impact + threaded counter-questions"
```

---

### Task 6: Server surface — guard, SSE events, endpoints, settings

**Files:**
- Modify: `src/server/session.ts` (beginTurn/endTurn guard extraction ~195-254; subscriber list + event publish; autopilotStart/Stop/Resume; portal endpoints handlers)
- Modify: `src/server/router.ts` (routes: `/api/autopilot` GET/POST start/stop/resume; `/api/autopilot/events` SSE; `/api/portal` GET + POST :id/answer + :id/dismiss; `/api/actions/:id/comments` POST; `/api/actions/:id/flags` POST; extend `/api/dashboard` with `portalSummary` ~429-453; settings GET/PUT `autopilotEnabled` ~824-858)
- Modify: `src/server/types.ts` (new event types, portal/autopilot response types)
- Modify: `src/config.ts` (`StarnConfig.autopilotEnabled`, `UserConfigFile.autopilot?: {enabled?: boolean}`, `autopilotEnabled()` with env `STARN_AUTOPILOT_ENABLED` override, `saveUserConfig` wiring — clone `transcriptionEnabled` pattern `config.ts:107-116`)
- Modify: `src/index.ts` (persistModelSettings writes autopilot; session/registry wiring; RouterDeps onSettingsSaved payload)
- Test: `tests/server-autopilot.test.ts` + extend `tests/server-settings.test.ts`

**Interfaces:**
- Consumes: T4 `AutopilotDriver` + `AutopilotEvent`, T5 `applyAnswer`, T1 store/list functions, T3 `approveArtifact`.
- Produces (web-facing):
  - `AutopilotStatusResponse { enabled, running, currentPhaseId?, docStatus, blocks, passedCount, totalPhases }`
  - `PortalListResponse { items: PortalItem[] }`
  - `DashboardData.portalSummary: { blocking, parked, questions, flags, topItems: PortalItem[] }`
  - `TurnEvent` gains `{type:'autopilot', status: AutopilotStatusResponse}` and `{type:'question', item: PortalItem}` (in `web/src/types/api.ts` too — do web types in T7, server types here).
  - `Settings`/`SettingsUpdate` gain `autopilotEnabled: boolean` (server side here; web types in T7).

- [ ] **Step 1: Write failing tests** (`tests/server-autopilot.test.ts`, ephemeral server pattern)

```ts
// 1. GET /api/autopilot → 200 {enabled, running:false, ...defaults}
// 2. POST /api/autopilot/start with mock client → 202; driver runs 2 mocked
//    phases; GET /api/autopilot eventually shows running/passedCount>0 (poll)
// 3. start while human turn busy → 409 (Review Focus #2); human turn while
//    autopilot running → 409
// 4. POST /api/autopilot/stop mid-run → 200; runs stops at boundary
// 5. POST /api/portal → list; POST /api/portal/:id/answer → 200, item
//    answered, affectedDocs present (mock answer turn)
// 6. POST /api/actions/:id/comments → persists; /flags → creates portalItem
//    type 'flag' visible in GET /api/portal
// 7. GET /api/dashboard → portalSummary counts + topItems populated
// 8. GET /api/autopilot/events → SSE endpoint: emits 'question' event frame
//    when a question is published (connect, trigger, read frame)
// 9. settings PUT {autopilotEnabled:false} → GET returns false; restart
//    (fresh ServerSessionManager) → still false (config persisted) (RF #1)
// 10. env STARN_AUTOPILOT_ENABLED=false wins over config file value
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/server-autopilot.test.ts` → FAIL.

- [ ] **Step 3: Implement** per Interfaces. Guard extraction: `beginTurn()/endTurn()` from `runTurn`'s `activeAbort`; both paths acquire. Subscriber list: `publish(event)` → fan out to SSE connections (cap 10 concurrent, drop-oldest). `/api/autopilot/events`: register res, backfill last N=20 events, `req.on('close')` unsubscribe. `runTurn` unchanged for interactive path except publishing `autopilot`-kind events when a driver runs. Settings round-trip: `onSettingsSaved` payload gains `autopilotEnabled?: boolean`; `persistModelSettings` writes `autopilot: {enabled}`; runtime `config.autopilotEnabled` → session → `buildSettings`.

- [ ] **Step 4: Verify.** `npx vitest run tests/server-autopilot.test.ts tests/server-settings.test.ts tests/server-api.test.ts` → PASS; `npx tsc --noEmit` clean; full `npm test`.

- [ ] **Step 5: Commit.**

```bash
git add src/server/session.ts src/server/router.ts src/server/types.ts src/config.ts src/index.ts tests/server-autopilot.test.ts tests/server-settings.test.ts
git commit -m "feat(server): autopilot endpoints, portal API, SSE event stream, action comments/flags, settings round-trip"
```

---

### Task 7: Web — QuestionBar, AutopilotHud, dashboard pane, client plumbing

**UX SEAMLESSNESS LAYER (LOCKED — from ui-ux pass 399c3e69, live-verified on :3000; this is REQUIRED, not optional):**

S1. **QuestionBar mounts OUTSIDE the chat scroll container** in DevelopmentView — sibling div between the scroll region and `<footer>`, NOT a child. Chat scroll div stays `min-h-0 flex-1 overflow-y-auto` (fixed height); QuestionBar is a static-height sibling (collapsed ~36px, expanded ≤200px with its own overflow-y). Guarantees `chatEndRef.scrollIntoView` never fights expansion (Tension 2).
S2. **When a CheckpointPanel is visible, QuestionBar renders as a single thin `h-8` badge row only** — `opacity-60`, no expand affordance. Checkpoint is the hero; questions wait (Tension 1).
S3. **Collapsed badge uses `border-l-2 border-amber-500`** (amber = needs input; cyan is reserved for checkpoint). New-question arrival: `animate-question-arrive` (keyframe §S10) for 3s + count increment flash `text-cyan-300`; if input focused, placeholder swaps to "New question from AI — answer to continue autopilot" for 2s.
S4. **Parked doc = pinned sticky chat card**: full-width `border-l-2 border-rose-500 bg-rose-950/20` card at TOP of the chat pane, `position: sticky; top: 0; z-index: 10` inside the scroll area, stays until explicitly dismissed with `[Dismiss]`; contains critic explanation + "Missing requirements" list + `[Review gaps →]` opening the parked card in the QuestionBar zone + `[Resolve & Resume]` + `[Edit Manually]` (Tension 4). Also: doc selector dropdown shows `bg-rose-950/80 text-rose-300 font-bold` "Parked ✗" badge on parked docs.
S5. **Answered card — 3-layer feedback** (Tension 3): 0ms submit spinner + card turns `bg-emerald-950/30 border-l-2 border-emerald-500` "Applying…"; ≤500ms chat system entry "✎ Answer applied to {DOC} — scanning downstream impact…" appended below the last entry; on complete, doc pane refreshes + if current doc edited, 4s banner "This document was updated from your answer." Then 8s dwell (`opacity-50` + "Resolved ✓" + RotateCcw undo) → `animate-answered-collapse` removes from flow.
S6. **Change-impact re-draft notice**: affected downstream dots on the 13-dot rail get a 2s amber `animate-pulse` ripple after an answer applies ("Re-drafting affected docs" state).
S7. **Progress rail IS the status locus** (5-second test): mounted in DevelopmentView doc toolbar below the doc selector, `bg-slate-900/80 border-b border-slate-800 px-3 py-1.5`; 13 dots per §Hero spec — `w-2 h-2 rounded-full`, IN_PROGRESS = `w-3 bg-cyan-500 motion-safe:animate-pulse ring-2 ring-cyan-500/40` + `text-[11px] font-bold text-cyan-300` "Drafting: {Doc}" label above; PASSED emerald, PARKED rose `ring-1 ring-rose-500/60`, queued slate; right-aligned `text-[10px] font-mono text-slate-500` status word ("Working…" / "N parked" / "Idle"). Toggle ON → rail appears (`animate-fadeIn`); OFF → `hidden`. Rail is `role="progressbar" aria-valuenow` per phase count.
S8. **Terminology (apply everywhere — Settings, Studio, Dashboard, Shop Floor):** "Open Issues & Questions" → **"Open Actions"** (Dashboard header); "Workshop Issues & Questions" sub-tab → **"Shop Floor Flags"**; collapsed bar label → **"Needs Input"**, expanded header → **"Questions from AI"**; "Gaps" → **"Missing requirements"** in critic-park copy; "Change impact" in user-visible copy → **"Re-drafting affected docs"**; keep "Autopilot" with subtitle "AI auto-drafts all 13 documents".
S9. **Dashboard pane with autopilot OFF** shows only shop-floor tier + CTA card "Start Autopilot to auto-draft all 13 documents."
S10. **Add 3 keyframes to `web/src/index.css`**: `question-arrive` (300ms ease-out, transparent→cyan-0.15 bg + scale 1.05→1), `answered-collapse` (400ms ease-in forwards, opacity 1/200px→0/0 max-height+padding), `park-reveal` (250ms ease-out, translateY(-8px)+opacity 0→1). Applied to: badge on arrival, answered card after 8s dwell, parked chat card on first render.
S11. **Visual weight rule**: exactly ONE hero element per moment — checkpoint (cyan, heavyweight) OR rail (drafting) OR badge (question arrival) OR parked card (rose, pinned). When checkpoint present, everything else is subdued.

**Files:**
- Create: `web/src/components/QuestionBar.tsx`
- Create: `web/src/components/AutopilotHud.tsx`
- Create: `web/src/hooks/useAutopilotEvents.ts`
- Modify: `web/src/types/api.ts` (TurnEvent new cases, PortalItem, AutopilotStatusResponse, PortalListResponse, Settings/Update autopilotEnabled, DashboardData.portalSummary)
- Modify: `web/src/api/client.ts` (fetchAutopilotStatus, autopilotStart/Stop/Resume, fetchPortalItems, submitPortalAnswer, dismissPortalItem, postActionComment, toggleActionFlag)
- Modify: `web/src/api/useTurnStream.ts` (handleEvent cases for 'question'/'autopilot')
- Modify: `web/src/views/DevelopmentView.tsx` (mount QuestionBar between chat-end ~284 and footer ~288; AutopilotHud in doc toolbar)
- Modify: `web/src/views/DashboardView.tsx` (ranked action pane from portalSummary ~296-333)
- Modify: `web/src/layouts/AppShell.tsx` (pass through autopilot/portal state; dashboard click-through routing target)
- Test: `npm --prefix web run build`; vitest if a web test exists (mirror existing minimal web coverage; primary gate is build + typecheck)

**Interfaces:**
- Consumes: T6 endpoints + response types.
- Produces: `QuestionBar` props `{ items: PortalItem[]; onSubmit(id,text): Promise<void>; onDismiss(id): Promise<void> }`; `AutopilotHud` props `{ status: AutopilotStatusResponse; onStart/onStop/onResume; onEditDoc(docId) }`.

- [ ] **Step 1: Implement data plumbing** — `api/client.ts` methods (T6 contracts), `useTurnStream` switch cases (`'question'`: append item to portal state; `'autopilot'`: update hud state), `types/api.ts` (exact shapes from T6), `useAutopilotEvents.ts` (fetch-SSE on `/api/autopilot/events` w/ auto-reconnect + 3s poll fallback per spec §6.1).

- [ ] **Step 2: Implement QuestionBar** per spec §7.1 — hidden when empty; collapsed badge (`◈ N pending AI questions`), `aria-expanded`, `Ctrl+.` focuses first, `aria-live="polite"`; expanded cards w/ pending (amber `[AI needs input]`) vs parked (rose `[Critic blocked]` + gaps + `[Resolve & Resume]`/`[Edit Manually]`); inline answer textarea (Enter submit, Shift+Enter newline), answered → slate-600 check 8s fade + RotateCcw undo; mobile FAB + bottom sheet. Mount in `DevelopmentView` between the chat end and footer.

- [ ] **Step 3: Implement AutopilotHud** per spec §7.2 — toggle pill (`role="switch" aria-checked`, [Autopilot: OFF/RUNNING]) in Dashboard header + Studio toolbar; 13-dot progress rail (`role="progressbar"` aria-valuenow, emerald=passed/cyan pulse=active/rose=parked/slate=idle, horizontal scroll mobile, `title` tooltips); live status badge per doc; STOP (rose, Square, graceful); parked-doc card inline (critic explanation + gaps + resolve/edit).

- [ ] **Step 4: Dashboard action pane** per spec §7.3 — render `portalSummary.topItems` ranked 4 tiers (rose blocking / amber parked / cyan needs-input / slate shop-floor), header `Open Actions (N) · breakdown`, click-through routing (blocked/parked/q → Studio w/ question focused; shop-floor → existing issues sub-tab), "All systems nominal" empty state w/ Start Autopilot + Go to Studio.

- [ ] **Step 5: Mount + verify.** Wire `useAutopilotEvents` in `AppShell.tsx`; pass state down. Implement the seamlessness layer S1-S6, S10 (keyframes), S11 exactly as spec'd above — QuestionBar OUTSIDE scroll container; amber badge; checkpoint-subduction; sticky parked card; 3-layer answer feedback; rail ripple. Verify: `npm --prefix web run build` clean; `npx tsc --noEmit` clean (web/tsconfig via the web build); `npm test` still green.

- [ ] **Step 6: Accept sa. (UX acceptance checks from 399c3e69):**
  1. With checkpoint visible + 3 pending questions: checkpoint fills bottom focus zone; question badge is a thin `h-8` row, `opacity-60`, no expand affordance.
  2. Open 5 questions in the bar → chat scroll position unchanged (bar is outside the scroll container).
  3. Submit answer → spinner immediately, chat entry ≤2s, doc pane updates ≤8s.
  4. 3 docs draft after a park → scroll to top, parked card pinned; Dashboard tier-1 shows it; doc dropdown shows "Parked ✗" badge.
  5. Autopilot OFF → Dashboard pane shows only shop-floor + "Start Autopilot" CTA.

- [ ] **Step 7: Commit.**

```bash
git add web/src
git commit -m "feat(web): question bar, autopilot HUD with progress rail, ranked dashboard action pane, SSE plumbing"
```

---

### Task 8: Shop Floor — WI comments/flags + Settings autopilot card

**UX layer (locked from 399c3e69):** rename sub-tab label + issues view header to "Shop Floor Flags" (S8); flag button `aria-pressed`, rose when flagged, creates portalItem 'flag' shown as tier-4 on Dashboard. Settings card per S8 copy: "Autopilot — AI auto-drafts all 13 documents."

**Files:**
- Modify: `web/src/views/WorkInstructionsView.tsx` (per-step `💬 N` comment + `🚩` flag affordances)
- Modify: `web/src/views/SettingsView.tsx` (Autopilot section card after Web Search & Hardware Sourcing ~ per transcription card pattern ~516-536: master toggle `role="switch" aria-checked`, `bg-cyan-600`/`bg-slate-700` knob, copy, dashed deferred token-budget slot `opacity-40 pointer-events-none`)
- Modify: `src/server/parsers/actions-parser.ts` (persist `stepAnnotations` alongside checklist; expose comments/flag state)
- Test: extend `tests/server-parsers.test.ts` + web build; `tests/server-api.test.ts` flag→portal item (already covered in T6 #6 — extend WI parse round-trip)

**Interfaces:**
- Consumes: T6 `POST /api/actions/:id/comments` + `/flags`, T7 client methods.
- Produces: `StepAnnotations { stepId; comments: {author, text, at}[]; flagged: boolean }` on action payload.

- [ ] **Step 1: Implement server persistence** — parse/store `stepAnnotations` in the action store (`actions-parser.ts`; optimistic PATCH round-trip pattern from `toggleWorkInstructionStep`). Extend parse tests: comments/flags survive read→write→read.

- [ ] **Step 2: Implement WI UI** per spec §7.4 — subordinate icon controls right of checkbox: `💬 N` opens inline thread (`bg-slate-900/60 rounded-lg p-2 mt-1`, max 3 + "N more…"), `🚩` flag toggle (`aria-pressed`, `text-rose-400`, creates portalItem 'flag'). Optimistic + rollback on error (match `toggleStep`).

- [ ] **Step 3: Settings card** per Interfaces (toggle persists via `api.saveSettings({autopilotEnabled})`; deferred slot non-interactive).

- [ ] **Step 4: Verify.** `npx vitest run tests/server-parsers.test.ts tests/server-api.test.ts` → PASS; `npx tsc --noEmit` clean; `npm --prefix web run build` clean; full `npm test`.

- [ ] **Step 5: Commit.**

```bash
git add web/src/views/WorkInstructionsView.tsx web/src/views/SettingsView.tsx src/server/parsers/actions-parser.ts tests/server-parsers.test.ts
git commit -m "feat(shop-floor): per-step comments and flags with portal surfacing; settings autopilot card"
```

---

### Task 9: Full gates, live acceptance, docs, push

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-autopilot-generation-question-portal-design.md` (mark Implemented, record acceptance results)

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Full verification.** `npx tsc --noEmit`; `npx vitest run tests/core-decoupling.test.ts` (1 PASS); full `npm test` (expect ~80+ files green); `npm --prefix web run build` clean.

- [ ] **Step 2: Live acceptance on the electric tractor project** (`C:/Users/makel/OneDrive/Desktop/starn test`, registry id `proj_632523e7`) — needs `OPENROUTER_API_KEY` (available in env). Start the dev server, run autopilot for ≥3 phases (CONOPS→Architecture→ICD or continue from existing approved state): verify real docs generated end-to-end, critic passes, a portal question is answerable mid-run, and change-impact queues a downstream re-draft after an answer. Record results (phase count, question count, affectedDocs) into the spec's acceptance section.

- [ ] **Step 3: Critic + security review passes** on the full branch diff (dispatch fresh `critic` + `security` agents; fix findings via worker; re-run gates).

- [ ] **Step 4: Docs + push.** Mark spec Implemented (date + results). `git add -A && git commit -m "docs: record autopilot + portal implementation and live acceptance"`. Push all to `origin/master`.

- [ ] **Step 5: Report.** Summarize: feature surface, architecture decisions (core drivers, guard, SSE transport), verification numbers, live-acceptance evidence.