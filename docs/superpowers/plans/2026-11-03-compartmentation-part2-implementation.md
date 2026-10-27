# Compartmentation Part 2 — Runner + Session De-fattening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining compartmentation gap from Part 1: get `src/core/runner.ts` (764 lines) under 700 and `src/server/session.ts` (665 lines) under 650 by extracting critic-input loading, the repeated aborted-turn builder, the critic-iteration decision, and the whole checkpoint-resolution state machine into testable core leaves.

**Architecture:** Same pattern as Part 1 — behavior-preserving extraction. New core leaves with injected deps where execution context is needed; byte-identical strings; the existing 563 root tests + 34 web tests are the contract. Two zero-overlap workstreams: D1 touches only `runner.ts` + new core files; D2 touches only `session.ts` + new core file.

**Tech Stack:** TypeScript (strict), vitest (root, node env). No new dependencies of any kind.

**Spec:** Continuation of `docs/superpowers/plans/2026-11-03-compartmentation-improvements-implementation.md` (Global Constraints + Review Focus carry over). No separate design doc — extraction decisions are documented below.

## Global Constraints (inherited from Part 1 plan)

- **Behavior preservation is the spec.** The 563 root tests must stay green at every gate (esp. `core-loop`, `critic-delta`, `critic-edit-log`, `drafting-guard`, `runner-autopilot-hooks`, `server-api`, `server-answer-queue`).
- **No new dependencies. `package.json`/`package-lock.json`/`web/package.json` untouched** (git diff must be empty at the end).
- **AGENTS.md layering:** new `core/*` leaves import only `node:*`, `workspace/*`, `core/*`. `tests/core-decoupling.test.ts` keeps passing.
- **TDD per task:** failing test first → minimal implementation → module tests + full gate.
- **TOOLS:** read + edit/write + bash (tsc/test/build only). NO python, NO sed, NO extraction scripts, NO /tmp, NO npm install.

## Review Focus

1. **Byte fidelity:** every moved string (status copy, error messages, note formats) identical; the three aborted-turn returns collapse into ONE builder with identical field values.
2. **Loop semantics:** the critic while-loop's pass/revise/give-up control flow and `attempts`/`maxAttempts` accounting unchanged after `decideCriticIteration` extraction — `attempts++` only on revise, `give-up` only when `attempts >= maxAttempts` and not passed.
3. **Checkpoint parity:** `resolveCheckpoint` outcome for approve keeps disk-file-preference (`# `-headed on-disk content beats turn output), same `savedPath` relative-path normalization, same `nextPhase` (read from `stateManager.getState().workflow.activePhase` AFTER approveArtifact), same errors ('No checkpoint is pending'), same `discard`/`revise` returns.
4. **Type re-exports:** `PendingCheckpoint`/`CheckpointDecision` move to core with session re-exporting so `src/server/routes/*` and `src/cli/checkpoint.ts` imports keep compiling.
5. **No scope creep:** D1 touches runner.ts + `tests/*` + 2 new core files. D2 touches session.ts + `tests/*` + 1 new core file. The stray `docs/superpowers/specs/2026-10-27-*.md` file is NOT part of any commit — never read, never staged.

---

## Workstream D1 — De-fat `runner.ts` (764 → < 700)

### D1a. `src/core/critic-inputs.ts` — baseline + examples loading

Move verbatim from runner.ts (currently inside the critic while-loop body):
```ts
export interface BaselineDocumentLike { id: string; path: string; content: string; }
export function loadProgramBaseline(projectPath: string, specialistId: string): BaselineDocumentLike[];
// reads docs/*.md (excluding the specialist's own id, excluding empty content), returns { id, path, content }
export function loadUserExamples(projectPath: string, specialistId: string): string[];
// reads examples/<specialistId>/*.md|*.txt
```
Runner's loop calls these once each (they were inside the loop today but are loop-invariant — loading once before the loop is behavior-identical; verify the originals are loop-invariant before moving them out — they read the same files every iteration). Imports: `node:fs`, `node:path`. **Test first:** `tests/critic-inputs.test.ts` with temp-dir fixtures — baseline excludes own id + empty files, includes others; examples reads md+txt only.

### D1b. `buildAbortedTurnResult` — collapse the 3 duplicated aborted returns

The identical `{ specialistId, specialistName, output: '', autoRevisionsRun, requiresReview: false, sessionMessages, aborted: true }` block appears at 3 call sites. Extract:
```ts
// in src/core/runner.ts or a tiny local helper — check where TurnResult is defined; if runner.ts owns the type, keep the helper in runner.ts (no new file needed for this one)
function buildAbortedTurnResult(specialistId: string, specialistName: string, autoRevisionsRun: number, sessionMessages: ChatMessage[]): TurnResult;
```
**Test first:** fold into `tests/runner-*` assertions — assert an abort (signal) returns the identical shape at all 3 sites (existing `core-loop-abort`/`agent-loop-abort` tests cover this; add one explicit shape assertion).

### D1c. `decideCriticIteration` — the loop decision rule

```ts
export type CriticIterationDecision = 'pass' | 'revise' | 'give-up';
export function decideCriticIteration(result: CriticResult, attempts: number, maxAttempts: number): CriticIterationDecision;
// passed → 'pass'; attempts < maxAttempts → 'revise'; else → 'give-up'
```
Runner uses it in place of the inline `if (criticResult.passed) ... if (attempts < maxAttempts) ...` — same accounting (`attempts++`/`autoRevisionsRun++` stay in runner at the revise branch). **Test first:** `tests/critic-iteration.test.ts` — pass at any attempts; revise while under cap; give-up at cap; boundary attempts === maxAttempts.

### D1d. Gate D1

- [ ] `npx tsc --noEmit`
- [ ] `npm test` — all green (563 + new)
- [ ] `npm --prefix web run test` — 34 still green
- [ ] `npm --prefix web run build`
- [ ] `wc -l src/core/runner.ts` < 700
- [ ] `grep -c "aborted: true" src/core/runner.ts` == 0 (builder used)
- [ ] `grep -n "loadProgramBaseline\|loadUserExamples\|decideCriticIteration" src/core/runner.ts` — call sites present
- [ ] `git diff --stat package.json package-lock.json web/package.json` — empty
- [ ] Commit: `refactor(core): de-fat runner.ts — critic-inputs + aborted-result + iteration decision`

---

## Workstream D2 — Extract session checkpoint resolution (665 → < 650)

### D2a. `src/core/checkpoint-resolution.ts`

Move the whole `resolveCheckpoint` decision body (session.ts L574–617) into a core leaf with injected execution deps:
```ts
export type CheckpointDecision = 'approve' | 'revise' | 'discard'; // moved from session
export interface PendingCheckpoint { /* moved verbatim from session.ts L42 */ }
export interface CheckpointResolutionDeps {
  readDiskArtifact: (outPath: string) => string | null; // returns trimmed content if '# '-headed else null (fallback to turn output)
  approve: (args: ApproveArtifactInput) => Promise<void>;
}
export type CheckpointOutcome =
  | { status: 'discarded' }
  | { status: 'revision_requested'; revisionPrompt: string }
  | { status: 'approved'; savedPath: string; nextPhase: string };
export async function resolvePendingCheckpoint(
  pending: PendingCheckpoint,
  decision: CheckpointDecision,
  feedback: string | undefined,
  deps: CheckpointResolutionDeps
): Promise<CheckpointOutcome>;
```
Imports: `enrichFeedbackWithCritic` + `CriticResult` from `./critic.js`, `approveArtifact` + `ApproveArtifactInput` from `./approvals.js` — all core. `readDiskArtifact` injected (session provides the fs read + `# ` check verbatim); `approve` injected (session provides `args => approveArtifact({...pending, runChangeImpact: phaseId => this.runChangeImpactForApproval(phaseId)})`).
Session: `resolveCheckpoint` becomes a thin call — keep its `'No checkpoint is pending'` throw, build `outPath`, inject `readDiskArtifact` + `approve`, call `resolvePendingCheckpoint`, return the outcome (with `status: 'approved'` + nextPhase unchanged). Re-export `CheckpointDecision`/`PendingCheckpoint` from session so `src/server/routes/*` + `src/cli/checkpoint.ts` still compile.
**Test first:** `tests/checkpoint-resolution.test.ts` with mock deps — discard clears + returns discarded; revise enriches feedback via the real `enrichFeedbackWithCritic` (assert revisionPrompt contains feedback + critic guidance); approve: disk artifact preferred over fallback when `# `-headed, fallback used when disk null, `approve` called with exact args (specialistId, content, title, criticScore), nextPhase read after approve; missing pending → session's throw unchanged (test at session level via existing server tests).

### D2b. Gate D2

- [ ] `npx tsc --noEmit`
- [ ] `npm test` — all green (server-api, server-autopilot, server-answer-queue + new)
- [ ] `npm --prefix web run test` — 34 still green
- [ ] `npm --prefix web run build`
- [ ] `wc -l src/server/session.ts` < 650
- [ ] `grep -n "resolvePendingCheckpoint" src/server/session.ts` — thin call present; inline approve body gone (`grep -c "approveArtifact({" src/server/session.ts` == 0)
- [ ] `tests/core-decoupling.test.ts` green (new leaf imports only core/workspace/node)
- [ ] `git diff --stat package.json package-lock.json web/package.json` — empty
- [ ] Commit: `refactor(server): extract checkpoint resolution to core leaf`

---

## Final gate + ship

- [ ] Full: `npx tsc --noEmit` && `npm test` && `npm --prefix web run test` && `npm --prefix web run build`
- [ ] `wc -l src/core/runner.ts src/server/session.ts` — runner < 700, session < 650
- [ ] `git log --oneline -3` — two workstream commits present
- [ ] Push to `origin/master`
