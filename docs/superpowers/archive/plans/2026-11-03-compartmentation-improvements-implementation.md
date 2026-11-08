# Compartmentation Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise codebase agent-focusability from 7.5 → 9 by splitting the god-controller router into domain modules, extracting leaf modules from the two fat orchestrators (runner, session), and giving the web layer an isolated test runner.

**Architecture:** Three behavior-preserving workstreams, each ending in a full verification gate, executed in order: (A) `src/server/router.ts` (1342 lines) becomes a thin dispatcher over `src/server/routes/*` domain modules sharing a `kit.ts`; (B) runner's artifact-guard + critic-revision logic and session's answer-queue + event-bus machinery move to `src/core/*` leaf modules with injected deps; (C) web gets vitest + jsdom + Testing Library and component tests for the recently-shipped portal code. Zero runtime behavior change, zero new runtime deps.

**Tech Stack:** TypeScript (strict), Node http, vitest (root + web), @testing-library/react/jsdom (web only, devDeps), existing React 18 + Tailwind 4 toolchain.

**Spec:** None — standalone refactor plan. Design decisions (module boundaries, signatures, dispatch protocol) are documented inline below; the existing 513-test suite is the behavior contract.

## Global Constraints

- **Behavior preservation is the spec.** Every existing route response (status code, headers, SSE framing, envelope shape) must remain byte-identical. The 513-test suite (`npm test`) must stay green at every gate.
- **No new runtime dependencies.** `web/package.json` `dependencies` block is untouched. New devDependencies allowed **only** for web test tooling (user-approved override of the no-new-deps rule — this is the one and only exception).
- **AGENTS.md layering:** `core/*` must import only `node:*`, `workspace/*`, `core/*` — never `cli/`, `server/`, or `web/`. `tests/core-decoupling.test.ts` enforces this; it must keep passing after workstream B.
- **I/O-agnostic core:** extracted core leaves must be pure/injected — no terminal libraries, no http, no direct state-manager writes beyond what they already receive.
- **TDD per task:** failing test first, then minimal implementation, then the module's tests + full gate.
- **Commit per workstream** (3 commits + this plan doc), push once at the end.
- **File-line ceilings (soft focusability metrics, checked by grep/wc, not tests):** `router.ts` < 450 lines after A; `runner.ts` and `session.ts` each shrink after B.
- Web tests run under `npm --prefix web run test` (own vitest config, jsdom). Root `npm test` remains node-env `tests/**`.

## Review Focus

1. **Route response fidelity after A:** status codes, JSON envelope `{success,data,error}`, SSE `event:\ndata:\n\n` framing, `Cache-Control`/`Connection` headers, multipart uploads, 404 fallthrough, and the CSRF Origin guard firing *before* any route module.
2. **Dispatcher bypass risk after A:** no route module may short-circuit others; each module returns `true` iff it handled; unknown paths must reach the 404 exactly as today.
3. **Extraction fidelity after B:** ported strings byte-identical (guard messages, revision guidance, critic notes, queue-full message); `AnswerFrameEvent` still importable by `server/*` (re-export from session); busy-guard ordering in `runTurn`/`drainWithGuard` unchanged.
4. **Web test env correctness after C:** jsdom + vite react plugin transform TSX; `@testing-library/jest-dom/vitest` matchers loaded via setup file; lucide-react renders in jsdom without icons breaking tests; no test imports `node:fs` (node-only) into jsdom env.
5. **No scope creep:** each workstream touches only its listed files. Web tests this round cover the portal/markdown components only — no full DevelopmentView SSE-integration tests (noted as follow-up).

---

## Workstream A — Router split (TDD)

### A1. Build the shared routing kit

**New file `src/server/routes/kit.ts`** — move verbatim from `router.ts`:
- `ApiEnvelope<T>`, `sendJson`, `ok`, `fail`
- `MUTATING_METHODS`, `hostHeaderHostname`, `isLoopbackAlias`, `originMatchesHost` (CSRF guard)
- `readJsonBody`, `MAX_BODY_BYTES`, `parseMultipartBoundary`, `readRawBody`, `parseMultipartBody`, `MultipartBody`
- `safeReadFile`, `getBomFinancials`, `MIME_TYPES`
- Response builders: `buildSettings`, `buildSummary`, `buildProjectInfo`, `buildRoadmap`, `listWorkInstructions`, `findWorkInstructionFile`, `collectOpenQuestionGroups`, `buildIssues`, `buildIssuePrompt`
- `RouterDeps` interface (moved, re-exported from `router.ts` so `server.ts` import path is untouched)

**New shared type** in kit:
```ts
export type RouteHandler = (
  deps: RouterDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  segments: string[]
) => Promise<void> | void;
/** returns true iff this module produced a response (dispatcher stops); false → try next */
export type RouteModule = { name: string; match: (url: URL, segments: string[]) => boolean; handle: RouteHandler };
```

**Test first:** `tests/router-kit.test.ts` — originMatchesHost alias table (localhost/127.0.0.1/::1), MUTATING_METHODS membership, ok/fail envelope shapes. Then move code; tests pass.

### A2. Extract the domain route modules

**New files, each `export const <name>Module: RouteModule` with `match` on `segments[1]` (or exact pathname) and the ORIGINAL handler bodies moved verbatim (changing only the outer `if (method && pathname)` condition into the module guard + inner blocks):**

| Module file | Routes (from router.ts) | segments[1] guard |
|---|---|---|
| `routes/projects.ts` | projects, fs/folders, projects/switch, project, roadmap, workflow/active-phase, dashboard (L508–621) | `projects`/`fs`/`project`/`roadmap`/`workflow`/`dashboard` |
| `routes/turns.ts` | turns (SSE), turns/abort, checkpoints/pending, checkpoints/decision (L626–690) | `turns`/`checkpoints` |
| `routes/docs.ts` | /api/docs/<phase> GET/PUT (L693–745) | `docs` |
| `routes/content.ts` | trade-study, bom, bom items PATCH, actions (+ item GET, comments, flags), issues (+ push-to-agent), artifacts upload/get, examples/<id> (L746–889) | `trade-study`/`bom`/`actions`/`issues`/`artifacts`/`examples` |
| `routes/library.ts` | references POST, library GET, DELETE references/examples (L891–941) | `references`/`library` |
| `routes/settings.ts` | search GET/POST/probe, settings GET/PUT, providers/<id> (L943–1085) | `settings`/`providers` |
| `routes/autopilot.ts` | status GET, start, stop, resume, events SSE (L1087–1178) | `autopilot` |
| `routes/portal.ts` | items GET, answer POST, dismiss POST (L1180–1227) | `portal` |
| `routes/voice.ts` | transcribe POST (L1286–1312) | `transcribe` |

All moved bodies keep their `deps.*` calls, `readJsonBody(req)` calls, and `return ok/fail` — unchanged. Each module imports helpers from `./kit.js`.

### A3. Shrink `router.ts` to a dispatcher

`handleApiRequest` becomes:
1. Compute `url`/`segments` once.
2. **CSRF Origin guard first** (MUTATING_METHODS × originMatchesHost → 403) — unchanged semantics.
3. Iterate a fixed-order registry `[projectsModule, turnsModule, docsModule, contentModule, libraryModule, settingsModule, autopilotModule, portalModule, voiceModule]`; first `match()` true → `await handle(...)`, `return`.
4. Fallthrough → existing 404 behavior (match current `handleApiRequest` tail exactly).
5. `handleStaticRequest` stays in router.ts (or moves to `server.ts` — keep in router.ts to minimize churn, it's ~30 lines).
6. Re-export `RouterDeps` from `./routes/kit.js` so `server.ts`'s import is untouched.

**Test first:** `tests/router-structure.test.ts` — for each module: its own paths → `match` true; a foreign path (e.g. portal module on `/api/bom`) → false; dispatcher on unknown `/api/nope` → 404; CSRF 403 still fires for cross-origin POST to a route module (regression of the 5465782 guard). Then implement; existing server tests (`server-api`, `server-autopilot`, `server-answer-queue`, `server-settings`, `server-library`, `server-project-switch`, `server-parsers`, `server-search-settings`, `server-active-phase`) must all stay green — that is the real behavior contract.

### A4. Workstream A gate

- [ ] `npx tsc --noEmit`
- [ ] `npm test` — all green (513 + new router tests)
- [ ] `npm --prefix web run build`
- [ ] `wc -l src/server/router.ts` < 450
- [ ] `grep -rn "from './router.js'\|from './routes/kit.js'" src/server/server.ts src/server/routes/*.ts` — server.ts still imports from router.js only; route modules import from kit.js
- [ ] Commit: `refactor(server): split router.ts into domain route modules`

---

## Workstream B — Runner + session leaf extraction (TDD)

### B1. `src/core/artifact-guard.ts` (from runner.ts L407–475)

Port the guard decision tree verbatim into pure functions:
```ts
export type ArtifactClassification =
  | { kind: 'document'; artifact: string }
  | { kind: 'commentary'; artifact: string }
  | { kind: 'none'; reason: 'no-tool-calls-no-document' | 'empty' };
export function classifyTurnArtifact(raw: string | null | undefined, madeToolCalls: boolean, wroteToDisk: boolean): ArtifactClassification;
export function buildNoDocumentError(model: string, providerName: string): string; // byte-identical to runner's current message
```
Runner's turn body calls `classifyTurnArtifact` and keeps its control flow (skip-critic, surface error) — **the decision tree and messages are the contract**. Move `tests/drafting-guard.test.ts` assertions to `tests/artifact-guard.test.ts` (keeping the existing file green via the runner's new call site), add cases: commentary, empty, no-tool-calls-no-document, written-to-disk recovery.

### B2. `src/core/critic-revision.ts` (from runner.ts L575–590 + L683–700)

```ts
export function buildRevisionGuidance(result: CriticResult, includeExamples: boolean, exampleText: string | null): string; // both branches byte-identical
export function buildCriticNote(specialistName: string, result: CriticResult | undefined, passed: boolean): string; // byte-identical
```
Runner replaces inline template literals with these calls. **Test first:** `tests/critic-revision.test.ts` locks both guidance branches + the note format exactly (reuse existing strings from runner).

### B3. `src/core/answer-queue.ts` (from session.ts L103–111 + L420–556)

```ts
export type AnswerFrameEvent =
  | { kind: 'answer_queued'; itemId: string; title: string }
  | { kind: 'answer_applying'; itemId: string }
  | { kind: 'answer_applied'; itemId: string; item: PortalItem; affectedDocs: string[] }
  | { kind: 'answer_failed'; itemId: string; error: string };
export type AnswerApplyResult = { ok: true; item: PortalItem; affectedDocs: string[] } | { ok: false; error: string };
export interface AnswerQueueDeps {
  apply: (itemId: string, answer: string) => Promise<AnswerApplyResult>;
  onFrame: (ev: AnswerFrameEvent) => void;
  maxSize?: number; // default 50
}
export class AnswerQueue {
  constructor(deps: AnswerQueueDeps);
  enqueue(itemId: string, answer: string): { queued: boolean; replaced: boolean };
  get pendingCount(): number;
  get isDraining(): boolean;
  async drain(): Promise<void>; // serial FIFO; failed apply never halts drain; re-entrancy-guarded
}
```
Session keeps `applyAnswerNow` (it needs `createAnswerExecuteTurn` — session-specific) and `drainWithGuard` (busy-guard is turn lifecycle), but **delegates**: `queueAnswer` → `this.answerQueue.enqueue(...)` (throw queue-full, dedupe-replace) then `drainWithGuard` → `await this.answerQueue.drain()`; `publishAnswerFrame` → `this.answerQueue`'s `onFrame` callback. `AnswerFrameEvent` re-exported from `session.ts` for `server/*` import compatibility. **Test first:** `tests/answer-queue.test.ts` with a mock `apply` — FIFO order, 50-cap, dedupe-replace, re-entrancy, failure-continuation; existing `tests/server-answer-queue.test.ts` stays as the integration gate.

### B4. `src/core/event-bus.ts` (from session.ts L87–90 + L287–313)

```ts
export class EventBus<T extends { kind: string }> {
  subscribe(fn: (ev: T) => void): () => void;
  publish(ev: T, opts?: { skipBackfill?: (ev: T) => boolean }): void; // live fan-out always; ring push skipped when predicate true
  backfill(): T[]; // FIFO ring, cap 20
  clear(): void;
}
```
Session's `publish()` keeps its lifecycle branch (endTurn, autopilotDriver null) but replaces `subscribers`/`recentEvents` with `this.bus.publish(event, { skipBackfill: isAnswerFrame })`; the answer-frame skip predicate moves in (byte-identical). Router's SSE backfill still reads `session.recentEvents` — keep the getter. **Test first:** `tests/event-bus.test.ts` — fan-out, unsubscribe, ring cap, skipBackfill, FIFO order.

### B5. Workstream B gate

- [ ] `npx tsc --noEmit`
- [ ] `npm test` — all green (server-answer-queue + server-api + drafting-guard still pass against the refactored session/runner)
- [ ] `npm --prefix web run build`
- [ ] `tests/core-decoupling.test.ts` passes — new core leaves import only `node:`/`workspace/`/`core/`
- [ ] `grep -n "classifyTurnArtifact\|buildRevisionGuidance\|buildCriticNote" src/core/runner.ts` — call sites present, inline copies gone (`grep -c "Actionable Guidance" src/core/runner.ts` == 0)
- [ ] `grep -n "answerQueue = new AnswerQueue\|this.answerQueue.drain\|recentEvents" src/server/session.ts` — delegation present, ring array gone from session
- [ ] Commit: `refactor(core): extract artifact-guard, critic-revision, answer-queue, event-bus leaves`

---

## Workstream C — Web test runner (TDD)

### C1. Test infra

**`web/package.json`:** add devDeps `vitest` (match root version), `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`. Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`. `dependencies` untouched.

**New `web/vitest.config.ts`:**
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] }
});
```

**New `web/src/test/setup.ts`:** `import '@testing-library/jest-dom/vitest';`

**New `web/src/test/render.tsx`:** helper wrapping `render` with `userEvent.setup()` + a `cleanup` default.

**Test first:** a smoke test (`web/src/lib/portalDetail.test.ts` — moved from `tests/web-portal-detail.test.ts`, which is deleted from root; the 12 renderDetail cases run under the web runner now) proves the infra before component tests.

### C2. Component tests (the recently-shipped portal code)

- [ ] **`web/src/components/Markdown.test.tsx`** — link scheme allowlist: `https://`/`http://`/`mailto:` render as `<a>`; `javascript:alert(1)` and `data:text/html` render inert text (regression lock for 5465782 fix)
- [ ] **`web/src/components/AnswerDialog.test.tsx`** — opens with focus in textarea; backdrop-click-close only when empty (dirty guard: typed text prevents close); Esc closes (with `isComposing` guard path); Enter sends / Shift+Enter newline; submit error keeps modal open (`role="alert"` present); Cancel + Send have 44px min-height
- [ ] **`web/src/components/QuestionBar.test.tsx`** — per-item chip states (queued amber / applying cyan spinner / applied emerald / failed rose + retry), collapsed `Clock3 · n queued` counter, initial-mount announcement suppression, sr-only `aria-live` region present

Bound the suite here — full DevelopmentView SSE-integration tests are a documented follow-up (needs EventSource mock harness).

### C3. Workstream C gate

- [ ] `npm --prefix web run test` — all web tests pass (portalDetail + Markdown + AnswerDialog + QuestionBar ≥ 30 assertions)
- [ ] `npx tsc --noEmit` (root)
- [ ] `npm test` (root — still green; web-portal-detail.test.ts removed from root)
- [ ] `npm --prefix web run build`
- [ ] `grep -n '"test"' web/package.json` — script present; `grep -c "dependencies"` structure unchanged
- [ ] Commit: `test(web): add vitest + jsdom component tests for portal/markdown`

---

## Final gate + ship

- [ ] Full: `npx tsc --noEmit` && `npm test` && `npm --prefix web run test` && `npm --prefix web run build`
- [ ] `wc -l src/server/router.ts src/core/runner.ts src/server/session.ts` — ceilings: router < 450, runner < 700, session < 650
- [ ] `git log --oneline -3` — three workstream commits + plan commit
- [ ] Push to `origin/master`

## Follow-ups (not in this plan)

- DevelopmentView/useAutopilotEvents SSE-integration tests (EventSource mock harness)
- Split `src/index.ts` (741-line composition root) in a later pass
