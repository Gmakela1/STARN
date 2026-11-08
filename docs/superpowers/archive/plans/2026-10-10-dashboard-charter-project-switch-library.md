# Dashboard Polish, Charter, Project Switching & Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the dashboard roadmap snake with arrows, fix the 2-page briefing PDF layout, expand the CONOPS charter into structured subsections on dashboard and briefing, add project switching (web settings + CLI `/project`), and add example/reference file drops with a new Library tab.

**Architecture:** Presentation-agnostic core: charter extraction in `src/core/conops-overview.ts`, folder browsing and project switching through a headless `ProjectContext` and `listFolders` in `src/workspace/`, and file handling in `src/workspace/project-files.ts`. The router delegates to this context per request. Web views consume typed REST endpoints; CLI commands (`/charter`, `/plan`, `/briefing`, `/project`, `/example`, `/reference`, `/library`) mirror every capability.

**Tech Stack:** TypeScript (strict), Node.js `node:fs` / `node:path` / `node:http`, React 19, Tailwind CSS, Lucide icons, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-dashboard-charter-project-switch-library-design.md`

## Global Constraints

- Core logic stays I/O-agnostic: `src/core/*`, `src/workspace/*`, `src/tools/*`, `src/specialists/*` must not import `src/cli/*` or `src/server/*`.
- Strict TypeScript: `npx tsc --noEmit` must pass cleanly with zero errors.
- Vitest suite must stay 100% green at every step.
- Frontend builds cleanly: `npm --prefix web run build`.
- No new external runtime npm dependencies.
- Single source of truth: documents live in `docs/`, state in `.starn/state.json`, registry in `~/.starn/registry.json`.
- Accessibility: interactive targets ≥ 44px, text contrast ≥ 4.5:1 against backgrounds (measured, never guessed).

## Review Focus

- Empty or un-extractable PDF uploaded as an example — reasonable expectation: rejected with a clear 400 error, no empty file written to `examples/`. Tested in Task 9.
- Name collision on upload (e.g. `spec.pdf` dropped twice) — reasonable expectation: existing file is preserved, new file suffixed `spec-2.pdf.md`. Tested in Task 9.
- Switching to a folder that is a file, or doesn't exist, or lacks read permission — reasonable expectation: returns 400 with a readable error, active project does not change. Tested in Task 6.
- Switching projects while a turn is running or a checkpoint is pending — reasonable expectation: returns 409 Conflict, active project and turn state remain intact. Tested in Task 6.
- Charter subsections that contain nested markdown (bullet lists, bolding) — reasonable expectation: extracted body preserves markdown so React / CLI markdown renderers display them correctly. Tested in Task 1.

---

### Task 1: CONOPS Charter Subsections & Headless Extractor

**Files:**
- Modify: `src/specialists/packages/conops/index.ts`
- Modify: `src/core/conops-overview.ts`
- Modify: `tests/conops-overview.test.ts`
- Modify: `tests/specialists.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CharterSection {
    heading: string;
    body: string;
  }
  export function extractConopsCharter(markdown: string): CharterSection[];
  export function extractConopsOverview(markdown: string): string | null;
  ```

- [x] **Step 1: Write the failing tests in `tests/conops-overview.test.ts`**

```ts
import { extractConopsCharter, extractConopsOverview } from '../src/core/conops-overview.js';

describe('extractConopsCharter', () => {
  it('extracts all 7 charter subsections from Section 1 in order, excluding System-Level Capabilities', () => {
    const md = `# CONOPS\n\n## 1. Project Overview & Charter\n\nIntro overview prose.\n\n### Background & Problem\nOld diesel tractor is noisy.\n\n### Purpose\nConvert to clean electric.\n\n### Objectives\n- Zero emissions\n- 4 hour runtime\n\n### Success Criteria\nMows 2 acres on a charge.\n\n### Scope\n**In scope:** motor, battery.\n**Out of scope:** bodywork.\n\n### Users & Stakeholders\nProperty owner.\n\n### Key Constraints & Assumptions\n120V charging available.\n\n### System-Level Capabilities\n- Electric traction\n\n## 2. Operational Environment\nOutdoors.`;

    const charter = extractConopsCharter(md);
    expect(charter).toHaveLength(8); // Intro 'Overview' + 7 subsections
    expect(charter[0]).toEqual({ heading: 'Overview', body: 'Intro overview prose.' });
    expect(charter[1]).toEqual({ heading: 'Background & Problem', body: 'Old diesel tractor is noisy.' });
    expect(charter[2]).toEqual({ heading: 'Purpose', body: 'Convert to clean electric.' });
    expect(charter[7]).toEqual({ heading: 'Key Constraints & Assumptions', body: '120V charging available.' });
    expect(charter.some(s => s.heading.includes('System-Level Capabilities'))).toBe(false);
  });

  it('handles legacy CONOPS without subsections by returning a single Overview entry', () => {
    const md = `## 1. Executive Summary & User Intent\nA single prose paragraph.\n\n## 2. Operational Environment\nOutdoors.`;
    const charter = extractConopsCharter(md);
    expect(charter).toEqual([{ heading: 'Overview', body: 'A single prose paragraph.' }]);
  });

  it('returns empty array when Section 1 is absent', () => {
    expect(extractConopsCharter('# Document without section 1')).toEqual([]);
  });

  it('extractConopsOverview falls back to Purpose or first subsection when intro prose is empty', () => {
    const md = `## 1. Project Overview & Charter\n\n### Purpose\nConvert tractor to electric powertrain.\n\n### Objectives\nMow the lawn.`;
    expect(extractConopsOverview(md)).toBe('Convert tractor to electric powertrain.');
  });
});
```

- [x] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/conops-overview.test.ts`
Expected: FAIL with `extractConopsCharter is not a function`.

- [x] **Step 3: Implement `extractConopsCharter` and update `extractConopsOverview` in `src/core/conops-overview.ts`**

Implement:
- Define `export interface CharterSection { heading: string; body: string; }`.
- Find start line matching `/^##\s+1\.\s/`. If absent, return `[]`.
- Read lines until the next `/^##\s+[2-9]\./` (or next top-level `## `).
- Split by `### ` headings. Any prose before the first `### ` (trimmed, non-empty) becomes `{ heading: 'Overview', body: ... }`.
- For each `### ` heading, extract the title (trimmed). If the title strictly equals or starts with `'System-Level Capabilities'`, skip it.
- Otherwise add `{ heading: title, body: body.trim() }`.
- Update `extractConopsOverview`: if intro prose exists, return it; otherwise return the body of the `Purpose` section (case-insensitive); otherwise return the first charter section's body; otherwise `null`.

- [x] **Step 4: Update CONOPS prompt, secret sauce, and rubric in `src/specialists/packages/conops/index.ts`**

- Update Section 1 title: `## 1. Project Overview & Charter`.
- Update prompt mandatory structure to require the 7 `###` subsections in order before `### System-Level Capabilities`.
- Update `conopsSecretSauce` to include the 7 subsections with realistic tractor conversion content, keeping `### System-Level Capabilities` at the end of Section 1.
- Update critic rubric criterion 1 to check for the charter subsections.

- [x] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/conops-overview.test.ts tests/specialists.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/core/conops-overview.ts src/specialists/packages/conops/index.ts tests/conops-overview.test.ts
git commit -m "feat(conops): charter subsections in prompt and headless extractor"
```

---

### Task 2: Briefing Formatter & CLI Commands (`/charter`, `/briefing`, `/plan` snake)

**Files:**
- Modify: `src/core/briefing-formatter.ts`
- Modify: `src/core/formatters.ts`
- Modify: `src/cli/ui.ts`
- Modify: `src/index.ts`
- Modify: `tests/briefing-formatter.test.ts`
- Create: `tests/snake-layout.test.ts`

**Interfaces:**
- Consumes: `extractConopsCharter` (from Task 1)
- Produces:
  ```ts
  export function layoutSnakeRows(totalCount: number, perRow: number): Array<{ indices: number[]; direction: 'ltr' | 'rtl' }>;
  export function formatCharterPlain(charter: CharterSection[], projectName: string): string;
  ```

- [x] **Step 1: Write the failing tests in `tests/snake-layout.test.ts` and `tests/briefing-formatter.test.ts`**

In `tests/snake-layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { layoutSnakeRows } from '../src/core/formatters.js';

describe('layoutSnakeRows', () => {
  it('splits 13 items into 4 rows with alternating ltr/rtl directions', () => {
    const rows = layoutSnakeRows(13, 4);
    expect(rows).toEqual([
      { indices: [0, 1, 2, 3], direction: 'ltr' },
      { indices: [4, 5, 6, 7], direction: 'rtl' },
      { indices: [8, 9, 10, 11], direction: 'ltr' },
      { indices: [12], direction: 'rtl' }
    ]);
  });

  it('handles counts smaller than perRow', () => {
    expect(layoutSnakeRows(3, 4)).toEqual([{ indices: [0, 1, 2], direction: 'ltr' }]);
  });
});
```

In `tests/briefing-formatter.test.ts`, add test that `BriefingData.charter` renders subsections in Page 1, followed by `── Page 2 ──` containing Financials first.

- [x] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/snake-layout.test.ts tests/briefing-formatter.test.ts`
Expected: FAIL with `layoutSnakeRows is not a function`.

- [x] **Step 3: Implement `layoutSnakeRows` in `src/core/formatters.ts`**

Pure function: slice `0..totalCount` into chunks of `perRow`. Even rows are `'ltr'`, odd rows are `'rtl'`.

- [x] **Step 4: Update `src/core/briefing-formatter.ts`**

- Add `charter?: CharterSection[]` to `BriefingData`.
- In `formatExecutiveBriefingPlain`:
  - Page 1: Header, then `1. PROJECT OVERVIEW & CHARTER`. If `charter` has items, print each subsection with its heading and indented body. Otherwise print `conopsSummary`.
  - Print clear page boundary: `\n=== PAGE 2: EXECUTION GOVERNANCE & FINANCIALS ===\n`.
  - Section 2 is `2. FINANCIAL & PROCUREMENT ROLLUP` (moved to top of Page 2).
  - Section 3 is Milestone Status, Section 4 is Critical Risks & Open Defects.

- [x] **Step 5: Implement `formatCharterPlain` in `src/cli/ui.ts` and update `/plan` snake rendering**

- `formatCharterPlain`: wraps each subsection in a clean boxen/card with cyan title.
- In `formatWorkflowRoadmap`: check `(process.stdout.columns ?? 80) >= 100`. If so, use `layoutSnakeRows` to render 4 cards per row joined by `──▶` (ltr) and `◀──` (rtl), with `│\n▼` row-end connectors. If `< 100`, fall back to the existing vertical list.

- [x] **Step 6: Wire `/charter` and updated `/briefing` in `src/index.ts`**

- Read `CONOPS.md` and call `extractConopsCharter`.
- `/charter`: print `formatCharterPlain(charter, currentProjectRecord.name)`.
- `/briefing`: pass `charter` to `formatExecutiveBriefingPlain`.
- Add `/charter` to quick commands list and help text in `src/cli/ui.ts` and `src/core/formatters.ts`.
- Update startup banner: if CONOPS exists, print the Purpose line under the project directory.

- [x] **Step 7: Run tests to verify pass**

Run: `npx vitest run tests/snake-layout.test.ts tests/briefing-formatter.test.ts`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/core/briefing-formatter.ts src/core/formatters.ts src/cli/ui.ts src/index.ts tests/
git commit -m "feat(cli): /charter command, briefing page-2 reorder, and /plan snake layout"
```

---

### Task 3: Roadmap Snake Component (`TreasureMapRoadmap.tsx`)

**Files:**
- Modify: `web/src/components/TreasureMapRoadmap.tsx`

**Interfaces:**
- Consumes: `RoadmapPhase[]`

- [x] **Step 1: Inspect and design grid structure for `TreasureMapRoadmap.tsx`**

On `lg` screens, layout 4 cards per row with horizontal SVG connectors between them:
- Row 1 (phases 1-4, LTR): Card 1 `→` Card 2 `→` Card 3 `→` Card 4. Right-edge downward arrow `↓` to Row 2.
- Row 2 (phases 5-8, RTL visually): Card 8 `←` Card 7 `←` Card 6 `←` Card 5. Left-edge downward arrow `↓` to Row 3.
- Row 3 (phases 9-12, LTR): Card 9 `→` Card 10 `→` Card 11 `→` Card 12. Right-edge downward arrow `↓` to Row 4.
- Row 4 (phase 13, RTL alignment): Card 13 placed under Card 12.

- [x] **Step 2: Replace absolute connectors with inline SVG arrow cells**

- Create helper component `<ConnectorArrow dir="right" | "left" | "down" active={boolean} />`.
  - When `active` (source phase is `COMPLETED`), stroke is `text-emerald-500` solid.
  - When inactive, stroke is `text-slate-700` dashed.
  - Set `aria-hidden="true"`.
- Use CSS grid: `grid grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr]` on `lg` screens.
- Below `lg`, collapse to a vertical stack with downward connector arrows between cards.

- [x] **Step 3: Verify frontend build**

Run: `npm --prefix web run build`
Expected: Build succeeds with 0 errors.

- [x] **Step 4: Commit**

```bash
git add web/src/components/TreasureMapRoadmap.tsx
git commit -m "feat(web): snake roadmap with visible horizontal and vertical SVG arrows"
```

---

### Task 4: Server Charter Response, Full-Width Dashboard & Briefing Modal Fix

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/router.ts`
- Modify: `web/src/types/api.ts`
- Modify: `web/src/views/DashboardView.tsx`
- Modify: `web/src/components/ExecutiveBriefingModal.tsx`
- Modify: `web/src/index.css`
- Modify: `tests/server-api.test.ts`

**Interfaces:**
- Consumes: `extractConopsCharter` (from Task 1)
- Produces: `ProjectInfoResponse.charter: CharterSection[]`

- [x] **Step 1: Write failing test in `tests/server-api.test.ts`**

Add test: `GET /api/project` returns `charter: CharterSection[]` when `docs/CONOPS.md` has subsections.

- [x] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/server-api.test.ts`
Expected: FAIL (charter property undefined).

- [x] **Step 3: Update `src/server/types.ts` and `src/server/router.ts`**

- In `src/server/types.ts`: add `export interface CharterSection { heading: string; body: string; }` and add `charter: CharterSection[];` to `ProjectInfoResponse`.
- In `src/server/router.ts`: in `buildProjectInfo`, read `docs/CONOPS.md`, run `extractConopsCharter(content)`, and attach to the response. If file is missing, return `charter: []`.
- Mirror in `web/src/types/api.ts`.

- [x] **Step 4: Update `web/src/views/DashboardView.tsx`**

- Remove `max-w-2xl` from the project overview card container.
- Place the header (badges, title, and the "Export 2-Page Executive Briefing" button) in a full-width header bar.
- If `project.charter.length > 0`, render the charter as a two-column grid (`grid grid-cols-1 md:grid-cols-2 gap-4 mt-4`). Each card has a subtle slate border/bg, uppercase heading in sky-400, and rendered markdown text using `<Markdown content={section.body} />`.
- If `project.charter.length === 0`, fall back to existing summary text.

- [x] **Step 5: Fix `web/src/components/ExecutiveBriefingModal.tsx` and `web/src/index.css`**

- In `ExecutiveBriefingModal.tsx`:
  - Page 1: Full-width Project Overview & Charter. Render `project.charter` in a 2-column grid. Remove the Financial & Procurement Rollup from Page 1 entirely.
  - Page 2: Starts with `2. Financial & Procurement Rollup` at the top, followed by 3. Phase-Gate Flowchart, 4. Milestone Deliverables, 5. Hardware Non-Conformances.
  - Remove `max-h-[10.8in]` and `overflow-hidden` from the `.briefing-page` containers so content is never clipped.
- In `web/src/index.css`:
  - Ensure `.briefing-page` has `break-inside: avoid;`.
  - Add `.briefing-page:nth-of-type(2) { break-before: page !important; page-break-before: always !important; }`.

- [x] **Step 6: Run tests and web build**

Run: `npx vitest run tests/server-api.test.ts && npm --prefix web run build`
Expected: All pass.

- [x] **Step 7: Commit**

```bash
git add src/server/ web/src/ tests/server-api.test.ts
git commit -m "feat(web): full-width charter subsections on dashboard and unclipped briefing page 2"
```

---

### Task 5: Headless Folder Browser & ProjectContext

**Files:**
- Create: `src/workspace/folder-browser.ts`
- Create: `src/workspace/project-context.ts`
- Create: `tests/folder-browser.test.ts`
- Create: `tests/project-context.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FolderEntry {
    name: string;
    path: string;
    isProject: boolean;
  }
  export interface FolderListing {
    currentPath: string;
    parentPath: string | null;
    folders: FolderEntry[];
  }
  export function listFolders(targetDir: string, query?: string): FolderListing;

  export class ProjectContext {
    constructor(registry: ProjectRegistry, initialRecord: ProjectRecord);
    get record(): ProjectRecord;
    get path(): string;
    get stateManager(): ProjectStateManager;
    get logger(): Logger;
    switchTo(record: ProjectRecord): void;
    switchToPath(targetPath: string, name?: string): ProjectRecord;
    onSwitch(listener: (newRecord: ProjectRecord) => void): () => void;
  }
  ```

- [x] **Step 1: Write the failing tests in `tests/folder-browser.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listFolders } from '../src/workspace/folder-browser.js';

describe('listFolders', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folders-'));
    fs.mkdirSync(path.join(tmpDir, 'alpha'));
    fs.mkdirSync(path.join(tmpDir, 'beta', '.starn'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.hidden'));
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists only visible non-dev subdirectories and identifies projects', () => {
    const listing = listFolders(tmpDir);
    expect(listing.folders.map(f => f.name)).toEqual(['alpha', 'beta']);
    expect(listing.folders.find(f => f.name === 'beta')?.isProject).toBe(true);
    expect(listing.folders.find(f => f.name === 'alpha')?.isProject).toBe(false);
  });

  it('filters folders by case-insensitive query', () => {
    const listing = listFolders(tmpDir, 'bet');
    expect(listing.folders.map(f => f.name)).toEqual(['beta']);
  });

  it('throws on non-existent or file path', () => {
    expect(() => listFolders(path.join(tmpDir, 'missing'))).toThrow();
    expect(() => listFolders(path.join(tmpDir, 'file.txt'))).toThrow();
  });
});
```

- [x] **Step 2: Write failing tests in `tests/project-context.test.ts`**

Test: initial context has record, path, stateManager; `switchTo` updates record and path, builds fresh `stateManager` and `logger`, and fires `onSwitch` listener.

- [x] **Step 3: Run tests to verify failure**

Run: `npx vitest run tests/folder-browser.test.ts tests/project-context.test.ts`
Expected: FAIL (modules not found).

- [x] **Step 4: Implement `src/workspace/folder-browser.ts`**

Implement `listFolders(targetDir: string, query?: string): FolderListing`:
- Resolve absolute path. Throw if `!fs.existsSync(resolved)` or `!fs.statSync(resolved).isDirectory()`.
- Compute `parentPath = path.dirname(resolved) === resolved ? null : path.dirname(resolved)`.
- Read entries via `fs.readdirSync(resolved, { withFileTypes: true })`.
- Filter for directories where name doesn't start with `.` and isn't `node_modules` or `dist`.
- Check `isProject`: `fs.existsSync(path.join(resolved, d.name, '.starn'))`.
- Filter by `query` if present (case-insensitive substring).
- Sort alphabetically by name.

- [x] **Step 5: Implement `src/workspace/project-context.ts`**

Implement `ProjectContext`:
- Store `registry`, current `_record`, `_stateManager`, `_logger`, and a set of `listeners`.
- Constructor initializes `_stateManager = new ProjectStateManager(_record.path)` and `_logger = new Logger(path.join(_record.path, '.starn'))`.
- `switchTo(record)`:
  - Updates `_record = record`.
  - Sets active in registry: `this.registry.setActiveProject(record.id)`.
  - Recreates `_stateManager` and `_logger`.
  - Fires all listeners with `record`.
- `switchToPath(targetPath, name)`:
  - Finds or registers project via `registry.registerProject(name ?? path.basename(targetPath), targetPath)`.
  - Calls `switchTo(record)` and returns `record`.

- [x] **Step 6: Run tests to verify pass**

Run: `npx vitest run tests/folder-browser.test.ts tests/project-context.test.ts`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/workspace/folder-browser.ts src/workspace/project-context.ts tests/folder-browser.test.ts tests/project-context.test.ts
git commit -m "feat(workspace): headless folder browser and ProjectContext"
```

---

### Task 6: Server Project Switching & Session Reset

**Files:**
- Modify: `src/server/session.ts`
- Modify: `src/server/router.ts`
- Modify: `tests/server-api.test.ts`
- Create: `tests/server-project-switch.test.ts`

**Interfaces:**
- Consumes: `ProjectContext`, `listFolders` (from Task 5)
- Modifies:
  ```ts
  export interface RouterDeps {
    context?: ProjectContext;
    // ...
  }
  ```
- Produces routes:
  - `GET /api/projects`
  - `GET /api/fs/folders?path=&q=`
  - `POST /api/projects/switch`

- [x] **Step 1: Write failing tests in `tests/server-project-switch.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHttpServer } from '../src/server/server.js';
import { ProjectRegistry } from '../src/workspace/registry.js';
import { ProjectContext } from '../src/workspace/project-context.js';
import { ServerSessionManager } from '../src/server/session.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Server project switching API', () => {
  let server: http.Server;
  let tmpA: string;
  let tmpB: string;
  let regFile: string;
  let context: ProjectContext;
  let session: ServerSessionManager;

  beforeEach(async () => {
    tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-a-'));
    tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-b-'));
    regFile = path.join(tmpA, 'registry.json');
    const registry = new ProjectRegistry(regFile);
    const recA = registry.registerProject('Project A', tmpA);
    registry.registerProject('Project B', tmpB);
    context = new ProjectContext(registry, recA);

    session = new ServerSessionManager({
      projectPath: tmpA,
      stateManager: context.stateManager,
      apiKey: 'test-key',
      providers: [],
      assignments: {
        drafting: { providerId: 'openrouter', model: 'm' },
        critic: { providerId: 'openrouter', model: 'm' },
        classifier: { providerId: 'openrouter', model: 'm' },
        compaction: { providerId: 'openrouter', model: 'm' }
      },
      clientFactory: () => ({} as any),
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry()
    });

    server = createHttpServer({
      projectPath: tmpA,
      stateManager: context.stateManager,
      context,
      session
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  });

  afterEach(async () => {
    await new Promise(r => server.close(r));
    fs.rmSync(tmpA, { recursive: true, force: true });
    fs.rmSync(tmpB, { recursive: true, force: true });
  });

  it('GET /api/projects returns known projects and activeId', async () => { /* ... */ });
  it('GET /api/fs/folders lists subdirectories', async () => { /* ... */ });
  it('POST /api/projects/switch switches active project and returns new ProjectInfo', async () => { /* ... */ });
  it('POST /api/projects/switch returns 409 when session is busy', async () => { /* ... */ });
  it('POST /api/projects/switch returns 400 on non-existent folder', async () => { /* ... */ });
});
```

- [x] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/server-project-switch.test.ts`
Expected: FAIL (routes 404).

- [x] **Step 3: Update `ServerSessionManager` in `src/server/session.ts`**

- Add `switchProject(newPath: string, newStateManager: ProjectStateManager, newLogger?: Logger): void`:
  - Throws if `this.busy` or `this.pending`.
  - Clears `this.sessionMessages = []`.
  - Updates `this.deps.projectPath = newPath`, `this.deps.stateManager = newStateManager`, `this.deps.logger = newLogger`.

- [x] **Step 4: Wire routes in `src/server/router.ts`**

- In `handleApiRequest`: at the start, resolve `const activePath = deps.context ? deps.context.path : deps.projectPath;` and `const activeStateManager = deps.context ? deps.context.stateManager : deps.stateManager;`. Use these throughout `handleApiRequest`.
- Add `GET /api/projects`: return `{ projects: registry.listProjects(), activeId: context.record.id }`.
- Add `GET /api/fs/folders`: parse `url.searchParams.get('path')` (default to `os.homedir()`) and `q`. Call `listFolders(p, q)`. Return `{ currentPath, parentPath, folders }`. Catch error → 400.
- Add `POST /api/projects/switch`:
  - Check `if (deps.session?.busy || deps.session?.getPendingCheckpoint()) return fail(res, 409, 'Cannot switch projects while an agent turn is running or pending review.');`
  - Read body `{ projectId, path: targetPath }`.
  - Switch context via `context.switchTo` or `context.switchToPath`.
  - If `deps.session`, call `deps.session.switchProject(context.path, context.stateManager, context.logger)`.
  - Return `ok(res, buildProjectInfo(deps))`.

- [x] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/server-project-switch.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/server/ tests/server-project-switch.test.ts
git commit -m "feat(server): project switching and folder browsing endpoints"
```

---

### Task 7: Web Project Switcher (Settings & AppShell)

**Files:**
- Modify: `web/src/types/api.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/layouts/AppShell.tsx`
- Modify: `web/src/views/SettingsView.tsx`

**Interfaces:**
- Consumes: `/api/projects`, `/api/fs/folders`, `/api/projects/switch`

- [x] **Step 1: Update API client and types in `web/src/`**

- In `web/src/types/api.ts`:
  ```ts
  export interface ProjectRecord { id: string; name: string; path: string; }
  export interface ProjectsResponse { projects: ProjectRecord[]; activeId: string; }
  export interface FolderEntry { name: string; path: string; isProject: boolean; }
  export interface FolderListingResponse { currentPath: string; parentPath: string | null; folders: FolderEntry[]; }
  ```
- In `web/src/api/client.ts`:
  - `fetchProjects: () => call<ProjectsResponse>('GET', '/api/projects')`
  - `browseFolders: (path?: string, q?: string) => call<FolderListingResponse>('GET', ...)`
  - `switchProject: (body: { projectId?: string; path?: string }) => call<ProjectInfo>('POST', '/api/projects/switch', body)`

- [x] **Step 2: Add Project switching card to `web/src/views/SettingsView.tsx`**

Place at the top of the Settings page:
- "Active Project" card:
  - Displays current project name and path.
  - Dropdown of known projects from `api.fetchProjects()` + "Switch" button.
  - "Browse folders…" expandable panel:
    - Path breadcrumb with a `[Up]` button to parent.
    - Quick filter search input.
    - List of subdirectories (≥44px rows). Project directories highlighted with a badge. Clicking a folder navigates into it.
    - Path input field allowing user to paste any path.
    - "Use this folder" button.
  - While busy, switching is disabled with a tooltip explaining why.

- [x] **Step 3: AppShell remount on project switch**

In `web/src/layouts/AppShell.tsx`:
- Maintain a `projectRevision` state counter.
- Pass `onProjectSwitched={() => { setProjectRevision(r => r + 1); void refreshProject(); }}` to `SettingsView`.
- Key the view container with `projectRevision` so when the active project changes, all views unmount and reload fresh data for the new project.

- [x] **Step 4: Build web bundle and verify**

Run: `npm --prefix web run build`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/src/
git commit -m "feat(web): project picker and folder browser in settings with view remounting"
```

---

### Task 8: CLI `/project` Command & `index.ts` Integration

**Files:**
- Modify: `src/cli/prompts.ts`
- Modify: `src/index.ts`
- Modify: `src/cli/ui.ts`
- Modify: `src/core/formatters.ts`
- Create: `tests/cli-project.test.ts`

**Interfaces:**
- Consumes: `ProjectContext`, `listFolders`

- [x] **Step 1: Write unit tests in `tests/cli-project.test.ts`**

Test helper logic for the interactive project prompt and folder navigator options.

- [x] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/cli-project.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement `promptSwitchProject` in `src/cli/prompts.ts`**

Implement interactive prompt using `@inquirer/prompts`:
- Choice between known projects and "📁 Browse filesystem...".
- If "Browse": loop displaying current folder, `.. (Up)`, subfolders, and "✓ Select this folder". Uses `listFolders`.
- Returns `{ action: 'switch'; projectId?: string; path?: string } | null`.

- [x] **Step 4: Integrate `ProjectContext` in `src/index.ts`**

- Construct `const projectContext = new ProjectContext(projectRegistry, currentProjectRecord)`.
- Replace hardcoded `currentProjectRecord` and `stateManager` references in the loop with `projectContext.record` and `projectContext.stateManager`.
- Hook context switch listener to update `logger`, `setClassifierLogger(projectContext.logger)`, `setCriticLogger(projectContext.logger)`.
- Pass `context: projectContext` to `startWebServer`.
- Handle `/project` quick command:
  - Run `promptSwitchProject`.
  - If a project was picked, call `projectContext.switchTo` (or `switchToPath`).
  - Clear `sessionMessages = []`.
  - Print confirmation and print `/plan`.

- [x] **Step 5: Run tests and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/cli/prompts.ts src/index.ts src/cli/ui.ts src/core/formatters.ts tests/cli-project.test.ts
git commit -m "feat(cli): /project command with interactive folder browser and ProjectContext"
```

---

### Task 9: Headless Project Files (Examples, References & Library)

**Files:**
- Create: `src/workspace/project-files.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/tools/handlers/example-reader.ts`
- Create: `tests/project-files.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FileEntry {
    name: string;
    size: number;
    modified: string;
  }
  export interface LibraryListing {
    references: FileEntry[];
    examples: Record<string, FileEntry[]>;
  }
  export async function saveExample(
    projectPath: string,
    specialistId: string,
    filename: string,
    buffer: Buffer
  ): Promise<{ savedPath: string; filename: string }>;

  export async function saveReference(
    projectPath: string,
    filename: string,
    buffer: Buffer
  ): Promise<{ savedPath: string; filename: string }>;

  export function listLibrary(projectPath: string): LibraryListing;

  export function removeLibraryFile(
    projectPath: string,
    target: { kind: 'reference'; name: string } | { kind: 'example'; specialistId: string; name: string }
  ): void;
  ```

- [x] **Step 1: Write failing tests in `tests/project-files.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveExample, saveReference, listLibrary, removeLibraryFile } from '../src/workspace/project-files.js';

describe('Project files: examples and references', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves markdown and text examples under examples/<specialistId>/', async () => {
    const res = await saveExample(tmpDir, 'conops', 'sample.md', Buffer.from('# Example'));
    expect(res.savedPath).toBe('examples/conops/sample.md');
    expect(fs.readFileSync(path.join(tmpDir, res.savedPath), 'utf-8')).toBe('# Example');
  });

  it('extracts text from PDF examples and saves as <name>.pdf.md', async () => {
    // Mock pdf extraction or use a dummy buffer with mocked extractTextFromPdf
    const dummyPdf = Buffer.from('%PDF-dummy');
    const res = await saveExample(tmpDir, 'bom', 'parts.pdf', dummyPdf);
    expect(res.savedPath).toBe('examples/bom/parts.pdf.md');
  });

  it('prevents filename collisions by adding -2, -3 suffixes', async () => {
    await saveExample(tmpDir, 'conops', 'sample.md', Buffer.from('one'));
    const second = await saveExample(tmpDir, 'conops', 'sample.md', Buffer.from('two'));
    expect(second.filename).toBe('sample-2.md');
  });

  it('rejects forbidden file extensions for examples', async () => {
    await expect(saveExample(tmpDir, 'conops', 'virus.exe', Buffer.from('bad'))).rejects.toThrow();
  });

  it('rejects path traversal attempts', async () => {
    await expect(saveReference(tmpDir, '../../etc/passwd', Buffer.from('bad'))).rejects.toThrow();
  });

  it('lists and removes library files', async () => {
    await saveReference(tmpDir, 'datasheet.pdf', Buffer.from('pdf'));
    await saveExample(tmpDir, 'conops', 'ex.md', Buffer.from('ex'));

    const list = listLibrary(tmpDir);
    expect(list.references.map(r => r.name)).toContain('datasheet.pdf');
    expect(list.examples.conops.map(e => e.name)).toContain('ex.md');

    removeLibraryFile(tmpDir, { kind: 'reference', name: 'datasheet.pdf' });
    expect(listLibrary(tmpDir).references).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/project-files.test.ts`
Expected: FAIL (module not found).

- [x] **Step 3: Implement `src/workspace/project-files.ts`**

- Implement guards: `path.basename(filename) === filename`, no path traversal, check size ≤ 10MB.
- `saveExample`: allowed `.md`, `.txt`, `.pdf`. For `.pdf`, call `extractTextFromPdf` (from `src/tools/handlers/pdf-extractor.js`). If extracted text is empty, throw error. Save to `<project>/examples/<specialistId>/<name>.pdf.md`. Deduplicate names with `-2`, `-3`.
- `saveReference`: allowed `.md`, `.txt`, `.pdf`, `.csv`, `.png`, `.jpg`, `.jpeg`, `.webp`. Save to `<project>/reference/<filename>`. Deduplicate names.
- `listLibrary`: readdir on `reference/` and `examples/<specialistId>/`, return name, size, modified ISO string.
- `removeLibraryFile`: resolve file path within project root, throw if missing or outside root, delete via `fs.unlinkSync`.

- [x] **Step 4: Update critic runner and `example-reader` to load `.txt` examples**

- In `src/core/runner.ts` (around line 450): change check `f.endsWith('.md')` to `f.endsWith('.md') || f.endsWith('.txt')`.
- In `src/tools/handlers/example-reader.ts` (around line 30): change check `f.endsWith('.md')` to `f.endsWith('.md') || f.endsWith('.txt')`.

- [x] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/project-files.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/workspace/project-files.ts src/core/runner.ts src/tools/handlers/example-reader.ts tests/project-files.test.ts
git commit -m "feat(workspace): headless project-files manager and support .txt examples in critic"
```

---

### Task 10: Server Library & File Upload Endpoints

**Files:**
- Modify: `src/server/router.ts`
- Modify: `tests/server-api.test.ts`
- Create: `tests/server-library.test.ts`

**Interfaces:**
- Consumes: `saveExample`, `saveReference`, `listLibrary`, `removeLibraryFile`
- Produces routes:
  - `POST /api/examples/:specialistId`
  - `POST /api/references`
  - `GET /api/library`
  - `DELETE /api/library/references/:name`
  - `DELETE /api/library/examples/:specialistId/:name`

- [x] **Step 1: Write failing tests in `tests/server-library.test.ts`**

Test:
- `POST /api/examples/conops` saves file and returns `{ path, filename }`.
- `POST /api/references` saves reference file.
- `GET /api/library` lists files.
- `DELETE /api/library/references/:name` removes file.
- Non-existent specialist returns 404. Invalid file type returns 400. File > 10MB returns 413.

- [x] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/server-library.test.ts`
Expected: FAIL (routes 404).

- [x] **Step 3: Implement endpoints in `src/server/router.ts`**

- Handle `POST /api/examples/:specialistId`: read JSON `{ filename, contentBase64 }`. Convert base64 to Buffer. Verify specialist exists via `specialistRegistry`. Call `saveExample`. Return 200 `{ path, filename }`.
- Handle `POST /api/references`: read JSON `{ filename, contentBase64 }`. Call `saveReference`. Return 200 `{ path, filename }`.
- Handle `GET /api/library`: call `listLibrary(activePath)`. Return 200 `data`.
- Handle `DELETE /api/library/references/:name`: call `removeLibraryFile`. Return 200 `{ success: true }`.
- Handle `DELETE /api/library/examples/:specialistId/:name`: call `removeLibraryFile`. Return 200 `{ success: true }`.

- [x] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/server-library.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/server/router.ts tests/server-library.test.ts
git commit -m "feat(server): library list, upload, and delete endpoints"
```

---

### Task 11: CLI `/example`, `/reference`, and `/library` Commands

**Files:**
- Create: `src/cli/library-commands.ts`
- Modify: `src/index.ts`
- Modify: `src/cli/ui.ts`
- Modify: `src/core/formatters.ts`
- Create: `tests/cli-library.test.ts`

**Interfaces:**
- Consumes: `saveExample`, `saveReference`, `listLibrary`, `removeLibraryFile`
- Produces: CLI commands `/example <path>`, `/reference <path>`, `/library`

- [x] **Step 1: Write failing tests in `tests/cli-library.test.ts`**

Test argument parsing for `/example` and `/reference` supporting quoted strings (`/example "my file.pdf"`).

- [x] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/cli-library.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement CLI handlers in `src/cli/library-commands.ts`**

- `handleExampleCommand(projectPath, activePhase, arg)`: reads source file from local disk, calls `saveExample`. Prints success with the saved path.
- `handleReferenceCommand(projectPath, arg)`: reads source file, calls `saveReference`. Prints success.
- `handleLibraryCommand(projectPath)`: prints formatted table of references and examples by specialist. Offers interactive remove prompt.

- [x] **Step 4: Wire in `src/index.ts`**

- Dispatch `/example`, `/reference`, `/library` commands in the command loop.
- Add commands to `/help` list.

- [x] **Step 5: Run tests and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/cli/library-commands.ts src/index.ts src/cli/ui.ts src/core/formatters.ts tests/cli-library.test.ts
git commit -m "feat(cli): /example, /reference, and /library commands"
```

---

### Task 12: Web Development Example Drop & Library Tab

**Files:**
- Modify: `web/src/types/api.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/layouts/AppShell.tsx`
- Modify: `web/src/views/DevelopmentView.tsx`
- Create: `web/src/views/LibraryView.tsx`

**Interfaces:**
- Consumes: `/api/examples/:specialistId`, `/api/references`, `/api/library`

- [x] **Step 1: Update web API client in `web/src/api/client.ts`**

Add:
- `uploadExample: (specialistId: string, filename: string, contentBase64: string) => ...`
- `uploadReference: (filename: string, contentBase64: string) => ...`
- `fetchLibrary: () => call<LibraryListing>('GET', '/api/library')`
- `deleteReference: (name: string) => call<void>('DELETE', ...)`
- `deleteExample: (specialistId: string, name: string) => call<void>('DELETE', ...)`

- [x] **Step 2: Add Example Drop Zone to `web/src/views/DevelopmentView.tsx`**

In the right-hand document panel:
- Add collapsible/compact card: "Quality Examples for {selectedPhase}".
- Drag-and-drop zone + file picker button (`.md, .txt, .pdf`).
- On drop/select: convert file to base64 via `FileReader`, call `api.uploadExample`. Show success badge with new filename or error toast. Disabled while `busy`.

- [x] **Step 3: Create `web/src/views/LibraryView.tsx`**

- Tab layout:
  - Top section: "Reference Documents" drop zone + list table (name, size, modified, delete button).
  - Bottom section: "Specialist Quality Examples" grouped by specialist. Shows custom examples with delete buttons.
- Accessible: all drop zones have hidden `<input type="file">` triggered by a 44px button; keyboard operable; delete buttons require confirmation.

- [x] **Step 4: Add Library tab to `web/src/layouts/AppShell.tsx`**

- Add `{ id: 'library', label: 'Library', icon: Library }` to `TABS` between Work Instructions and Digital Twin.
- Render `<LibraryView />` when active.

- [x] **Step 5: Build web bundle and measure contrast**

Run: `npm --prefix web run build`
Expected: PASS.
Verify contrast of newly introduced text elements ≥ 4.5:1.

- [x] **Step 6: Commit**

```bash
git add web/src/
git commit -m "feat(web): development example drop zone and library management tab"
```

---

### Task 13: Full Verification & Branch Push

**Files:**
- Modify: `docs/superpowers/TODO.md`
- Modify: `docs/superpowers/plans/2026-10-10-dashboard-charter-project-switch-library.md`

- [x] **Step 1: Full verification suite**

Run:
```bash
npx tsc --noEmit
npx vitest run
npm --prefix web run build
```
Expected: 0 type errors, 100% tests passing, clean web build.

- [x] **Step 2: Check architectural decoupling boundaries**

Verify no forbidden imports:
```bash
grep -rn "from '../cli" src/core src/workspace src/models src/tools
grep -rn "from '../server" src/core src/workspace src/models src/tools
```
Expected: 0 matches.

- [x] **Step 3: Update plan and TODO documentation**

Mark all tasks complete in `docs/superpowers/TODO.md` and the plan file.

- [x] **Step 4: Push to origin/master**

```bash
git push origin master
```
