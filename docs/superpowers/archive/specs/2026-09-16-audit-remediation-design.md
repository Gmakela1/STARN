# STARN Audit Remediation Design

**Date:** 2026-09-16
**Status:** Approved (brainstormed 2026-09-16)
**Scope:** Fixes for audit issues #2, #3, #4, #5, #7, #8, #9, #11, #13

## Purpose

Remediate nine gaps and UX issues identified in the 2026-09-16 STARN
codebase audit. Each fix is specified below with its exact behavior,
file scope, and acceptance criteria. This spec is the source of truth
the implementation plan argues from.

## Fix #2 — Agent Loop Context Window Management

**Problem:** `sessionMessages` accumulate across turns and are re-sent
in full every turn. No trimming or summarization. Long sessions exceed
context limits (DeepSeek 64k, etc.) and fail silently or degrade.

**Solution:** Implement compaction mirroring pi's approach inside
STARN's own session management.

- New module `src/core/compaction.ts`:
  - `estimateTokens(messages)` — cheap heuristic (~4 chars/token).
  - `serializeConversation(messages)` — flatten to `[User]: …` /
    `[Assistant]: …` / `[Tool result]: …` text, **truncating tool
    results to 2000 chars** (pi's rule).
  - `generateSummary({ client, model, messages })` — one LLM call
    producing pi's structured markdown format (Goal / Constraints &
    Preferences / Progress / Key Decisions / Next Steps / Critical
    Context).
  - `maybeCompact({ client, messages, compactionModel, threshold,
    keepRecent })` — checks size, compacts if over threshold. Walks
    backwards accumulating tokens until `keepRecentTokens` reached; cuts
    at turn boundaries (user-message edges); never mid-tool-call.
    Messages before cut → one summary message; after → kept verbatim.
    Rebuilt context = `[system] + [summary] + [kept recent messages]`.
- Trigger: before each turn in `runner.ts`, estimate context tokens; if
  `> threshold`, run compaction automatically. Not every turn — only
  when over the limit.
- Defaults: `compressionThreshold` = 100k tokens; `keepRecentTokens` =
  20k. User-configurable via env (`STARN_COMPACT_THRESHOLD`) and
  `config.json`.
- User visibility: context gauge in active-session header
  (`Context: 42k / 100k · Compact: <model>`). When compaction runs,
  print `• Compacting session history (87k → ~22k)…`. Fully automatic,
  no prompt.
- `/compact` manual command (pi parity) — runs compaction now using the
  configured compaction model.
- **Selectable compaction model:**
  - New config field `compactionModel?: string` in `UserConfigFile` /
    `StarnConfig` (`src/config.ts`), persisted to `~/.starn/config.json`.
    Env override: `STARN_COMPACT_MODEL`.
  - Set via: (1) initial onboarding — after working-model selection,
    offer compaction-model selection (reuse `promptSelectLiveModel`);
    (2) `/compact-model` slash command — re-runs
    `promptSelectLiveModel`, saves choice silently, prints confirmation;
    (3) `/compact` uses configured model.
  - Used inside `generateSummary()` via
    `client.chatCompletion({ model: compactionModel, ... })`,
    independent of working `selectedModel`.
  - Fallback: if `compactionModel` unset at runtime, use current working
    `selectedModel` (pi behavior).
- **Intake answers are safe** — they persist to `.starn/state.json` via
  `recordIntakeAnswer()` and re-inject via `runDiscovery()` every turn,
  so compaction cannot lose them. No special handling required.

**Files:** new `src/core/compaction.ts`; modify `src/config.ts`,
`src/core/runner.ts`, `src/cli/ui.ts`, `src/cli/prompts.ts`,
`src/index.ts`.

## Fix #3 — `state_update` Tool & Risk Storage Dualism

**Problem:** `state_update.addRisk` writes to `state.openRisks: string[]`,
but `ProjectState` also has `pendingRisks?: PendingRisk[]` (structured
`{source, section, risk}`) that the Risk Register specialist reads.
Risks orphaned in `openRisks` never reach the Risk Register.
`state_update.phase` writes `currentPhase` but not `workflow.activePhase`
or phase status map — roadmap drifts. No schema validation.

**Solution:**

- Unify on structured `pendingRisks`. Deprecate `openRisks` as a
  write target.
  - `state_update` param `addRisk` → `addPendingRisk` with structured
    params `{ source: string, section: string, risk: string }`.
  - On state load (`getOrCreateState` / `getState`), migrate any legacy
    `openRisks` string entries into `pendingRisks` as
    `{ source: 'legacy', section: 'unknown', risk: <string> }`.
    Migrate each entry once (track migrated set so re-runs are
    idempotent).
  - Keep `openRisks` field read-only for backward compat (do not
    delete; just stop writing to it). Or drop entirely after migration
    — decision: keep read-only, empty after migration.
- Fix `phase` sync: `state_update.phase` calls the same logic as
  `stateManager.setActivePhase()` so `currentPhase`,
  `workflow.activePhase`, and the per-phase status map all update
  together. LLM retains phase-switch ability (driven by classification).
- Add Zod validation on `state_update` args (reject junk):
  - `action`: optional string.
  - `phase`: optional string (must be a valid phase id or null).
  - `addPendingRisk`: optional object `{ source, section, risk }`.
- `action` / `recentActions` stays freeform (not structured). It's a
  lightweight audit trail, functioning fine as-is.

**Files:** modify `src/workspace/types.ts`, `src/workspace/state.ts`,
`src/tools/handlers/state-update.ts`. Add Zod (already a dependency).

## Fix #4 — Discovery Scan Scope

**Problem:** `runDiscovery` scans entire project recursively, skipping
only `.git`, `node_modules`, `.starn`. Lists `dist/`, `tests/`,
`testbed/`, logs, binaries — bloats context on every turn.

**Solution:**

- Hardcoded default exclusion list in `src/core/discovery.ts`:
  - Directories: `dist`, `build`, `tests`, `testbed`, `.pi`, `.vscode`,
    `.idea`, `coverage`.
  - Files: `*.log`, `*.wav`, `*.mp3`, `package-lock.json`, `yarn.lock`,
    `tsconfig.json`, `.gitignore`, `.env*`.
- Keep scanning `reference/` and `examples/` — enumerate filenames in
  the briefing (LLM needs names to decide what to `fs_read`).
- No `.starnignore` user-control file (YAGNI).

**Files:** modify `src/core/discovery.ts`.

## Fix #5 — Section 6 Dead Code Removal

**Problem:** `section6-resolver.ts` contains dead but dangerous code:
`resolveSection6()`, `foldAnswerIntoDoc()`, `removeSection6()` — a
regex-patching path that caused three historic data-loss bugs. The live
flow (`collectOpenQuestions`) is correct, but the dead code is importable
and a maintenance hazard.

**Solution:**

- Delete from `src/cli/section6-resolver.ts`:
  - `resolveSection6()` function.
  - `foldAnswerIntoDoc()` function.
  - `removeSection6()` function.
  - `ResolveSection6Options` interface.
  - `collectSection6Answers()` function (dead alias).
  - Remove now-unused `path` and `ProjectStateManager` imports if no
    longer referenced.
- Keep `parseSection6Questions` (1-line alias for
  `parseOpenQuestionsFromContent`) — 3 test files depend on it.
- Keep `collectOpenQuestions`, `parseOpenQuestionsFromContent`,
  `countOpenQuestions`, `hasUnresolvedQuestions`, `CollectedAnswer`.
- Sharpen `collectOpenQuestions` JSDoc: this is the ONLY sanctioned
  resolution path; never write answers to disk via regex patching or
  run resolution after the agent loop.
- Rewrite `tests/section6-data-loss.test.ts`:
  - Remove inline copies of `foldAnswerIntoDoc` / `removeSection6`
    (they tested phantom code).
  - Remove "Bug 1" / "Bug 2" describe blocks that exercise phantom
    functions.
  - Keep "Fix verification" tests asserting live
    `collectOpenQuestions` contract (returns Q&A pairs, doesn't touch
    disk, answerBlock format correct).
  - Keep regression history in a comment header.

**Files:** modify `src/cli/section6-resolver.ts`,
`tests/section6-data-loss.test.ts`.

## Fix #7 — Classifier Hardcoded Phase-Locking Keywords

**Problem:** `classifyRequest` has an `isEditFeedback` pre-check with
six tractor-specific nouns (`battery`, `motor`, `charger`,
`compartment`, `seat`, `display`) that misfire for other project types
and override the LLM classifier.

**Solution:** Option C + Reading 1.

- **Invert precedence:** run the LLM classifier first.
- On LLM failure or unparseable output, fall back to the keyword
  heuristic (generic edit verbs only).
- Delete the six tractor-specific nouns from `isEditFeedback`.
- Keep generic verbs: `update`, `change`, `add`, `revise`, `edit`,
  `fix`, `include`, `modify`, `instead of`, `change the`, `add a`,
  `remove the`, `feedback`, `correction`, `wrong`, `that should be`,
  `should say`.
- When the fallback fires and the user is in an active formal phase,
  route to that active phase (known from state).

**Files:** modify `src/core/classifier.ts`.

## Fix #8 — Checkpoint UI Richness

**Problem:** Checkpoint shows a small preview (title, word count, ~8
headings). "View Full Document" dumps entire markdown inline, no
pagination. Critic results hidden on pass. Users approve blind.

**Solution:** Three-panel checkpoint layout + section browser + chunked
pager.

- **Panel 1 — Critic scorecard (always shown):** revive
  `formatCriticScorecard` (currently dead on pass). Show score, summary,
  strengths, weaknesses (both fields always present even if weaknesses
  empty), actionable guidance. Distinct boxed panel.
- **Panel 2 — Document TOC:** full two-level TOC (`##` and `###`), all
  headings, indented. Title, word count, line count.
- **Panel 3 — Action menu:**
  - `👁 Browse sections` — numbered list of sections; user picks →
    **show the whole section** (full content of that section). If a
    section is huge, chunk-page within it.
  - `📄 View full document (paged)` — B-style chunked pager from the
    top (40 lines/page, "Enter = next, s = skip to end, q = back to
    menu").
  - `✔ Accept & save` / `✎ Provide feedback` / `✖ Discard` (existing).
- **Chunk/page size:** 40 lines, adapting to `process.stdout.rows` when
  available.
- **No diffs** (out of scope).

**Files:** modify `src/cli/checkpoint.ts`, `src/cli/ui.ts`.

## Fix #9 — Reopen Approved Artifacts + Auto Change-Impact on Re-approve

**Problem:** Once a deliverable is approved, there's no way to reopen
it. The only workaround (`/goto` + edit feedback) leaves state
inconsistent (artifact still marked approved, downstream unlocked).

**Solution:**

- **Reopen via `/goto`:** when `/goto <phase>` targets a phase whose
  artifact is currently `approved`, prompt:
  *"CONOPS is currently approved. Switching to it will revert it to
  draft so you can revise. [Downstream phases that will re-lock]. Continue? (y/n)"*
  - On yes: artifact status → `draft`; workflow phase → `in_progress`
    (drafted); document stays on disk; **downstream re-locks
    (transitive closure — all phases after X in workflow order)**;
    reprint roadmap + one-line hint ("you'll get an impact report when
    you re-approve").
  - On no: cancel, stay where you are.
  - Non-approved targets: no prompt, current behavior.
- **Re-approve with hash detection:**
  - New field on `ArtifactRecord`: `approvedContentHash?: string`
    (SHA-256 of approved doc content, via Node
    `crypto.createHash('sha256')`).
  - On checkpoint `accept`: compute current doc hash; compare to stored
    `approvedContentHash`. If the artifact was previously approved
    (hash exists) AND hash differs → this is a re-approval with changes.
- **Auto change-impact on re-approval with changes:**
  - Run the change-impact specialist against the re-approved doc and
    all other approved/draft docs.
  - **Print impact report inline** at the checkpoint.
- **Align downstream docs:**
  - After the inline report, offer the user a choice to apply the
    changes to downstream docs.
  - On yes, construct the next prompt = inline change-impact report +
    user's alignment command, and feed it as the next turn so the
    affected downstream specialists pick it up and revise their docs
    (classifier routes to the affected specialist, not to change-impact
    itself).
- Status name for reopened artifact: `draft` (roadmap shows
  `◐ DRAFTED`).

**Files:** modify `src/workspace/types.ts`, `src/workspace/state.ts`,
`src/cli/checkpoint.ts`, `src/index.ts`, `src/core/runner.ts` (for
change-impact auto-run + alignment prompt routing).

## Fix #11 — TypeScript Compilation Check in Test Pipeline

**Problem:** `package.json` `"test": "vitest run"` uses esbuild
transpile-on-the-fly, which strips types without checking them. Type
errors pass tests green, only surface at `npm run build`.

**Solution:**

- Change `package.json`:
  ```json
  "test": "tsc --noEmit && vitest run"
  ```
- Baseline verified clean (2026-09-16: `tsc --noEmit` exits 0, zero
  errors).

**Files:** modify `package.json`.

## Fix #13 — Logging & Error Recovery

**Problem:** No centralized logging. No retry on transient API failures
(429, 5xx, network). No rate-limit awareness. Generic try/catch
swallows errors.

**Solution:**

- **Logging (Part A — file logger):**
  - New module `src/util/logger.ts`.
  - Writes structured logs to `.starn/logs/starn-<date>.log` with levels
    (error/warn/info), timestamped. Captures specialist ID, turn number,
    tool calls, API errors.
  - Survives process exit; user can grep it.
  - Wire into `OpenRouterClient` (log requests/errors), `runner.ts`
    (log turns), classifier/critic (log malformed-JSON fallbacks).
- **Retry (Part B — exponential backoff in `OpenRouterClient`):**
  - On 429 / 5xx / network error, retry with backoff: 1s, 2s, 4s, max 3
    attempts.
  - Respect `Retry-After` header when present.
  - Show spinner during retry ("Rate limited, retrying in 2s…").
  - Contained to `OpenRouterClient`; agent loop and critic loop tolerate
    via client retry (no separate loop-level resilience).
- **Malformed-JSON resilience:** classifier and critic both regex-extract
  JSON with silent fallbacks. **Log when fallbacks fire** (cheap,
  diagnostic). Leave fallback behavior as-is (no JSON-retry).
- **SIGINT handling:** catch SIGINT in `src/index.ts` to save state and
  print "session saved" instead of raw crash.

**Files:** new `src/util/logger.ts`; modify `src/openrouter/client.ts`,
`src/core/runner.ts`, `src/core/classifier.ts`, `src/core/critic.ts`,
`src/index.ts`.

## Implementation Order

Fixes implemented back-to-back, each fully proven before the next:

1. **#11** (tsc gate) — cheapest, unblocks type-safety for all
   subsequent fixes.
2. **#13** (logger + retry) — foundation the others build on.
3. **#3** (state & tools) — state changes precede #9.
4. **#5** (Section 6 dead code) — independent, quick.
5. **#4** (discovery scope) — independent, quick.
6. **#7** (classifier) — independent.
7. **#2** (compaction) — largest, needs #13's logger.
8. **#8** (checkpoint UI) — precedes #9 (panels reused).
9. **#9** (reopen + auto change-impact) — depends on #3 state fields
   and #8 checkpoint panels.

## Global Constraints

- TypeScript preferred. `strict: true` already on.
- OpenRouter only. No new external API dependencies.
- Zod already a dependency (no new dep for #3).
- Node built-in `crypto` for SHA-256 (no new dep for #9).
- No new runtime dependencies for #2 (custom token estimator, no
  tiktoken).
- Config via env vars + `~/.starn/config.json` (existing pattern).
- All fixes must pass `tsc --noEmit && vitest run`.
