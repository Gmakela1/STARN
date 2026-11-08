# fs_edit Tool — Targeted Document Editing Design

**Date:** 2026-09-16
**Status:** Approved (brainstorming complete)
**Path:** Architectural — new tool, handler, context extension, runner wiring, critic wiring, specialist prompt changes.

## Problem

STARN edits drafted documents by whole-file overwrite (`fs_write`). When a
user gives feedback on a drafted artifact, the runner reads the existing doc,
injects its **full text** into the system prompt with "EVOLVE / UPDATE"
instructions, and the model calls `fs_write` with the entire document content.
The intent is surgical edit; the mechanism is destructive full rewrite.

Consequences:
- **Drift:** the model may silently rephrase unaffected sections, reorder
  bullets, or drop paragraphs. The user has no diff at the checkpoint.
- **Content loss:** dropped content is gone (no prior version retained).
- **Token waste:** a one-line tweak to a 30-page SOW costs a full 30-page
  generation. Cost scales with doc size, not edit size.
- **Blind critic:** the critic grades the new draft against the rubric but is
  not told what changed, so it cannot verify the feedback was actually
  addressed or that the edit didn't break downstream sections.

## Goals

1. **Limit drift** — only the quoted region of a document changes; the rest is
   byte-for-byte preserved.
2. **Whole-document critic review** — the critic still reviews the full
   updated document, **and** receives a change log so it can verify the
   intended changes and check for downstream breakage.
3. **Lower token usage** — output cost scales with edit size, not doc size.
4. **Recoverability** — prior versions retained so silent drift is detectable
   and undoable.
5. **Preserve whole-project understanding** — the model still reads the full
   doc + discovery + program baselines every turn (input unchanged); only the
   output becomes targeted.

## Non-Goals

- No dedicated `plan_edit` tool or gated plan mode. The model reasons in plain
  text before each tool call (existing pattern); `fs_edit` returns context for
  verification.
- No new `grep`/search tool (hold for later; `fs_read` and the failure
  response's line-numbered doc cover the edit-time search need).
- No diff display at the checkpoint (out of current scope; version files
  enable a future diff feature).
- No removal of `fs_write` — it remains for initial draft creation and as a
  fallback for legitimate full restructures.

## Design

### 1. Tool schema

```
fs_edit(path, edits[])
  path: string    — relative path within the project, must resolve under docs/
  edits[]: array of {
    old_text: string  — must match exactly once in the current file contents
    new_text: string  — replacement text (empty string = deletion)
  }
```

- **List semantics:** edits in a batch are applied in order. Each `old_text`
  must match exactly once in the file **at apply time** (after prior edits in
  the same batch have been applied). This permits chained edits where one
  edit's `new_text` creates the text a later edit targets.
- **Atomicity:** if any edit in the batch fails to match (zero or >1 hits),
  the entire batch is rejected and **no write occurs**. The file on disk is
  untouched. This prevents half-applied edits from corrupting the document.
- **`new_text` semantics:** may be empty (deletion), equal length (in-place
  tweak), or larger (insertion / regional rewrite). The model may rewrite a
  whole section by quoting the section's full text as `old_text` and providing
  the new section as `new_text` — this is the escape hatch for larger changes
  without falling back to `fs_write`.
- **Tool description (visible to the model):** "Apply targeted edits to an
  existing document. Quote `old_text` verbatim from the document; it must
  appear exactly once. Reason about what section to change and why before
  calling. Use `fs_write` only for initial creation of a new deliverable."

### 2. Handler behavior

**Handler file:** `src/tools/handlers/fs-edit.ts`, exported as `fsEditHandler`,
registered in `src/tools/registry.ts`.

**Algorithm:**
1. Resolve `path` against `projectPath`; apply the path-traversal guard
   (reject if outside `projectPath`).
2. **Scope guard:** reject if the resolved path is not under `docs/`
   (artifacts only live under `docs/`). This prevents the model from editing
   state files, examples, or config.
3. Read the current file contents. If the file does not exist, return an error:
   "File does not exist. Use `fs_write` to create a new file." (`fs_edit` is
   for modifying existing docs only.)
4. **Version backup:** copy the current contents to
   `.starn/versions/<DOCNAME>-<ISOtimestamp>.md` (create `.starn/versions/`
   if missing). Prune to the most recent 10 versions per doc name (delete
   older backups for that doc name).
5. **Verify + apply in memory:** for each edit in order, search the current
   in-memory contents for `old_text`. If it matches exactly once, replace it
   with `new_text` and continue. If it matches zero or 2+ times, abort the
   entire batch — do not write, do not create the version backup's sibling
   (the version backup is created before verification, but since no write
   occurs the file is unchanged; the extra version copy is harmless and
   represents the pre-attempt state, which is accurate).
6. **Write once:** if all edits verified and applied, write the patched
   contents to disk (single `fs.writeFileSync`).
7. **Log edits:** append each applied edit to `context.editLog` (see §4).
8. **Return success response** (see below).

**Success response format** (returned as `result` string):
```
Applied 2 edit(s) to docs/CONOPS.md:
[1] L42-48 (matched once): old_text → new_text
    context after edit (3 lines):
      ## 3.2 Power System
      The power system uses a 48V LiFePO4 bank...
      ...
[2] L110 (matched once): "TBD: battery size" → "48V 100Ah LiFePO4"
```
- Line numbers are 1-indexed, computed from the patched file.
- Context shows the first 3 lines of the `new_text` region in the patched
  file. This is the Claude-Code-style verification feedback — the model can
  confirm it hit the intended location.

**Failure response format** (no write occurred):
```
Edit batch rejected: "TBD: battery size" matched 0 times (must match exactly once).
No changes written to docs/CONOPS.md.
File contents with line numbers (re-quote a unique snippet):
    1 | # CONOPS
    2 | ...
  108 | ## 6 Open Questions
  109 | - What battery size should we use?
  110 | - TBD: motor controller
  ...
```
- The entire file is returned with 1-indexed line-number prefixes so the model
  can re-target. This is the "search for where the quote is" capability — the
  model sees the actual current contents with addresses.
- Prefix format: right-aligned line number, space, `|`, space, content.

### 3. Version history (drift safety net)

- **Location:** `.starn/versions/` inside the project.
- **Trigger:** before any write that overwrites an existing artifact — both
  `fs_edit` (always, since it edits existing docs) and `fs_write` (only when
  the target file already exists; initial creation does not back up).
- **Naming:** `<DOCNAME>-<ISOtimestamp>.md` where DOCNAME is the file's base
  name without extension (e.g. `CONOPS-2026-09-16T14-22-03-000Z.md`).
  Timestamps use a filesystem-safe ISO format (`:` replaced with `-`).
- **Retention:** keep the 10 most recent versions per doc name; delete older.
  Pruning runs after each backup creation, scoped to that doc name.
- **Why both tools:** `fs_write` on an existing doc is the destructive
  overwrite path — it must back up too, or a model that falls back to
  `fs_write` would bypass version retention. The backup is in `fs-edit.ts`
  for `fs_edit` and added to `fs-write.ts` for the overwrite case.
- **No git dependency:** STARN does not commit user docs; version files are
  plain filesystem copies. A future web UI can render diffs from these.

### 4. Change log for the critic

**Context extension** — `ToolExecutionContext` gains an optional field:
```typescript
editLog?: EditEntry[];
```
where:
```typescript
interface EditEntry {
  path: string;
  oldText: string;
  newText: string;
  matchedLineRange: { start: number; end: number };  // 1-indexed, in patched file
  timestamp: string;  // ISO
}
```

- The `fs_edit` handler appends one `EditEntry` per applied edit to
  `context.editLog` (mutating the array; the runner owns the array lifetime).
- **Runner responsibility:**
  1. Before each specialist turn, the runner constructs the context with a
     fresh `editLog: []`.
  2. After the agent loop completes (and after any auto-revision loops), the
     runner reads `context.editLog`.
  3. The runner passes `appliedEdits: context.editLog` to the critic
     evaluation alongside `artifactContent` (the full updated doc read from
     disk — unchanged from today's `fs.readFileSync` path).
  4. After the critic runs, the runner does **not** need to explicitly clear
     `editLog` for a fresh specialist turn — a fresh context is built per turn.
     **However**, the auto-revision sub-loop currently reuses one context
     object across revision iterations; the implementation must reset
     `context.editLog = []` at the start of each revision iteration so the
     critic sees only that revision's edits, not accumulated edits across
     all revisions.

**Critic prompt addition** (in `critic.ts`):
> "The following targeted edits were applied this turn:
> [for each edit: path, old_text → new_text, line range]
> Verify these changes address the user's feedback and do not introduce drift
> or break cross-document alignment. The full updated document is also
> provided below — review it in its entirety, focusing attention on the
> edited regions and their downstream effects."

The critic still reviews the **whole document** (requirement). The change log
focuses the critic's attention and lets it verify intent ("did the edit
address the feedback") in addition to overall quality.

### 5. Specialist prompt + runner wiring

**Specialist prompts** — every specialist package's `systemPrompt` gets a
shared appendum (maintained once, applied to all packages via the runner's
prompt assembly or a shared constant):
> "When the deliverable document already exists on disk, make changes using
> the `fs_edit` tool with targeted `{old_text, new_text}` edits — never
> rewrite the whole document via `fs_write`. Quote `old_text` verbatim from
> the document; it must match exactly once. Reason about what section to
> change and why before calling. Use `fs_write` only for the initial creation
> of a new deliverable file."

Implementation: add a `SHARED_EDIT_INSTRUCTIONS` constant (e.g. in
`src/specialists/types.ts` or a new `src/specialists/shared.ts`) and append it
in the runner where `enhancedSystemPrompt` is assembled, so it applies to all
specialists without editing 14 package files. (This also keeps the specialist
packages pure-data, aligned with AGENTS.md's I/O-agnostic principle.)

**Runner** (`runner.ts`):
- When `existingBaselineText` is non-empty (the doc exists), append an extra
  instruction to the system prompt: "A draft exists at `docs/<X>.md` — use
  `fs_edit` to apply the requested changes to it. Do not use `fs_write` to
  overwrite the existing draft."
- Add `'fs_edit'` to every specialist's `allowedTools`. Both `fs_write` and
  `fs_edit` are available; the prompt governs which the model chooses. (Hard
  enforcement was rejected — see Approaches.)
- The existing `existingBaselineText` block is unchanged: the full doc text is
  still injected into the system prompt so the model has whole-project
  understanding on input.
- The critic invocation passes `appliedEdits: context.editLog` (new parameter
  on `CriticEvaluator.evaluate`).

**Tool registry:** register `fsEditHandler` in the `ToolRegistry`
constructor.

**Tool allow-lists:** add `'fs_edit'` to each specialist package's
`allowedTools` array. To avoid editing 14 files, the runner may inject
`'fs_edit'` into the allowed list at runtime if not present — or each package
declares it. Decision: each package declares `'fs_edit'` in its `allowedTools`
explicitly (keeps the allow-list the source of truth per AGENTS.md's
"strictly scoped per specialist" principle). This is a one-line-per-package
edit.

### 6. Testing

- **Handler unit tests** (`tests/fs-edit-handler.test.ts`):
  - Atomic apply: multi-edit batch where all match → file patched, all edits
    logged, version backup created.
  - No-match rejection: one edit's `old_text` absent → no write, file
    untouched, no editLog entries, line-numbered response returned.
  - Ambiguous-match rejection: `old_text` matches 2+ times → no write,
    line-numbered response.
  - Chained edits: edit 2's `old_text` exists only after edit 1 applies →
    succeeds (apply-time matching).
  - Deletion: empty `new_text` → region removed.
  - Path traversal: `../etc/passwd` → rejected.
  - Scope guard: path outside `docs/` (e.g. `state.json`) → rejected.
  - Non-existent file: `fs_edit` on a missing file → error directing to
    `fs_write`.
  - Version pruning: create 12 versions, assert only 10 retained.
  - Success response format: contains line numbers and context lines.
  - Failure response format: contains line-numbered file contents.
- **fs_write backup test** (`tests/fs-write-handler.test.ts` addition):
  - Overwrite of existing file creates a version backup; initial creation
    does not.
- **Integration test** (`tests/fs-edit-integration.test.ts`):
  - Seed a drafted `docs/CONOPS.md`; construct a context with `editLog: []`;
    call `fs_edit` with a targeted change; assert only the quoted region
    changed (diff the rest), assert `editLog` has one entry, assert version
    backup exists.
- **Critic wiring test** (`tests/critic-edit-log.test.ts`):
  - Mock client; runner with a drafted doc; apply an edit via the agent loop;
    assert the critic call received `appliedEdits` matching the editLog.
- **Regression:** existing `fs_write` path tests pass unchanged; existing
  specialist tests pass; `tsc --noEmit` clean; full `vitest run` green.

## Architecture boundary note (AGENTS.md alignment)

This design adds a new tool handler (`src/tools/handlers/fs-edit.ts`) and
extends `ToolExecutionContext` (in `src/tools/types.ts`). Neither touches
`src/cli/*`. The critic change is in `src/core/critic.ts`. The runner change
is in `src/core/runner.ts`. The shared edit-instructions constant lives in
`src/specialists/`. All terminal/UI code is untouched — consistent with the
AGENTS.md principle that `core/*` must not import from `cli/*` and that the
presentation layer is a swappable adapter.

## Summary of files touched

| File | Change |
|---|---|
| `src/tools/handlers/fs-edit.ts` | **New** — handler + atomic apply + version backup + editLog |
| `src/tools/handlers/fs-write.ts` | Add version backup on overwrite |
| `src/tools/registry.ts` | Register `fsEditHandler` |
| `src/tools/types.ts` | Add `EditEntry` interface + `editLog?` on context |
| `src/core/runner.ts` | Fresh `editLog` per turn; pass `appliedEdits` to critic; `fs_edit` in allow-lists; shared edit instructions in prompt |
| `src/core/critic.ts` | Accept `appliedEdits`; include in critic prompt |
| `src/specialists/shared.ts` (new) or `types.ts` | `SHARED_EDIT_INSTRUCTIONS` constant |
| `src/specialists/packages/*/index.ts` | Add `'fs_edit'` to each `allowedTools` |
| `tests/fs-edit-handler.test.ts` | **New** — handler unit tests |
| `tests/fs-edit-integration.test.ts` | **New** — integration test |
| `tests/critic-edit-log.test.ts` | **New** — critic wiring test |
| `tests/fs-write-handler.test.ts` | Addition — version backup on overwrite |

## Open questions (none blocking)

- Should the version retention count (10) be configurable via env var? Defer
  until a user asks; hardcode 10 for now.
- Should the critic's `appliedEdits` be shown in the checkpoint UI? Likely
  yes (a "Changes this turn" panel), but that's a presentation-layer addition
  and out of this spec's scope. Track as a follow-up.
