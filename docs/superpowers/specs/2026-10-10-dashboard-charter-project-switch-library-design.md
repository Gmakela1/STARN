# Dashboard Polish, Charter, Project Switching & Library — Design

**Date:** 2026-10-10
**Status:** Approved in chat (sections 1–3); pending written-spec review
**Precedes:** Sub-project 3 (Parts pipeline)

## Intent

User-reported defects and gaps on the dashboard, briefing, and settings, plus
two new inputs (quality examples, reference documents). The CLI mirrors every
browser capability using shared headless logic.

Success:
- Roadmap reads as a connected serpentine with arrows between cards and rows.
- Briefing never clips; Financial rollup begins page 2.
- Overview/charter uses full width, rendered as subsections.
- User can switch project from Settings (known list or folder browser) and `/project`.
- User can drop example docs per document (Development) and reference docs (Library); Library lists and removes both.

## Non-goals

Native OS file dialogs; uploading arbitrary binaries as examples; AI-generated
charter text; budget in charter; multi-project concurrency.

## 1. Visual fixes & charter

### 1.1 Roadmap snake — `web/src/components/TreasureMapRoadmap.tsx`
- `lg`+: 4 cards per row with arrow cells between cards: `→` rows 1 and 3, `←` row 2 (visual order reversed, DOM order sequential). Row-end `↓` connectors: right edge 1→2, left edge 2→3, right edge 3→4.
- Arrows are inline SVG in dedicated grid gutter columns (`grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]`), not absolute divs.
- Arrow leaving an approved phase: solid emerald; otherwise dashed slate. `aria-hidden`.
- Below `lg`: single column, `↓` between every card.

### 1.2 Charter in CONOPS — `src/specialists/packages/conops/index.ts`
- Section 1 heading becomes `## 1. Project Overview & Charter`.
- Required `###` subsections, in order: `Background & Problem`, `Purpose`, `Objectives`, `Success Criteria`, `Scope` (with **In scope** / **Out of scope** lists), `Users & Stakeholders`, `Key Constraints & Assumptions`, then `System-Level Capabilities` (kept last; Architecture depends on it).
- Sections 2–6 unchanged (Section 6 numbering is load-bearing).
- Secret-sauce example and critic rubric criterion 1 updated to the new Section 1 structure. Rubric adds: charter subsections present, grounded in user answers, no budget.
- Architecture prompt keeps referencing "System-Level Capabilities section in Section 1" (still true).

### 1.3 Charter extraction — `src/core/conops-overview.ts` (headless)
- `extractConopsCharter(md): CharterSection[]` where `CharterSection = { heading: string; body: string }`.
  - Collects `###` subsections inside Section 1 (`## 1.` until next `##`), excluding `System-Level Capabilities`.
  - Intro prose between `## 1.` and first `###`, if any, becomes a leading `{heading: 'Overview'}`.
  - Legacy CONOPS with no subsections → single `Overview` entry. No Section 1 → `[]`.
- `extractConopsOverview` unchanged in contract; when Section 1 has no intro prose, it returns the `Purpose` body, else the first charter body, else `null`.
- `ProjectInfoResponse` (server + `web/src/types/api.ts`) gains `charter: CharterSection[]` (`[]` when no CONOPS). `summary`/`summarySource` unchanged.

### 1.4 Dashboard overview — `web/src/views/DashboardView.tsx`
- Remove `max-w-2xl`; header row (badges, title, export button) above a full-width body.
- `charter.length > 0`: subsection cards in `md:grid-cols-2`, each with heading + rendered markdown (existing `Markdown` component; bullets render).
- Otherwise existing fallbacks (intake text + "Charter pending", or "No overview yet").

### 1.5 Briefing — `web/src/components/ExecutiveBriefingModal.tsx`, `web/src/index.css`
- Page 1: header + "1. Project Overview & Charter", full width, two-column subsection grid.
- Page 2: "2. Financial & Procurement Rollup" first, then 3. Phase-Gate Flowchart, 4. Deliverables, 5. Non-Conformances & Questions.
- Remove `max-h-[10.8in]` and `overflow-hidden` from `.briefing-page`; page 2 gets `break-before: page`. Ruling: a charter longer than one page overflows onto a further page rather than truncating.

### 1.6 CLI mirror
- `src/core/briefing-formatter.ts`: `BriefingData.charter?: CharterSection[]`; plain formatter renders page 1 (header + charter subsections) then `── Page 2 ──` with financials, phases, issues. `/briefing` passes `extractConopsCharter`.
- New `/charter`: each subsection in a box (heading + body), from `extractConopsCharter`; fallback messages match web.
- `/plan`: snake layout when `process.stdout.columns >= 100` — rows of 4 joined by `──▶`, row 2 reversed with `◀──`, `↓` at row ends; else existing vertical list. Layout logic in a headless pure function `layoutSnakeRows(count, perRow)` returning row index arrays + direction, unit-tested; chalk rendering stays in `src/cli/ui.ts`.
- Startup banner shows project name + `Purpose` first line when available.

## 2. Project switching

### 2.1 Headless core
- `src/workspace/project-context.ts`: `ProjectContext { record; path; stateManager; logger }`, `switchTo(record)` rebuilds state manager + logger, calls `registry.setActiveProject`, notifies `onSwitch` listeners. Router, server session, and CLI loop read from the context per request instead of captured values.
- `src/workspace/folder-browser.ts`: `listFolders(dir, filter?) → { path, parent: string | null, folders: Array<{ name; path; isProject }> }`.
  - `isProject` = contains `.starn/`.
  - Skips dot-folders, `node_modules`, `dist`, `.git`; case-insensitive substring filter; sorted by name.
  - Folder names only. Missing/unreadable dir → throws `Error` with message.

### 2.2 Rules
- Switch rejected while a turn is running or a checkpoint is pending (web: 409 with reason; CLI: not reachable mid-turn).
- Session messages cleared on switch.
- Unregistered folder → `registerProject(basename, path)` then switch.

### 2.3 API — `src/server/router.ts`
- `GET /api/projects` → `{ projects: ProjectRecord[], activeId }`.
- `GET /api/fs/folders?path=&q=` → listing; default `path` = home dir; 400 on error.
- `POST /api/projects/switch` `{ projectId } | { path }` → 400 (unknown id / missing folder), 409 (busy), 200 `ProjectInfoResponse`.
- `RouterDeps` gains `context: ProjectContext`; `projectPath`/`stateManager` become derived from it.

### 2.4 Web — Settings "Project" card (top)
- Dropdown of known projects + "Switch".
- "Browse…": breadcrumb, "Go up", filter input, folder rows (≥44px, "STARN project" badge), paste-path input + "Use this folder".
- On success: app remounts views via a `projectKey` in `AppShell`, so all tabs reload.

### 2.5 CLI — `/project`
- `select`: known projects + "Browse…". Browse loop: `..`, subfolders, "Use this folder", "Type a path"; uses `listFolders`.
- After switch: print project, clear `sessionMessages`, print `/plan`.

## 3. Examples & Library

### 3.1 Headless — `src/workspace/project-files.ts`
- `saveExample(projectPath, specialistId, filename, bytes)`:
  - Allowed: `.md`, `.txt`, `.pdf`. PDF → text via `extractTextFromPdf`, saved as `<name>.pdf.md`.
  - Saved to `examples/<specialistId>/`. Unknown specialist id → error.
- `saveReference(projectPath, filename, bytes)`: allowed `.md .txt .pdf .csv .png .jpg .jpeg .webp`, stored as-is in `reference/`.
- Shared guards: basename only (no `/ \ ..`), ≤10 MB, non-empty (text after extraction). Name clash → `name-2.ext`, `name-3.ext`, …; never overwrite.
- `listLibrary(projectPath) → { references: FileEntry[], examples: Record<specialistId, FileEntry[]> }`, `FileEntry = { name; size; modified }`.
- `removeLibraryFile(projectPath, { kind: 'reference' | 'example', specialistId?, name })`: path-guarded; missing → error.
- Gap fix: `src/core/runner.ts` critic example loading and `example_reader` include `.txt`.

### 3.2 API
- `POST /api/examples/:specialistId` `{ filename, contentBase64 }` → 200 `{ path }`.
- `POST /api/references` same body.
- `GET /api/library`.
- `DELETE /api/library/references/:name`, `DELETE /api/library/examples/:specialistId/:name`.
- Errors: 400 (type/name/empty), 404 (missing file / unknown specialist), 413 (>10 MB).

### 3.3 Web
- Development doc panel: drop zone "Drop example documents for <Document>" + "Choose files" button; per-file result list; example count; disabled while busy.
- New **Library** tab (between Work Instructions and Digital Twin): reference drop zone + list (name, size, date, Remove); "Examples by document" grouped list incl. Development drops (Remove). Remove confirms.
- Keyboard-operable via button; ≥44px targets; contrast measured.

### 3.4 CLI
- `/example <path>` → current phase's specialist.
- `/reference <path>`.
- `/library` → list both groups, optional remove via `select`.
- Argument parsing in a pure helper (quoted paths supported), unit-tested.

## Testing
- Unit: `extractConopsCharter`, `extractConopsOverview` fallback, `layoutSnakeRows`, briefing plain formatter page order, `listFolders`, `ProjectContext.switchTo`, `project-files` (types, PDF, clash suffix, traversal, size, list, remove), critic `.txt` examples, CLI arg parsing.
- Router: projects/folders/switch (200/400/409; dashboard reflects new project), examples/references/library (200/400/404/413).
- Gate: `tsc --noEmit && vitest run`; `npm --prefix web run build`.
- Manual/measured: contrast of new text, print preview of briefing (page 2 starts with finance).

## Constraints
- `core/*`, `workspace/*` headless; no `cli/*`/`server/*` imports.
- No new runtime deps.
