# Development Document Dropdown, Active Document Sync, and CONOPS Redo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a custom styled document dropdown in Development view with right-aligned colored status pills, synchronize active document selection to the backend workflow state and AI classifier, enhance folder browser resilience on Windows, ensure the build compiles both backend and frontend, and update the active project's CONOPS to the new structured charter format.

**Architecture:** The server router gains `POST /api/workflow/active-phase` to update `state.workflow.activePhase`. In `classifier.ts`, explicit prompt rules give the active viewing document priority when instructions refer to "this document". `folder-browser.ts` handles filesystem permission errors gracefully. The React frontend replaces the native select with an accessible custom popover menu.

**Tech Stack:** TypeScript, React 19, Tailwind CSS, Lucide icons, Vitest.

## Global Constraints

- Strict TypeScript: `npx tsc --noEmit` must pass cleanly with 0 errors.
- Vitest suite must stay 100% green.
- Frontend builds cleanly: `npm --prefix web run build`.
- No new external runtime npm dependencies.
- Production build updates `dist/`: `npm run build` runs `tsc && npm --prefix web run build`.

## Review Focus

- Selecting a document in Development view updates the backend state without needing a page refresh. Tested in Task 1 & 3.
- Classifier directs generic requests ("add requirements for safety", "update this") to the selected active document. Tested in Task 1.
- Browsing folders with system or restricted permissions (`$Recycle.Bin`, `EPERM`) does not crash the server. Tested in Task 2.
- The active project's `docs/CONOPS.md` produces valid `charter` subsections for the dashboard. Tested in Task 4.

---

### Task 1: Backend Active Phase Sync Endpoint & Classifier Guidance

**Files:**
- Modify: `src/server/router.ts`
- Modify: `src/core/classifier.ts`
- Create: `tests/server-active-phase.test.ts`
- Create: `tests/classifier-active-phase.test.ts`

**Interfaces:**
- Produces: `POST /api/workflow/active-phase` accepting `{ phaseId: string }`, returning `{ activePhase: string }`.
- Modifies: `POST /api/turns` accepts optional `activePhase?: string`.
- Modifies: `src/core/classifier.ts` system prompt to emphasize current active phase when user refers to "this document" or contextual edits.

- [ ] **Step 1: Write failing tests in `tests/server-active-phase.test.ts` and `tests/classifier-active-phase.test.ts`**

In `tests/server-active-phase.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHttpServer } from '../src/server/server.js';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('POST /api/workflow/active-phase', () => {
  let server: http.Server;
  let tmpDir: string;
  let stateManager: ProjectStateManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-phase-'));
    stateManager = new ProjectStateManager(tmpDir);
    stateManager.getOrCreateState('p1', 'Active Phase Test');
    server = createHttpServer({ projectPath: tmpDir, stateManager });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  });

  afterEach(async () => {
    await new Promise(r => server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates the active workflow phase in project state', async () => {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/workflow/active-phase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseId: 'bom' })
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.activePhase).toBe('bom');
    expect(stateManager.getState().workflow?.activePhase).toBe('bom');
  });

  it('rejects unknown phase with 400', async () => {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/workflow/active-phase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseId: 'unknown_phase' })
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/server-active-phase.test.ts`
Expected: FAIL (404 route not found).

- [ ] **Step 3: Implement `POST /api/workflow/active-phase` and update `POST /api/turns` in `src/server/router.ts`**

- In `src/server/router.ts`:
  - Route `POST /api/workflow/active-phase`: read body `{ phaseId }`. Validate `phaseId` against `ORDERED_WORKFLOW_PHASES.some(p => p.id === phaseId)`. If valid, call `deps.stateManager.setActivePhase(phaseId)` and return `ok(res, { activePhase: phaseId })`. Else return `fail(res, 400, 'Invalid phaseId')`.
  - In `POST /api/turns`: check if `body.activePhase` is provided; if so, set `deps.stateManager.setActivePhase(String(body.activePhase))` before running turn.

- [ ] **Step 4: Update classifier guidance in `src/core/classifier.ts`**

- In `src/core/classifier.ts`:
  Add prompt rule:
  `- The user is currently viewing the active document for phase "${activePhase || 'conops'}". If their request asks to draft, update, edit, or work on "this document", "the document", or gives general requirements without naming a specific deliverable, route to the Active Workflow Phase specialist.`

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/server-active-phase.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/router.ts src/core/classifier.ts tests/server-active-phase.test.ts
git commit -m "feat(server): active phase workflow endpoint and classifier active document context"
```

---

### Task 2: Folder Browser Resilience for Windows Systems & Permissions

**Files:**
- Modify: `src/workspace/folder-browser.ts`
- Modify: `tests/folder-browser.test.ts`

- [ ] **Step 1: Write test for permission errors and system directories in `tests/folder-browser.test.ts`**

Test:
- Skips directories starting with `$` (Windows system/trash folders like `$Recycle.Bin`).
- Skips `System Volume Information`.
- If an individual subdirectory throws permission error on stat/check, skips it instead of failing the whole directory listing.

- [ ] **Step 2: Implement improvements in `src/workspace/folder-browser.ts`**

- Filter out `d.name.startsWith('$')` and `d.name.toLowerCase() === 'system volume information'`.
- Wrap `fs.existsSync(path.join(folderPath, '.starn'))` in a try/catch.
- If `fs.readdirSync` itself throws `EPERM` or `EACCES`, throw a clean message or return empty folders with parent directory intact.

- [ ] **Step 3: Run tests to verify pass**

Run: `npx vitest run tests/folder-browser.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/workspace/folder-browser.ts tests/folder-browser.test.ts
git commit -m "fix(workspace): folder browser resilience for Windows system folders and permissions"
```

---

### Task 3: Custom Development Document Dropdown with Colored Pills

**Files:**
- Modify: `web/src/types/api.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/views/DevelopmentView.tsx`

- [ ] **Step 1: Update web API client with `setActivePhase`**

- In `web/src/api/client.ts`:
  `setActivePhase: (phaseId: string) => call<{ activePhase: string }>('POST', '/api/workflow/active-phase', { phaseId }),`
- In `web/src/api/useTurnStream.ts`:
  Allow passing `activePhase` in `sendTurn(prompt, activePhase?)`.

- [ ] **Step 2: Build custom document dropdown component in `web/src/views/DevelopmentView.tsx`**

- Replace native `<select>` with a custom dropdown:
  - Trigger button: min-h-[44px], shows document name + right-aligned status badge + chevron.
  - Dropdown popover: listbox with `role="listbox"`, item rows with min-h-[44px], highlighted on hover/focus.
  - Right-aligned colored status pills on each item:
    - **Completed** (emerald pill: `bg-emerald-950/80 text-emerald-300 border border-emerald-800` "Completed")
    - **In Work** (sky pill: `bg-sky-950/80 text-sky-300 border border-sky-800` "In Work")
    - **Not Drafted** (slate pill: `bg-slate-800 text-slate-400 border border-slate-700` "Not Drafted")
- When user clicks an item:
  - `setSelectedPhase(p.id)`
  - Calls `api.setActivePhase(p.id)`
  - Refreshes document view and notifies `onProjectChanged()`

- [ ] **Step 3: Verify frontend build**

Run: `npm --prefix web run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/
git commit -m "feat(web): custom development document dropdown with status pills and active phase sync"
```

---

### Task 4: Active Project CONOPS.md Redo & Dashboard Full-Width Verification

**Files:**
- Modify: `C:\Users\makel\OneDrive\Desktop\starn test\docs\CONOPS.md`
- Inspect: verify `extractConopsCharter` produces all 7 subsections and dashboard shows full-width 2-column cards.

- [ ] **Step 1: Read and transform `C:\Users\makel\OneDrive\Desktop\starn test\docs\CONOPS.md`**

Transform Section 1 into `## 1. Project Overview & Charter` with:
- `### Background & Problem`
- `### Purpose`
- `### Objectives`
- `### Success Criteria`
- `### Scope` (with `**In scope:**` and `**Out of scope:**`)
- `### Users & Stakeholders`
- `### Key Constraints & Assumptions`
- `### System-Level Capabilities` (preserving tractor conversion capabilities)
Keep Sections 2 through 6 intact.

- [ ] **Step 2: Test extraction on updated CONOPS**

Run node script to verify `extractConopsCharter` extracts 7 subsections + capabilities excluded.

- [ ] **Step 3: Commit**

---

### Task 5: Build Scripts Update, Dist Compilation & Final Verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `"build"` in `package.json`**

Change `"build": "tsc"` to `"build": "tsc && npm --prefix web run build"`.

- [ ] **Step 2: Run full build and test suite**

Run: `npm run build && npm test`
Verify `dist/` contains all endpoints and routes.

- [ ] **Step 3: Commit and push**

```bash
git add package.json
git commit -m "build: compile backend and web frontend in build script"
git push origin master
```
