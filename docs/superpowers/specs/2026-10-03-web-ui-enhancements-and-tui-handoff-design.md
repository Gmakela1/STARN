# Design Specification: Web UI Enhancements, Dashboard "Treasure Map" Roadmap, 2-Page Executive Briefing, 3-Tier Parts Tab, and TUI-to-Web Handoff

**Author:** AI Agent (STARN Core)  
**Date:** 2026-10-03  
**Status:** DRAFT (Awaiting Human Approval)  
**Target File:** `docs/superpowers/specs/2026-10-03-web-ui-enhancements-and-tui-handoff-design.md`

---

## 1. Executive Summary & Problem Statement

STARN's core architecture now includes an independent, presentation-agnostic HTTP REST/SSE server adapter (`src/server/`) and a modern 7-tab React 18 + Tailwind Web UI (`web/`). 

However, usability on the shop floor and executive reporting need specific enhancements:
1. **Frictionless Web Launch from CLI:** When running `npm start` (the TUI loop), users currently have to kill the process and restart with `--web` to access the browser. A `/web` runtime command should cleanly hand off the active CLI session to the browser without losing context.
2. **Shop Floor & Engineering Navigation:** Tab order needs realignment to match builder priorities: Executive Dashboard on the far left, followed by Development, Questions & Issues, Parts (revamped BOM), Work Instructions (renamed from Shop Floor), Digital Twin, and Settings.
3. **Visual "Treasure Map" Roadmap:** The current Dashboard renders the 13 workflow phases as a plain vertical list. Users requested an engaging, serpentine milestone path ("treasure map" aesthetic) on the Dashboard, while maintaining formal engineering phase-gate clarity in exported reports.
4. **2-Page Executive Briefing (Direct PDF Export):** Program managers need an exportable two-page briefing detailing project scope, financials, linear phase-gate flowchart, deliverable status, and active risks for stakeholders or offline shop packets, directly printable/saveable to PDF via `@media print`.
5. **3-Tier Parts Management:** The former "BOM & Sourcing" tab needs to be called **"Parts"** and split into three dedicated views:
   - **Sourcing:** Candidate trade studies and alternatives (`docs/TRADE_STUDY.md`) with compliance flags, lead times, and selection rationale.
   - **BOM:** Master engineering component list with subsystem groupings, required quantities, and estimated budget.
   - **Parts:** Procurement, shipping, order tracking, and actual cost reconciliation.
6. **Local / Private Digital Twin Models:** Preparation for local AI engines (Ollama, vLLM, LM Studio) on local IPs for spatial digital twin generation without sending 3D geometry to third-party cloud APIs.

---

## 2. Architecture & System Flow

```
                      +-----------------------------+
                      |   CLI TUI Session           |
                      |   (npm start)               |
                      +--------------+--------------+
                                     |
                           User types '/web'
                                     |
                                     v
                      +-----------------------------+
                      | In-Process Web Handoff      |
                      | - Initializes Session       |
                      | - startWebServer(port=3000) |
                      | - Opens Default Browser     |
                      | - Converts Terminal to Log  |
                      +--------------+--------------+
                                     |
                                     v
        +-------------------------------------------------------+
        |                 STARN Web UI (7 Tabs)                 |
        |                                                       |
        |  [1. Dashboard]       [2. Development]                |
        |  - Overview / Briefing - Split Chat + Doc Editor     |
        |  - S-Curve Treasure   - Critic Checkpoint Panel       |
        |    Map Roadmap                                        |
        |  - 2-Page PDF Export                                  |
        |                                                       |
        |  [3. Questions/Issues][4. Parts (3 Sub-Tabs)]         |
        |  - Non-Conformances   - [Sourcing] Trade Studies      |
        |  - Open Questions     - [BOM] System Components       |
        |                       - [Parts] Shipping & Logistics  |
        |                                                       |
        |  [5. Work Instructions][6. Digital Twin]  [7. Settings]
        |  - Shop Checklists     - Viewport Scaffold - OpenRouter/
        |  - Evidence Upload     - Subsystem Heatmap   Local IP  
        +-------------------------------------------------------+
```

---

## 3. Detailed Component Designs

### 3.1. CLI TUI-to-Web Handoff (`/web` command)

- **Entrypoint:** `src/index.ts` interactive loop.
- **Trigger:** When user inputs `/web`, `/browser`, or `/ui`.
- **Handoff Mechanism:**
  1. Print visual handoff notice in terminal.
  2. Instantiate `ServerSessionManager` using the current `currentProjectRecord.path`, `stateManager`, `client`, `selectedModel`, registries, and transfer all accumulated `sessionMessages`.
  3. Invoke `startWebServer` on port `3000` (or configured port) with `openBrowserOnStart: true`.
  4. Print local (`http://localhost:3000`) and LAN IP (`http://192.168.1.X:3000`) addresses.
  5. The interactive `while(true)` TUI prompt loop exits; the terminal transitions into a clean HTTP server status monitor that stays alive until `SIGINT` (`Ctrl+C`), which persists state and exits cleanly.

### 3.2. Top-Level Tab Reorganization (AppShell)

In `web/src/layouts/AppShell.tsx`:
```ts
export type TabId =
  | 'dashboard'
  | 'development'
  | 'issues'
  | 'parts'
  | 'work'
  | 'twin'
  | 'settings';

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'development', label: 'Development', icon: Bot },
  { id: 'issues', label: 'Questions & Issues', icon: MessageSquareWarning },
  { id: 'parts', label: 'Parts', icon: Boxes },
  { id: 'work', label: 'Work Instructions', icon: Wrench },
  { id: 'twin', label: 'Digital Twin', icon: Box },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];
```
- Default tab upon startup becomes **`dashboard`**.
- "Shop Floor" is renamed to **"Work Instructions"**.
- "BOM & Sourcing" is renamed to **"Parts"**.

### 3.3. Dashboard Revamp: Visual "Treasure Map" Roadmap & Executive Overview

#### 3.3.1. Project Overview / White Paper Card
- At the top of `DashboardView`, render a high-impact overview card:
  - Project Title & Target Domain (e.g. "Tractor Conversion - Heavy Agricultural Electric Repower").
  - System Scope & CONOPS Intent Summary.
  - Current Active Milestone Gate (e.g. `BOM` or `BUILD-SEQUENCE`).
  - Financial Rollup (Estimated Budget, Actual Committed Spend, Variance, Procurement Progress).
  - Prominent **"Export 2-Page Executive Briefing"** button with printer icon.

#### 3.3.2. Visual Serpentine Milestone Path ("Treasure Map" Aesthetic)
- Instead of a plain table or vertical list, phases are rendered along a responsive winding serpentine trail:
  - **Path SVG:** An SVG background path curves back and forth across 4 rows (e.g. row 1: Left-to-Right [CONOPS → ARCH → ICD → CAP], row 2: Right-to-Left [REQ ← BOM ← RTM ← MILESTONES], row 3: Left-to-Right [RISK → BUILD → WI → TEST], row 4: SOW).
  - **Milestone Stepping Stones (Nodes):**
    - Large circular or rounded card station for each of the 13 canonical phases.
    - Status ring color: Completed (Emerald `border-emerald-500 bg-emerald-950/80`), In Progress (Sky with pulse `border-sky-500 bg-sky-950/80`), Draft on Disk (Amber `border-amber-500 bg-amber-950/80`), Locked (Slate `border-slate-800 bg-slate-900/40`).
    - Phase number, name, and artifact filename.
    - Critic Score badge (e.g. `8.7`) when approved.
    - Open questions badge (e.g. `2 open`) in amber when unresolved questions exist.
  - **Node Interaction:** Clicking any milestone opens a slide-over drawer showing document metadata, critic scorecard, and a button to "Jump to Document in Development Editor".

#### 3.3.3. 2-Page Executive Briefing (Direct PDF Export)
- When clicking **"Export Executive Briefing"**:
  - Opens a full-screen print preview modal with an immediate **"Save as PDF / Print"** action (`window.print()`).
  - Uses CSS `@media print` with explicit page size and breaks:
    ```css
    @page {
      size: letter portrait;
      margin: 0.5in;
    }
    .briefing-page {
      page-break-after: always;
      height: 10in;
    }
    ```
  - **Page 1 (Project Executive Summary & Financials):**
    - STARN Header & Project Identity.
    - Mission & Operational Concept (CONOPS synopsis).
    - Subsystem Architecture & Interface Matrix (SS-01 through SS-08).
    - Financial & Procurement Rollup (Budget vs Actual Spend vs Variance table).
  - **Page 2 (Phase-Gate Linear Flowchart & Risk Matrix):**
    - **Clean Engineering Linear Flowchart:** Structured subway-style phase-gate flowchart showing the 13 phases across Concept, Engineering, Sourcing, and Assembly.
    - Deliverable Status & Approval Audit Matrix.
    - Critical Open Non-Conformances and High-Severity Risks.

---

### 3.4. Three-Tier "Parts" Tab Revamp (`PartsView.tsx`)

Inside `web/src/views/PartsView.tsx` (replacing `BomView.tsx`), a sticky secondary sub-tab navigation bar provides three distinct lenses on project hardware:

```
[ Parts Hub ]
+---------------------------------------------------------------+
|  ( Tab 1: Sourcing )   |  ( Tab 2: BOM )  |  ( Tab 3: Parts ) |
+---------------------------------------------------------------+
```

#### 3.4.1. Sub-Tab 1: Sourcing (Candidate Trade Studies & Alternatives)
- **Data Source:** `docs/TRADE_STUDY.md` via new backend parser `src/server/parsers/trade-study-parser.ts` and `GET /api/trade-study`.
- **UI Structure:**
  - Grouped by Subsystem (`SS-01 Traction Motor`, `SS-02 Battery & BMS`, etc.).
  - Subsystem requirements baseline.
  - Candidate comparison table:
    - `Candidate Part`
    - `Key Specs`
    - `Satisfies Req?` (`✅ Satisfies` | `⚠️ Partial/Risk` | `❌ Non-Compliant`)
    - `Lead Time`
    - `Est. Price`
    - `Vendor Link`
  - Selected Candidate Rationale & Trade-off notes.

#### 3.4.2. Sub-Tab 2: BOM (Engineering Bill of Materials)
- **Data Source:** `docs/BOM.md` parsed items.
- **UI Structure:**
  - Engineering-focused component breakdown.
  - Columns: `Item #`, `Subsystem`, `Part Name & Specifications`, `Quantity Required`, `Source / Vendor`, `Estimated Unit Price`, `Estimated Total`.
  - Filterable by Subsystem and searchable by keyword.
  - Subsystem cost allocation rollups.

#### 3.4.3. Sub-Tab 3: Parts (Procurement, Logistics & Shipping Tracker)
- **Data Source:** `docs/BOM.md` procurement fields.
- **UI Structure:**
  - Shop-floor and supply chain execution tracker.
  - Columns:
    - `Item #` & `Part Description`
    - `Order & Tracking #` (editable inline)
    - `Procurement Status` (interactive dropdown: `Identified` → `Ordered` → `Shipped` → `Received` → `Bench Tested`)
    - `Estimated Total`
    - `Actual Committed Spend` (editable inline)
    - `Variance` (color-coded over/under budget)
  - Quick action to open tracking carrier URLs or copy tracking numbers.
  - One-click update with instant optimistic UI update and disk write.

---

### 3.5. Local / Private Model Configuration for Digital Twin (Settings)

In `web/src/views/SettingsView.tsx` and `src/server/types.ts`:
- Expand Settings data model:
  ```ts
  export interface SettingsResponse {
    agentModel: string;
    criticModel?: string;
    compactionModel?: string;
    digitalTwinModel?: string;
    digitalTwinProvider?: 'openrouter' | 'local';
    digitalTwinBaseUrl?: string; // e.g. "http://192.168.1.50:11434/v1" or "http://localhost:8000/v1"
    port: number;
    projectPath: string;
  }
  ```
- **Settings UI Controls:**
  - Toggle: `OpenRouter Cloud` vs. `Local / Private Host (OpenAI-compatible)`.
  - When `Local` is selected:
    - Input: **Endpoint URL** (e.g. `http://localhost:11434/v1` for Ollama, `http://192.168.1.50:8000/v1` for vLLM).
    - Input: **Model Identifier** (e.g. `llama3.3:70b`, `qwen2.5-coder:32b`, `mistral-nemo`).
    - "Test Connection" button calling `GET /v1/models` to verify reachability.
  - Persisted to user configuration `~/.starn/config.json`.

---

## 4. Backend & API Contract Extensions

1. **`GET /api/trade-study`**:
   - Parses `docs/TRADE_STUDY.md` into structured JSON:
     ```ts
     export interface TradeStudyCandidate {
       candidate: string;
       specs: string;
       satisfies: 'compliant' | 'warning' | 'non_compliant';
       leadTime: string;
       source: string;
       estPrice: number | null;
     }

     export interface SubsystemTradeStudy {
       subsystemId: string;
       subsystemName: string;
       requirements: string[];
       candidates: TradeStudyCandidate[];
       rationale: string;
     }
     ```
2. **`GET /api/settings` & `POST /api/settings`**:
   - Extended to include `digitalTwinProvider` and `digitalTwinBaseUrl`.
3. **`src/server/parsers/trade-study-parser.ts`**:
   - Headless markdown table parser for `docs/TRADE_STUDY.md` with full unit test coverage.

---

## 5. Testing & Quality Assurance Plan

1. **Unit Tests:**
   - `tests/trade-study-parser.test.ts`: Round-trip parsing of `docs/TRADE_STUDY.md` tables, candidate compliance symbols (`✅`, `⚠️`, `❌`), prices, and rationales.
   - `tests/server-settings.test.ts`: Verification of local digital twin provider and endpoint URL persistence.
2. **TUI Handoff Test:**
   - Test verifying `/web` command invokes `startWebServer` and transfers session state.
3. **Frontend Build & Lint:**
   - Strict TypeScript compile (`tsc --noEmit`) in both root and `web/`.
   - Production Vite bundle build (`npm run build:web`).
4. **Print / PDF Verification:**
   - Verify `@media print` CSS formats cleanly onto exactly 2 pages with zero overlapping elements or clipped tables.

---

## 6. Implementation Stages

- **Stage 1:** CLI TUI `/web` command and in-process handoff in `src/index.ts`.
- **Stage 2:** Backend Trade Study parser (`src/server/parsers/trade-study-parser.ts`) and `GET /api/trade-study` route.
- **Stage 3:** Local Digital Twin endpoint settings in backend and `SettingsView`.
- **Stage 4:** AppShell 7-tab reorder & renaming (`Dashboard`, `Development`, `Questions & Issues`, `Parts`, `Work Instructions`, `Digital Twin`, `Settings`).
- **Stage 5:** Revamped `PartsView` with 3 sub-tabs (`Sourcing`, `BOM`, `Parts`).
- **Stage 6:** Dashboard visual serpentine milestone "Treasure Map" + Project Overview card.
- **Stage 7:** 2-Page Executive Briefing modal with `@media print` 1-click Save to PDF.
- **Stage 8:** Verification pass (`tsc`, vitest test suite, web production build).
