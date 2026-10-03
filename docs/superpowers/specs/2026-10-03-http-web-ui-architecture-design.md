# Architectural Specification: Independent HTTP Server & Web UI Overlay

- **Date:** 2026-10-03
- **Status:** Proposed
- **Authors:** STARN Core Engineering Team

---

## 1. Executive Summary & Core Principles

This specification defines the architecture, data contracts, and implementation design for layering an independent **HTTP Server** and **Web User Interface** on top of the STARN engine.

### Non-Negotiable Core Constraints:
1. **Presentation Independence:** Core logic (`src/core/*`, `src/workspace/*`, `src/specialists/*`, `src/tools/*`) remains strictly headless and I/O-agnostic. Core modules must compile and run with **zero** presentation-layer imports.
2. **Dual-Mode Operation:** The terminal CLI (`starn`) continues to function exactly as before. The web interface is activated via a command-line flag (`starn --web`) or npm script (`npm run web`).
3. **Single Source of Truth on Disk:** Markdown documents (`docs/`) and `.starn/state.json` remain the authoritative git-versioned source of truth. The backend parses Markdown into typed JSON for frontend consumption and translates UI edits back into surgical disk edits via `fs_edit` / `fs_write`.
4. **Strict Protocol Contract:** The web UI does not alter or bypass the backend engine's workflow logic or state transitions. All interactions occur via typed REST endpoints and Server-Sent Events (SSE).
5. **Digital Twin Seam:** The UI architecture provides a designated viewport canvas and subsystem coordinate tagging (`SS-xx`) that the upcoming 3D Digital Twin HUD will mount into without refactoring.

---

## 2. System Architecture & Repository Layout

The system uses an isolated two-tier structure:
- **Backend HTTP Adapter:** Located in `src/server/` within the main TypeScript codebase. Uses Node built-in HTTP server or lightweight framework with zero CLI dependencies.
- **Frontend Sub-Project:** Located in `web/` as a dedicated Vite + React + Tailwind CSS single-page application.

```
STARN/
├── src/
│   ├── core/                  # Headless agent loop, classifier, critic, compaction
│   ├── workspace/             # State management, roadmap, directory scaffolding
│   ├── specialists/           # 13 specialists (prompts, rubrics, secret sauce)
│   ├── tools/                 # Sandboxed tool registry (fs_read, fs_edit, etc.)
│   │
│   ├── cli/                   # Terminal Presentation Adapter (chalk, ora, @inquirer)
│   │   ├── index.ts           # Interactive terminal runner
│   │   ├── checkpoint.ts      # Terminal checkpoint review
│   │   └── doc-viewer.ts      # Terminal paged document viewer
│   │
│   ├── server/                # HTTP Presentation Adapter (REST + SSE)
│   │   ├── index.ts           # HTTP server bootstrapping & lifecycle
│   │   ├── session.ts         # In-memory turn coordinator & active connection registry
│   │   ├── routes/
│   │   │   ├── project.ts     # /api/project, /api/roadmap, /api/settings
│   │   │   ├── turns.ts       # /api/turns (SSE streaming execution)
│   │   │   ├── checkpoints.ts # /api/checkpoints (decisions & feedback)
│   │   │   ├── docs.ts        # /api/docs (CRUD, live markdown edit, manual approve)
│   │   │   ├── bom.ts         # /api/bom (parsed procurement rows & rollup)
│   │   │   ├── actions.ts     # /api/actions (work instructions & checklists)
│   │   │   └── artifacts.ts   # /api/artifacts (photo upload & media serving)
│   │   └── parsers/           # Markdown table <-> JSON bidirectional parsers
│   │       ├── bom-parser.ts
│   │       ├── work-instructions-parser.ts
│   │       └── testplans-parser.ts
│   │
│   └── index.ts               # Root entrypoint with flag dispatcher (`--web` vs CLI)
│
├── web/                       # Independent Frontend Project (Vite + React)
│   ├── package.json           # React, Tailwind, Lucide, Markdown editor dependencies
│   ├── tsconfig.json          # DOM-only types (isolated from Node backend types)
│   ├── vite.config.ts         # Dev server with proxy to http://localhost:3000
│   └── src/
│       ├── api/               # Typed REST client & SSE EventSource hooks
│       ├── components/        # Reusable UI components (Modals, Badges, Tables, Scorecard)
│       ├── layouts/           # AppShell, TopNav tabs, Status bar
│       ├── views/
│       │   ├── DevelopmentView.tsx       # Tab 1: Split Chat + Live Document Preview/Editor
│       │   ├── DashboardView.tsx         # Tab 2: Project Metadata, 13-Phase Roadmap, Health
│       │   ├── BomView.tsx               # Tab 3: Sourcing Trade Study + Procurement Ledger
│       │   ├── WorkInstructionsView.tsx  # Tab 4: Shop Checklist, Active Action, Artifacts
│       │   └── SettingsView.tsx          # Tab 5: Model Selection (Agent, Critic, Twin)
│       └── main.tsx
```

### Dual-Mode Execution Routing
1. **Terminal Mode (`starn`):**
   Parses `process.argv`. If `--web` is absent, invokes `runCliSession()` from `src/cli/index.js`.
2. **Web Mode (`starn --web [path] [--port 3000]` or `npm run web`):**
   Initializes `ProjectStateManager`, `ToolRegistry`, `SpecialistRegistry`, launches HTTP server on `localhost:3000` (or configured port), displays local network URL (e.g. `http://192.168.1.50:3000` for tablet use), and opens default browser.

---

## 3. Strict API Protocol & Data Contracts

All endpoints return standard JSON with uniform error envelopes:
```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

### 3.1 Project & State Endpoints
- `GET /api/project`:
  - Returns: `{ id, name, activePhase, summary, openQuestionsCount, openRisksCount, models: { agent, critic, compaction } }`
- `GET /api/roadmap`:
  - Returns: Array of 13 canonical phases:
    `[ { id, name, status: "COMPLETED"|"IN_PROGRESS"|"PENDING_REVIEW"|"LOCKED", artifactPath, contentHash } ]`
- `GET /api/settings`:
  - Returns current model configurations and available OpenRouter models.
- `POST /api/settings`:
  - Payload: `{ agentModel?, criticModel?, compactionModel?, digitalTwinModel? }`
  - Updates `.starn/config.json`.

### 3.2 Turn Execution & Live Streaming (`POST /api/turns`)
Initiates an AI agent turn. The response is an HTTP 200 `text/event-stream` (Server-Sent Events):

| Event Name | Payload Structure | Description |
|---|---|---|
| `status` | `{ message: string, phase: string }` | Discovery, classifier routing, specialist loading |
| `tool_call` | `{ tool: string, args: Record<string, any> }` | Tool invocations (`fs_read`, `fs_edit`, etc.) |
| `tool_result` | `{ tool: string, success: boolean }` | Tool execution outcome |
| `auto_revision` | `{ revision: number, maxRevisions: number, score: number, feedback: string }` | Critic loop auto-revision attempt |
| `complete` | `{ specialistId: string, output: string, requiresReview: boolean, criticResult?: CriticResult }` | Turn completed; triggers checkpoint if `requiresReview: true` |
| `error` | `{ message: string }` | Unhandled error or abort notification |

### 3.3 Checkpoint Review & Decisions
When a turn finishes with `requiresReview: true`:
- `GET /api/checkpoints/pending`:
  - Returns active checkpoint: `{ specialistId, specialistName, artifactId, artifactPath, scorecard: { score, passed, summary, strengths, deficiencies, actionableSuggestions } }`
- `POST /api/checkpoints/decision`:
  - Payload: `{ decision: "approve" | "reject" | "feedback", feedbackText?: string }`
  - Behavior:
    - `"approve"`: Computes SHA-256 hash of artifact, saves to `state.json`, advances phase, resolves checkpoint.
    - `"reject"`: Reverts artifact to previous snapshot or draft status.
    - `"feedback"`: Submits user feedback (with optional critic scorecard suggestions) into the agent loop for immediate revision.

### 3.4 Documents & Live Editing
- `GET /api/docs/:phaseId`:
  - Returns: `{ phaseId, artifactPath, content: string, status: string, hash: string, lastModified: string }`
- `PUT /api/docs/:phaseId`:
  - Direct live editing from the Web UI.
  - Payload: `{ content: string, reason?: string }`
  - Behavior: Creates an automatic backup in `.starn/backups/` and saves using `fs_write` / `fs_edit`.
- `POST /api/docs/:phaseId/approve`:
  - Direct zero-token manual approval (advances workflow without running an LLM turn).
- `POST /api/docs/:phaseId/revert`:
  - Reverts document status to draft.

### 3.5 BOM & Sourcing Endpoints
- `GET /api/bom`:
  - Parsed representation of `docs/BOM.md` and `docs/TRADE_STUDY.md`:
  ```json
  {
    "procurement": [
      {
        "itemId": 1,
        "part": "Hyper9 AC Motor (100V)",
        "subsystem": "SS-02 Powertrain",
        "qty": 1,
        "sourceUrl": "https://evwest.com/hyper9",
        "orderNumber": "EVW-98421",
        "status": "Received",
        "estUnit": 4200,
        "estTotal": 4200,
        "actualTotal": 4150,
        "variance": -50,
        "notes": "Lead time 6 weeks"
      }
    ],
    "financials": {
      "totalEstimated": 12500,
      "totalActual": 11800,
      "netVariance": -700,
      "procurementProgressPercent": 75.0
    },
    "tradeStudyContent": "# Subsystem Trade Studies..."
  }
  ```
- `PATCH /api/bom/items/:itemId`:
  - Payload: `{ status?, orderNumber?, actualTotal?, notes? }`
  - Surgically updates the corresponding table row in `docs/BOM.md` and recalculates financial rollups.

### 3.6 Shop Work Instructions, Testing & Evidence Endpoints
- `GET /api/actions`:
  - Returns list of Master Actions from `BUILD_SEQUENCE_{GATE}.md` with work instruction status and prerequisite completion flags.
- `GET /api/actions/:actionNumber`:
  - Returns parsed work instruction document (`ACTION-<NUM>-...-WORK-INSTRUCTION.md`):
    - Subsystem, status, prerequisites.
    - Step-by-step checklist items with checked states.
    - Associated tooling, torque specs, safety callouts.
    - Gated test plan requirements.
    - Hardware non-conformance status.
- `PATCH /api/actions/:actionNumber/checklist`:
  - Payload: `{ stepIndex: number, checked: boolean }`
  - Updates checkbox `[x]` directly in the Markdown file on disk.
- `POST /api/artifacts/upload`:
  - Multipart form upload for shop photos or test records.
  - Form fields: `actionNumber`, `slug`, `version`, `descriptor`, `file`.
  - Saves file deterministically to:
    `artifacts/ACTION-<NUM>-<SLUG>-WI-<VERSION>-<DESCRIPTOR>.<ext>`
  - Updates the Evidence Table in the corresponding work instruction file.
- `GET /api/artifacts/:filename`:
  - Static streaming of stored photo/test artifacts.

---

## 4. Frontend View Specifications (Top Navigation Tabs)

The application shell provides persistent top tabs allowing frictionless switching across views:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  STARN  |  [Project Development]  [Dashboard]  [BOM & Sourcing]  [Shop Work]  [Settings]│
│  Active: Powertrain (Phase 6)  ● Connected (Port 3000)               Model: Claude-3.7  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Tab 1: Project Development View (Split Screen)
The primary creative workspace for interacting with the AI agent and authoring artifacts.

```
┌──────────────────────────────────────┬─────────────────────────────────────────┐
│ LEFT PANEL: Agent Chat & Review     │ RIGHT PANEL: Live Document Workspace    │
│                                      │                                         │
│ [Agent Message History]              │ Title: docs/BOM.md                      │
│ - Specialist classification badge    │ Status: [PENDING_REVIEW (Critic: 88)]   │
│ - Live expandable tool execution log │ Controls: [Edit Mode] [Save] [Approve]  │
│ - Ephemeral Critic review findings   │                                         │
│                                      │ --------------------------------------- │
│ [CRITIC SCORECARD BANNER]            │ Full Interactive Markdown Preview /     │
│ Score: 88/100 (PASSED)               │ In-Place Editor (Split or Tabbed):      │
│ [Approve & Lock] [Request Revisions] │ - Real-time scroll sync                 │
│                                      │ - Rich Markdown rendering               │
│ [User Prompt Input Box]              │ - Direct syntax-highlighted editor      │
│ [🎤 Voice Record] [/quick chips]     │ - Live table-of-contents sidebar        │
└──────────────────────────────────────┴─────────────────────────────────────────┘
```

- **Left Panel (Agent Conversation & Stream):**
  - Displays turn history with role icons and specialist badges.
  - In-flight execution accordion: reveals real-time discovery events, tool calls (`fs_read`, `fs_edit`), and auto-revision loops.
  - Checkpoint Modal/Banner: Appears when a draft is completed. Shows harsh critic scorecard (Score, Strengths, Deficiencies, Suggestions) with one-click **[Approve & Lock]** or **[Request Revision]** (auto-populating the prompt with critic feedback).
  - Voice Capture button using HTML5 `MediaRecorder` API to capture speech, send for transcription, and inject into the prompt box.
- **Right Panel (Document Workspace):**
  - Displays the active drafted document in its entirety.
  - Toggle between **Formatted Preview** and **Real-Time Editor**.
  - Edit button enables direct typing; **[Save Changes]** triggers `PUT /api/docs/:phaseId`, writing changes to disk with automatic version backup.

---

### Tab 2: Project Dashboard View
A high-level command center showing comprehensive project health and status.

- **Project Metadata Card:** Project Name, Target Goal, Active Workflow Phase, Total Estimated Budget, Open Risks.
- **13-Phase Canonical Workflow Roadmap:**
  - Interactive vertical timeline showing all 13 phases in order.
  - Phase badges:
    - 🟢 `COMPLETED` (displays SHA-256 hash and approval timestamp).
    - 🔵 `IN_PROGRESS` (currently active authoring phase).
    - 🟡 `PENDING_REVIEW` (drafted, awaiting checkpoint approval).
    - 🔒 `LOCKED` (upstream prerequisites incomplete).
  - Clicking any phase opens its document in the viewer or loads its specialist.
- **Document Repository Index:** Table of all generated documents with file size, last modified timestamp, and quick-download buttons.
- **Open Questions & Risks Panel:** Displays unresolved engineering questions and active failure modes cataloged in `docs/RISK_REGISTER.md`.

---

### Tab 3: BOM & Sourcing View
A dedicated two-tier procurement and trade-study interface.

- **Top Row Financial Cards:**
  - `Total Budget Estimated` | `Committed / Actual Spend` | `Net Variance (+/-)` | `Procurement % Complete`
- **Main View Panels (Side-by-Side or Stacked):**
  - **Tier 1: Master Procurement Ledger (`docs/BOM.md`):**
    - High-density interactive datatable with sorting and search.
    - Columns: Item #, Part / Description, Subsystem, **Qty**, Supplier Link (clickable), Order & Tracking # (editable), **Status Dropdown** (`Identified` | `Ordered` | `Shipped` | `Received` | `Bench Tested`), Est. Price, Actual Price (editable), Variance.
    - Editing a status or price row auto-updates `docs/BOM.md` via `PATCH /api/bom/items/:id`.
  - **Tier 2: Candidate Trade Studies (`docs/TRADE_STUDY.md`):**
    - Displays subsystem trade-off tables comparing candidates against motor controller compatibility, voltage ratings, and lead times.

---

### Tab 4: Shop Work Instructions & Testing View
The hands-on shop-floor command center for execution, assembly, and testing.

```
┌────────────────────────────────────────────────────────┬──────────────────────┐
│ WORK INSTRUCTIONS & SHOP ACTIONS                       │ ACTION ARTIFACTS     │
│                                                        │                      │
│ Milestone Filter: [All] [MVC] [IOC] [FOC]              │ [ACTION-03 Gallery]  │
│                                                        │                      │
│ Master Action Table:                                   │ ┌──────────────────┐ │
│ 1. ACTION-01: Remove Diesel Engine        [COMPLETED]  │ │ [Photo 1: Mount] │ │
│ 2. ACTION-02: Shaft Pilot Measurement     [COMPLETED]  │ └──────────────────┘ │
│ 3. ACTION-03: Mount Motor & Bellhousing   [ACTIVE]     │ ┌──────────────────┐ │
│                                                        │ │ [Photo 2: Torque]│ │
│ ------------------------------------------------------ │ └──────────────────┘ │
│ Active Action: ACTION-03 Mount Motor                   │                      │
│ Status: IN-PROGRESS                                    │ Upload New Artifact: │
│ Prerequisites: ACTION-01 [x], ACTION-02 [x]            │ [ Choose File / Cam] │
│                                                        │                      │
│ Step-by-Step Shop Checklist:                           │ Linked Tests:        │
│ [x] Step 1: Clean bellhousing mating face.             │ - TP-MVP-01: Runout  │
│ [ ] Step 2: Torque 4x Grade 8 bolts to 45 ft-lbs.      │   Status: PASSED     │
│ [ ] Step 3: Measure radial runout (TP-MVP-01).         │   Result: 0.038 mm   │
│                                                        │                      │
│ [Mark Step Done]  [Report Non-Conformance]  [Next >>]  │                      │
└────────────────────────────────────────────────────────┴──────────────────────┘
```

- **Master Action Checklist:**
  - Displays all actions from `BUILD_SEQUENCE_{GATE}.md` with completion indicators.
  - Automatically highlights **"What's Currently Next"** based on prerequisite dependencies.
- **Active Interactive Work Instruction:**
  - Clicking any action opens its shop floor procedure (`ACTION-<NUM>-...-WORK-INSTRUCTION.md`).
  - Interactive checkboxes for each mechanical step: ticking a box immediately updates the Markdown file on disk.
  - Tool and Torque Callouts: Highlighted warning boxes for critical torque specs (e.g. `45 ft-lbs Dial Torque Wrench`).
  - Inline Agent Command: "Talk to AI" quick prompt to report progress ("Step 2 completed, moving to runout measurement").
- **Integrated Test Plans Gating:**
  - Displays inline test procedures (`TP-MVP-xx`) required by this action.
  - Prevents marking action complete until prerequisite test data entry passes acceptance thresholds.
- **Artifacts & Evidence Side Gallery:**
  - Shows all photos, dial indicator logs, and torque audit records saved in `artifacts/` for the selected action.
  - Native Drag-and-Drop or Camera Capture button: uploads files directly to `artifacts/` with standard naming (`ACTION-03-MOUNT-MOTOR-WI-1-TORQUE.jpg`) and updates the document table.

---

### Tab 5: Settings & Model Assignment View
Centralized configuration management for AI models and server parameters.

- **Agent Model Selector:** Select model for main specialist turns (e.g. `anthropic/claude-3.7-sonnet`, `deepseek/deepseek-r1`).
- **Critic Model Selector:** Assign dedicated harsh critic model (can be a distinct high-reasoning model).
- **Compaction Model Selector:** Assign fast/cheap context compaction model (e.g. `google/gemini-2.0-flash-001`).
- **Digital Twin Model Selector:** Pre-configured slot to assign the spatial reasoning/mesh synthesis model for Phase 3.
- **API & Connection Config:**
  - OpenRouter API Key input & validation check.
  - Server port configuration (default: 3000).
  - Project directory path switch (allows pointing STARN to different hardware project folders without restarting).

---

## 5. Clean Separation Verification Rules

To guarantee that the frontend does not leak into the backend logic:
1. `src/server/` and `web/` must NEVER be imported by `src/core/*`, `src/specialists/*`, `src/workspace/*`, or `src/tools/*`.
2. `tsc --noEmit` runs as part of `npm test` verifying that no DOM types or frontend code pollute the backend.
3. The frontend communicates **strictly via the JSON API**. It has no direct filesystem access, no direct OpenRouter access, and cannot mutate `.starn/state.json` except through validated server endpoints.
4. CLI functionality remains fully operational: running `starn` or running the test suite (`vitest`) will execute without starting or requiring the web server.

---

## 6. Implementation Stages

- **Stage 1: Headless Server & Strict REST/SSE API (`src/server/`)**
  - Implement HTTP server, session coordinator, Markdown table parsers (BOM, Work Instructions), SSE streaming turn runner, and artifact upload handler.
  - Unit and integration tests in `tests/server.test.ts`.
- **Stage 2: Frontend Scaffolding & Top Navigation Shell (`web/`)**
  - Scaffold Vite + React + Tailwind sub-project in `web/`.
  - Build persistent Top Navigation Bar with active status, connection health, and view switcher.
- **Stage 3: Project Development & Dashboard Views**
  - Build Tab 1 (Split Chat Stream + Live Markdown Document Preview & Editor).
  - Build Tab 2 (Project Dashboard, 13-Phase Roadmap Timeline, Metadata Cards).
  - Build Critic Scorecard Banner & Checkpoint Review Modal.
- **Stage 4: BOM, Shop Work Instructions & Evidence Views**
  - Build Tab 3 (Two-Tier BOM Datatable, Trade Studies, Financial Cost Rollup).
  - Build Tab 4 (Master Action Checklist, Interactive Work Instructions, Gated Testing, Artifacts Photo Uploader & Gallery).
- **Stage 5: Settings Tab, CLI Integration & End-to-End Polish**
  - Build Tab 5 (Model selection, OpenRouter config, port setting).
  - Wire `--web` flag in `src/index.ts` and add `npm run web` / `npm run dev:web` scripts.
  - Verify complete workflow on local machine and local network IP.
