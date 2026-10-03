# Independent HTTP Server & Web UI Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent HTTP server adapter (`src/server/`) and a modern 7-tab React web user interface (`web/`) on top of the headless STARN engine without altering backend agent logic, preserving dual-mode CLI and Web execution.

**Architecture:** The backend engine remains strictly headless and I/O-agnostic; `src/server/` exposes typed REST and SSE endpoints that translate between on-disk Markdown/state and JSON. The frontend (`web/`) is an isolated Vite + React + Tailwind single-page application with 7 persistent tabs (Development Split View, Dashboard with Financials, BOM & Sourcing, Shop Work Instructions & Testing, Questions & Issues, 3D Digital Twin Viewport, and Settings). Dual CLI/Web execution is enabled via `starn --web` and `npm run web`.

**Tech Stack:** TypeScript (strict), Node built-in HTTP / lightweight REST router, Server-Sent Events (SSE), Vite, React 18, Tailwind CSS, Lucide Icons.

**Spec:** `docs/superpowers/specs/2026-10-03-http-web-ui-architecture-design.md`

---

## Global Constraints

- **I/O-Agnostic Core:** `src/core/*`, `src/workspace/*`, `src/specialists/*`, and `src/tools/*` must NEVER import from `src/cli/*` or `src/server/*`.
- **Zero DOM Pollution:** Node backend must compile cleanly with `tsc --noEmit` without DOM typings. `web/` maintains its own isolated `tsconfig.json`.
- **Single Source of Truth:** Markdown files in `docs/` and `.starn/state.json` remain the version-controlled source of truth on disk.
- **Strict Protocol:** Web UI only communicates via typed HTTP endpoints; it cannot directly mutate state files or call LLMs outside the server turn manager.
- **Continuous UI Self-Critique & Iteration:** The agent must critically evaluate each UI component against harsh quality standards (visual hierarchy, shop-floor ergonomics, contrast ratios, responsive scaling, touch target sizes, error handling, empty states) and iterate iteratively until the interface is polished, sharp, and highly functional.
- **Dual-Mode Execution:** `starn` runs terminal CLI as before; `starn --web` launches HTTP server and serves compiled UI.
- **All tests pass:** Every task must pass `tsc --noEmit && vitest run`.

---

## Review Focus

1. **Clean Core Decoupling:** Does `src/core/runner.ts` have zero imports from `src/cli/*`?
2. **SSE Reconnection & Cancellation:** When the browser aborts an SSE connection or issues an abort, does the server cleanly signal `AbortSignal` to `CoreRunner`?
3. **Markdown Table Round-Trip:** Does editing a BOM cell or toggling a Work Instruction checkbox preserve formatting without truncating unrelated sections?
4. **Checkpoint Synchronization:** If a browser disconnects mid-checkpoint, does `GET /api/checkpoints/pending` accurately restore the pending critic review on reconnect?
5. **Deterministic Artifact Naming:** Does photo upload save strictly to `artifacts/ACTION-<NUM>-<SLUG>-WI-<VERSION>-<DESCRIPTOR>.<ext>` and update the work instruction document?
6. **Shop-Floor Usability & Ergonomics:** Are buttons and touch targets at least 44px for tablet use on the shop floor? Are critical torque and safety specs rendered in high-visibility callouts?
7. **Zero Flash of Unstyled / Empty Content (FOUC):** Are skeletons, spinners, and clean empty states present when documents, BOM items, or actions are loading or empty?

---

## File Structure

```
STARN/
├── src/
│   ├── core/
│   │   ├── formatters.ts      # Headless text formatters (extracted from cli/ui.ts)
│   │   └── runner.ts          # Imports from core/formatters.ts, NOT cli/ui.ts
│   │
│   ├── server/
│   │   ├── types.ts           # Server API request/response types
│   │   ├── parsers/
│   │   │   ├── bom-parser.ts  # Parses docs/BOM.md & updates rows
│   │   │   ├── actions-parser.ts # Parses work instructions & checklist updates
│   │   │   └── issues-parser.ts  # Aggregates defects & open builder questions
│   │   ├── session.ts         # In-memory turn coordinator & checkpoint state
│   │   ├── router.ts          # HTTP request router for /api/* and static assets
│   │   └── server.ts          # HTTP server instantiation, port binding, browser launch
│   │
│   └── index.ts               # CLI / Web flag dispatcher
│
├── web/
│   ├── package.json           # React, Tailwind, Lucide dependencies
│   ├── tsconfig.json          # React DOM types
│   ├── vite.config.ts         # Dev server with proxy to :3000
│   ├── tailwind.config.js     # Dark theme shop-floor styling
│   └── src/
│       ├── types/api.ts       # Typed API models matching server
│       ├── api/client.ts      # REST fetch wrapper & SSE turn stream hook
│       ├── layouts/AppShell.tsx # Persistent TopNav (7 tabs) + status header
│       └── views/
│           ├── DevelopmentView.tsx       # Tab 1: Split Chat + Live Document Preview/Editor
│           ├── DashboardView.tsx         # Tab 2: Metadata, Financials, 13-Phase Roadmap
│           ├── BomView.tsx               # Tab 3: Sourcing Trade Study + Procurement Ledger
│           ├── WorkInstructionsView.tsx  # Tab 4: Shop Checklist, Active Action, Artifacts
│           ├── IssuesAndQuestionsView.tsx# Tab 5: Hardware Non-conformances, Open Questions
│           ├── DigitalTwinView.tsx       # Tab 6: 3D Viewport Stage, Subsystem Tree HUD
│           └── SettingsView.tsx          # Tab 7: Model Selection (Agent, Critic, Twin)
│
└── tests/
    ├── server-parsers.test.ts # BOM, Work Instructions, Issues parsing tests
    ├── server-api.test.ts     # REST & SSE endpoint integration tests
    └── core-decoupling.test.ts# Asserts core has zero cli imports
```

---

## Tasks

### Task 1: Decouple Core Formatting from CLI (`src/core/formatters.ts`)

**Files:**
- Create: `src/core/formatters.ts`
- Modify: `src/core/runner.ts:16-17`
- Modify: `src/cli/ui.ts:1-25`
- Test: `tests/core-decoupling.test.ts`

**Interfaces:**
- Produces: `formatWorkflowRoadmap(phases: WorkflowPhaseSummary[]): string`, `formatHelp(): string`, `formatOpenQuestionsReport(questions: OpenQuestionItem[]): string` in `src/core/formatters.ts`.
- Consumes: Used by `src/core/runner.ts` and `src/cli/ui.ts`.

- [x] **Step 1: Write the failing test in `tests/core-decoupling.test.ts`**

Assert that no file inside `src/core/` imports from `src/cli/`.

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Core Decoupling Verification', () => {
  it('ensures src/core has zero imports from src/cli', () => {
    const coreDir = path.resolve(__dirname, '../src/core');
    const files = fs.readdirSync(coreDir).filter(f => f.endsWith('.ts'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(coreDir, file), 'utf-8');
      expect(content).not.toMatch(/from\s+['"][^'"]*\/cli\//);
      expect(content).not.toMatch(/import\s+[^'"]*\/cli\//);
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core-decoupling.test.ts`  
Expected: FAIL (`src/core/runner.ts` imports from `../cli/ui.js`).

- [x] **Step 3: Move headless text formatters into `src/core/formatters.ts`**

Move `formatWorkflowRoadmap`, `formatHelp`, and `formatOpenQuestionsReport` (which contain zero chalk/ora logic) into `src/core/formatters.ts`. Update `src/core/runner.ts` to import them from `./formatters.js`. Re-export them in `src/cli/ui.ts` for backward compatibility.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core-decoupling.test.ts`  
Expected: PASS.

- [x] **Step 5: Commit Task 1**

```bash
git add src/core/formatters.ts src/core/runner.ts src/cli/ui.ts tests/core-decoupling.test.ts
git commit -m "refactor(core): decouple formatting helpers from cli into core/formatters"
```

---

### Task 2: Server Markdown Table Parsers (`src/server/parsers/`)

**Files:**
- Create: `src/server/parsers/bom-parser.ts`
- Create: `src/server/parsers/actions-parser.ts`
- Create: `src/server/parsers/issues-parser.ts`
- Test: `tests/server-parsers.test.ts`

**Interfaces:**
- Produces:
  - `parseBomDocument(markdown: string): { items: BomItem[], financials: BomFinancials }`
  - `updateBomRow(markdown: string, itemId: number, updates: Partial<BomItem>): string`
  - `parseWorkInstruction(markdown: string): ParsedWorkInstruction`
  - `toggleWorkInstructionStep(markdown: string, stepIndex: number, checked: boolean): string`
  - `aggregateProjectIssues(workInstructions: ParsedWorkInstruction[], state: ProjectState): ProjectIssuesSummary`

- [x] **Step 1: Write failing unit tests in `tests/server-parsers.test.ts`**

Test parsing BOM tables with quantities and financial rollups, updating a BOM row, parsing work instruction checkboxes and non-conformance blocks, and toggling a checkbox.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server-parsers.test.ts`  
Expected: FAIL (modules not found).

- [x] **Step 3: Implement `bom-parser.ts`, `actions-parser.ts`, and `issues-parser.ts`**

Implement deterministic regex and line-based parsers that extract typed data from tables and make surgical replacements without rewriting unrelated sections.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server-parsers.test.ts`  
Expected: PASS.

- [x] **Step 5: Commit Task 2**

```bash
git add src/server/parsers/ tests/server-parsers.test.ts
git commit -m "feat(server): implement robust markdown parsers for BOM, work instructions, and issues"
```

---

### Task 3: Headless HTTP Server & Session Coordinator (`src/server/`)

**Files:**
- Create: `src/server/types.ts`
- Create: `src/server/session.ts`
- Create: `src/server/router.ts`
- Create: `src/server/server.ts`
- Test: `tests/server-api.test.ts`

**Interfaces:**
- Produces:
  - `ServerSessionManager`: Manages active turn execution, SSE client connections, pending critic checkpoints, and `AbortController`.
  - `createHttpServer(projectPath: string, options?: ServerOptions): http.Server`
  - Endpoints:
    - `GET /api/project`, `GET /api/dashboard`, `GET /api/roadmap`
    - `POST /api/turns` (SSE event streaming)
    - `GET /api/checkpoints/pending`, `POST /api/checkpoints/decision`
    - `GET /api/docs/:id`, `PUT /api/docs/:id`, `POST /api/docs/:id/approve`
    - `GET /api/bom`, `PATCH /api/bom/items/:id`
    - `GET /api/actions`, `GET /api/actions/:id`, `PATCH /api/actions/:id/checklist`
    - `GET /api/issues`, `POST /api/issues/:id/push-to-agent`
    - `POST /api/artifacts/upload`, `GET /api/artifacts/:filename`
    - `GET /api/settings`, `POST /api/settings`

- [x] **Step 1: Write integration tests in `tests/server-api.test.ts`**

Spin up test server on ephemeral port and test:
- `GET /api/project` returns correct project metadata and financial summary.
- `GET /api/roadmap` returns 13 phases.
- `POST /api/turns` streams SSE events (`event: status`, `event: complete`).
- `GET /api/checkpoints/pending` and `POST /api/checkpoints/decision`.
- `PATCH /api/bom/items/:id` updates `docs/BOM.md` on disk.
- `PATCH /api/actions/:id/checklist` toggles checkbox on disk.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server-api.test.ts`  
Expected: FAIL.

- [x] **Step 3: Implement server, session manager, and API routes**

Implement Node HTTP server using native `http` module (or lightweight Router) with multipart handling for photo uploads and SSE streaming.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server-api.test.ts`  
Expected: PASS.

- [x] **Step 5: Commit Task 3**

```bash
git add src/server/ tests/server-api.test.ts
git commit -m "feat(server): implement HTTP REST and SSE streaming server adapter"
```

---

### Task 4: Vite + React Frontend Scaffolding & Top Navigation Shell (`web/`)

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/types/api.ts`
- Create: `web/src/api/client.ts`
- Create: `web/src/api/useTurnStream.ts`
- Create: `web/src/layouts/AppShell.tsx`

**Interfaces:**
- Produces: Responsive AppShell with persistent Top Navigation Bar containing 7 tabs, project status header, model indicator, and connection health badge.

- [x] **Step 1: Scaffold `web/` project files**

Configure Vite, React, Tailwind CSS, Lucide-react, and DOM-only TypeScript configuration in `web/`.

- [x] **Step 2: Implement typed API client & SSE Turn Stream hook**

Implement `web/src/api/client.ts` (`fetchProject`, `fetchDashboard`, `fetchRoadmap`, `fetchBom`, `updateBomItem`, `fetchActions`, `toggleActionStep`, `uploadArtifact`, `submitCheckpointDecision`) and `useTurnStream` (SSE hook handling `status`, `tool_call`, `complete`, and abort).

- [x] **Step 3: Implement AppShell with 7-Tab Navigation**

Build `web/src/layouts/AppShell.tsx` rendering persistent top tabs:
1. `Development`
2. `Dashboard`
3. `BOM & Sourcing`
4. `Shop Work`
5. `Questions & Issues`
6. `3D Digital Twin`
7. `Settings`

- [x] **Step 4: Verify frontend build succeeds**

Run: `cd web && npm install && npm run build`  
Expected: Clean build output in `web/dist/`.

- [x] **Step 5: Commit Task 4**

```bash
git add web/
git commit -m "feat(web): scaffold Vite+React sub-project with AppShell and API client"
```

---

### Task 5: Implement Tab 1 (Development Split View) & Tab 2 (Dashboard)

**Files:**
- Create: `web/src/views/DevelopmentView.tsx`
- Create: `web/src/components/ChatPanel.tsx`
- Create: `web/src/components/ToolCallLog.tsx`
- Create: `web/src/components/CriticScorecardBanner.tsx`
- Create: `web/src/components/DocumentWorkspace.tsx`
- Create: `web/src/views/DashboardView.tsx`
- Create: `web/src/components/FinancialCards.tsx`
- Create: `web/src/components/RoadmapTimeline.tsx`

**Interfaces:**
- Produces:
  - `DevelopmentView`: Split screen with Chat, Tool execution log, Critic Scorecard review modal/banner with Approve/Revision buttons, Voice prompt capture, and Right-hand live Markdown document preview & editor.
  - `DashboardView`: Top financial overview cards, 13-Phase Roadmap with status badges, and document index.

- [x] **Step 1: Implement `DevelopmentView.tsx` and child components**

Left panel: turn history, live streaming tool calls, Critic Scorecard banner (0-100 score, strengths, deficiencies, suggestions), checkpoint approve/reject/revision buttons, prompt input with voice capture.
Right panel: full document Markdown preview with table-of-contents, toggleable in-place editor, and [Save Changes] button.

- [x] **Step 2: Implement `DashboardView.tsx` and child components**

Top financial overview cards (Budget Estimated, Actual Spend, Variance, % Complete), project metadata, 13-phase vertical roadmap with status badges (Green check, Blue pulse, Amber shield, Gray lock), and document library table.

- [x] **Step 3: Test build of frontend**

Run: `cd web && npm run build`  
Expected: PASS.

- [x] **Step 4: Commit Task 5**

```bash
git add web/src/views/DevelopmentView.tsx web/src/views/DashboardView.tsx web/src/components/
git commit -m "feat(web): implement Development split view and Dashboard with financials"
```

---

### Task 6: Implement Tab 3 (BOM & Sourcing) & Tab 4 (Shop Work Instructions)

**Files:**
- Create: `web/src/views/BomView.tsx`
- Create: `web/src/components/BomDatatable.tsx`
- Create: `web/src/components/TradeStudyViewer.tsx`
- Create: `web/src/views/WorkInstructionsView.tsx`
- Create: `web/src/components/ActionChecklist.tsx`
- Create: `web/src/components/ActiveInstructionViewer.tsx`
- Create: `web/src/components/ArtifactGallery.tsx`
- Create: `web/src/components/PhotoUploader.tsx`

**Interfaces:**
- Produces:
  - `BomView`: Two-tier BOM display (Tier 1 interactive procurement datatable with status dropdowns, tracking, actual costs, and variance + Tier 2 trade study candidate comparison cards).
  - `WorkInstructionsView`: Master action checklist with "What's Currently Next" indicator, interactive shop procedure with checkboxes, tool/torque warning callouts, inline gated test plans, and photo evidence side gallery with drag-and-drop / camera upload.

- [x] **Step 1: Implement `BomView.tsx` and components**

Datatable with sorting, search, clickable supplier links, status dropdown pills (`Identified` | `Ordered` | `Shipped` | `Received` | `Bench Tested`), editable tracking and actual price fields that patch the backend on change. Tab to switch to `docs/TRADE_STUDY.md`.

- [x] **Step 2: Implement `WorkInstructionsView.tsx` and components**

Milestone filter (`MVC`, `IOC`, `FOC`), Master Action Table, interactive action checklist updating disk via API, tool and torque callout cards, inline test plan gating, and side artifact gallery showing photos from `artifacts/` with photo upload button.

- [x] **Step 3: Test build of frontend**

Run: `cd web && npm run build`  
Expected: PASS.

- [x] **Step 4: Commit Task 6**

```bash
git add web/src/views/BomView.tsx web/src/views/WorkInstructionsView.tsx web/src/components/
git commit -m "feat(web): implement BOM procurement datatable and Shop Work Instructions view"
```

---

### Task 7: Implement Tab 5 (Questions & Issues), Tab 6 (3D Digital Twin Viewport), & Tab 7 (Settings)

**Files:**
- Create: `web/src/views/IssuesAndQuestionsView.tsx`
- Create: `web/src/views/DigitalTwinView.tsx`
- Create: `web/src/views/SettingsView.tsx`

**Interfaces:**
- Produces:
  - `IssuesAndQuestionsView`: Hardware non-conformance defect cards with photos, "Push to AI Agent" action button, open builder questions with inline reply input, and pending user actions.
  - `DigitalTwinView`: HTML5 `<canvas>` viewport stage with orbit controls, GLTF upload slot, subsystem hierarchy tree (`SS-01`, `SS-02`), and subsystem readiness heatmap.
  - `SettingsView`: Model selection dropdowns (Agent, Critic, Compaction, Digital Twin Model), OpenRouter API key validator, port configuration, and project directory switcher.

- [x] **Step 1: Implement `IssuesAndQuestionsView.tsx`**

Ticket view for non-conformances with defect photos, action links, and "Push to AI Agent for Impact Analysis & Shop Repair WI" button triggering a turn with pre-filled context. Open builder questions with inline answer input.

- [x] **Step 2: Implement `DigitalTwinView.tsx`**

Canvas viewport container with coordinate axes, camera controls, CAD/GLTF upload button, subsystem toggle list (`SS-01 Chassis`, `SS-02 Powertrain`, `SS-03 Battery Pack`), and readiness color badges (Green, Blue, Amber, Gray).

- [x] **Step 3: Implement `SettingsView.tsx`**

Form to select models for specialist turns, harsh critic, compaction, and digital twin generation; test OpenRouter connection; change port; and switch project path.

- [x] **Step 4: Test build of frontend**

Run: `cd web && npm run build`  
Expected: PASS.

- [x] **Step 5: Commit Task 7**

```bash
git add web/src/views/IssuesAndQuestionsView.tsx web/src/views/DigitalTwinView.tsx web/src/views/SettingsView.tsx
git commit -m "feat(web): implement Questions & Issues, 3D Digital Twin Viewport, and Settings views"
```

---

### Task 8: Continuous UI Self-Critique & Polish Loop (Harsh UI Critic Audit)

**Files:**
- Modify: `web/src/views/*`
- Modify: `web/src/components/*`
- Modify: `web/src/layouts/AppShell.tsx`

**Objectives:**
Conduct a rigorous multi-dimensional self-critique pass across all 7 views to ensure world-class aesthetic polish, hardware shop-floor ergonomics, and rock-solid state resiliency before final assembly.

- [x] **Step 1: Conduct 6-Dimension UI Quality Audit**
  Evaluate the complete frontend codebase against:
  1. *Typography & Contrast:* Deep dark theme (`bg-slate-950`, `border-slate-800`), crisp mono numbers for pricing and torque tolerances, high-contrast readable text.
  2. *Shop-Floor Ergonomics:* Minimum 44px touch targets on buttons, high-visibility amber/red safety callouts, tactile checklist checkbox styles.
  3. *Zero-FOUC & Empty States:* Beautiful skeleton loaders and helpful empty states when documents, BOM items, or issues are empty.
  4. *Optimistic Micro-Interactions:* Instant visual feedback when checking off work instruction steps or updating BOM items, with graceful error rollbacks.
  5. *Harsh Critic Scorecard Prominence:* Distinctive 0-100 score gauge, color-coded strengths (emerald), deficiencies (rose), and actionable suggestions (amber) with pre-fillable revision inputs.
  6. *Resilient Reconnection:* Automatic retry and visual connection badge (`Connected` / `Reconnecting...`) handling network drops.

- [x] **Step 2: Apply iterative polish and refactors**
  Execute surgical enhancements to components and styles identified during the self-critique pass.

- [x] **Step 3: Verify clean frontend build**
  Run: `cd web && npm run build`  
  Expected: PASS with 0 errors and 0 warnings.

- [x] **Step 4: Commit Task 8**
```bash
git add web/
git commit -m "refactor(web): apply self-critique polish pass for shop-floor ergonomics and visual fidelity"
```

---

### Task 9: CLI Integration, Build Automation & Verification

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `starn --web [projectPath] [--port 3000]` launches HTTP server and opens browser. `npm run web` runs server, `npm run build:web` builds React frontend into `web/dist/` for static serving.

- [x] **Step 1: Wire `--web` CLI option in `src/index.ts`**

In `src/index.ts`, inspect `process.argv`:
If `--web` flag is present:
- Parse optional project directory and port.
- Initialize `ProjectStateManager`, `ToolRegistry`, `SpecialistRegistry`.
- Call `startWebServer(projectPath, { port })`.
- Print banner with local URL and local network IP.
- Automatically open default browser (via `open` or platform launcher).
- Retain SIGINT handler for graceful server shutdown.
If `--web` is not present:
- Execute existing terminal CLI `runInteractiveSession()`.

- [x] **Step 2: Add scripts to root `package.json`**

```json
"scripts": {
  "build:web": "cd web && npm run build",
  "web": "tsx src/index.ts --web",
  "dev:web": "concurrently \"tsx src/index.ts --web\" \"cd web && npm run dev\""
}
```

- [x] **Step 3: Run full verification suite**

Run: `npm test` (`tsc --noEmit && vitest run`)  
Run: `npx tsc`  
Expected: 100% clean, zero type errors.

- [x] **Step 4: Commit Task 9**

```bash
git add src/index.ts package.json
git commit -m "feat(cli): wire --web flag and add web build scripts for dual-mode execution"
```

---

### Task 10: Push & Integration Verification

- [x] **Step 1: Push commits to `origin/master`**
- [x] **Step 2: Verify live local execution (`tsx src/index.ts --web`) with active project**
