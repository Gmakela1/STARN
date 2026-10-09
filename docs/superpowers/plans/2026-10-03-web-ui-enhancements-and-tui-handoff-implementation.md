# Web UI Enhancements, Dashboard "Treasure Map", 2-Page Briefing, 3-Tier Parts Tab, and TUI Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement seamless in-process TUI-to-web handoff (`/web`), full TUI parity for local models and executive briefing (`/twin-model`, `/briefing`), AppShell 7-tab reorganization, a 3-tier Parts hub (`Sourcing` / `BOM` / `Parts`), a visual serpentine milestone roadmap ("Treasure Map") with project overview card on the Dashboard, and a 2-page print/PDF Executive Briefing export.

**Architecture:**
- **TUI & CLI:** In `src/index.ts`, add `/web` (in-process handoff to `startWebServer`), `/twin-model` (interactive local endpoint vs. OpenRouter selection), and `/briefing` (headless terminal print + `docs/EXECUTIVE_BRIEFING.md` generation).
- **Backend & Config:** Expand `src/config.ts` and `src/server/types.ts` for digital twin providers (OpenRouter vs. Local OpenAI-compatible endpoint). Implement `src/server/parsers/trade-study-parser.ts` with `GET /api/trade-study`.
- **Frontend (`web/`):** Reorder AppShell to 7 tabs (`Dashboard`, `Development`, `Questions & Issues`, `Parts`, `Work Instructions`, `Digital Twin`, `Settings`). Rebuild `DashboardView` with serpentine SVG milestone trail ("Treasure Map") and overview card. Add `ExecutiveBriefingModal` with `@media print` 2-page PDF export. Replace `BomView` with `PartsView` containing 3 dedicated sub-tabs (`Sourcing`, `BOM`, `Parts`). Expand `SettingsView` for local digital twin endpoint.

**Tech Stack:** Node.js HTTP, TypeScript strict, Vitest, React 18, Tailwind CSS v4, Lucide React, CSS `@media print`.

**Spec:** `docs/superpowers/specs/2026-10-03-web-ui-enhancements-and-tui-handoff-design.md`

## Global Constraints

- Core agent logic (`core/*`, `workspace/*`, `specialists/*`, `tools/*`) remains strictly presentation-agnostic and I/O-neutral.
- All code must pass `npx tsc --noEmit` and `npx vitest run` with zero regressions.
- All frontend changes in `web/` must compile with `npm --prefix web run build` (`tsc --noEmit && vite build`).
- No new external runtime npm dependencies; use Node built-ins and existing packages.
- Shop-floor interactive controls must maintain minimum 44px touch targets.
- High-contrast dark theme baseline: `bg-slate-950` with slate-100 text and slate-800 borders.

## Review Focus

1. **Trade Study Markdown Variations:** Ensure `trade-study-parser.ts` handles missing or malformed candidate tables, multiline requirements, and non-standard markdown without throwing.
2. **2-Page Print Page Boundaries:** Ensure `@media print` styling strictly adheres to 2 pages without spilling an extra blank 3rd page or cutting off text.
3. **TUI Handoff Context Continuity:** Ensure `/web` cleanly transfers accumulated in-memory `sessionMessages` to the web server session.
4. **Local Digital Twin Endpoint Validation:** Ensure setting a local endpoint (`http://localhost:11434/v1`) does not clobber global OpenRouter credentials.
5. **Interactive Checkpoint & Turn Resilience:** Ensure tab switching between Dashboard, Parts, and Development never unmounts or resets an in-flight SSE turn or pending checkpoint.

---

## Tasks

### Task 1: Digital Twin & Local Model Configuration in Config & Server

**Files:**
- Modify: `src/config.ts:8-35`
- Modify: `src/server/types.ts:70-85`
- Modify: `src/server/session.ts:15-80`
- Modify: `src/server/router.ts:504-530`
- Test: `tests/config-settings.test.ts`

**Interfaces:**
- Consumes: `StarnConfig`, `UserConfigFile`, `saveUserConfig` from `src/config.ts`.
- Produces: `digitalTwinModel?: string`, `digitalTwinProvider?: 'openrouter' | 'local'`, `digitalTwinBaseUrl?: string` on `StarnConfig`, `SettingsResponse`, and `ServerSessionManager`.

- [x] **Step 1: Write the failing test for digital twin config persistence in `tests/config-settings.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, saveUserConfig } from '../src/config.js';

describe('Digital Twin & Local Model Config', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists and loads local digital twin endpoint and model', () => {
    saveUserConfig(
      {
        digitalTwinProvider: 'local',
        digitalTwinBaseUrl: 'http://192.168.1.50:11434/v1',
        digitalTwinModel: 'llama3.3:70b'
      },
      tempDir
    );

    const config = loadConfig(tempDir);
    expect(config.digitalTwinProvider).toBe('local');
    expect(config.digitalTwinBaseUrl).toBe('http://192.168.1.50:11434/v1');
    expect(config.digitalTwinModel).toBe('llama3.3:70b');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config-settings.test.ts`
Expected: FAIL with property undefined assertions.

- [x] **Step 3: Update `src/config.ts`, `src/server/types.ts`, `src/server/session.ts`, and `src/server/router.ts`**

Add fields to `StarnConfig` and `UserConfigFile`. Update `ServerSessionManager` getters/setters. Update `/api/settings` GET and POST in `router.ts` to return and accept `digitalTwinProvider`, `digitalTwinBaseUrl`, and `digitalTwinModel`.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config-settings.test.ts`
Expected: PASS

- [x] **Step 5: Commit Task 1**

```bash
git add src/config.ts src/server/types.ts src/server/session.ts src/server/router.ts tests/config-settings.test.ts
git commit -m "feat(config): add local model and digital twin endpoint settings to config and server router"
```

---

### Task 2: Backend Trade Study Parser & API Route (`docs/TRADE_STUDY.md`)

**Files:**
- Create: `src/server/parsers/trade-study-parser.ts`
- Modify: `src/server/router.ts:250-450`
- Test: `tests/trade-study-parser.test.ts`

**Interfaces:**
- Produces:
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

  export function parseTradeStudyDocument(markdown: string): SubsystemTradeStudy[];
  ```
- Endpoint: `GET /api/trade-study` returns `{ success: true, data: SubsystemTradeStudy[] }`.

- [x] **Step 1: Write the failing unit test in `tests/trade-study-parser.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseTradeStudyDocument } from '../src/server/parsers/trade-study-parser.js';

const SAMPLE_TRADE_STUDY = `# Trade Study & Candidate Evaluation (docs/TRADE_STUDY.md)

## SS-01: Traction Motor
- **Requirement SS-01.a:** 6.0 kW continuous, 12.0 kW peak, 72V nominal, 0-3,500 RPM
- **Requirement SS-01.b:** Smooth speed regulation, 60 Nm continuous torque

| Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| ME1115 (Selected) | 72V, 12kW peak, 28 Nm, 0-4000 RPM, 8.5 kg | ✅ | 4-6 weeks | [mfg link](https://x.com) | $895 |
| Motenergy ME1003 | 48V, 10kW peak, 22 Nm, 0-3500 RPM, 7.2 kg | ⚠️ 48V, not 72V | 3-5 weeks | [mfg link](https://y.com) | $650 |
| Golden Motor HPM5000 | 72V, 8kW cont, 25 Nm, 0-4500 RPM, 11 kg | ❌ 8kW < 12kW peak req | 2-3 weeks | [link](https://z.com) | $720 |

### Selection Rationale
ME1115 satisfies all peak voltage and thermal constraints.
`;

describe('Trade Study Parser', () => {
  it('parses subsystems, requirements, candidates, and rationales', () => {
    const studies = parseTradeStudyDocument(SAMPLE_TRADE_STUDY);
    expect(studies).toHaveLength(1);
    expect(studies[0].subsystemId).toBe('SS-01');
    expect(studies[0].subsystemName).toBe('Traction Motor');
    expect(studies[0].requirements).toHaveLength(2);
    expect(studies[0].candidates).toHaveLength(3);
    expect(studies[0].candidates[0].satisfies).toBe('compliant');
    expect(studies[0].candidates[1].satisfies).toBe('warning');
    expect(studies[0].candidates[2].satisfies).toBe('non_compliant');
    expect(studies[0].candidates[0].estPrice).toBe(895);
    expect(studies[0].rationale).toContain('ME1115 satisfies');
  });

  it('handles empty or table-less documents gracefully', () => {
    const studies = parseTradeStudyDocument('# Trade Study\n\nNo tables yet.');
    expect(studies).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/trade-study-parser.test.ts`
Expected: FAIL with module not found.

- [x] **Step 3: Implement `src/server/parsers/trade-study-parser.ts` and add `GET /api/trade-study` to `src/server/router.ts`**

Parse markdown sections matching `## (SS-\d+):?\s*(.*)`, extract bullet requirements, candidate table rows (parsing `✅` -> `'compliant'`, `⚠️` -> `'warning'`, `❌` -> `'non_compliant'`), price regex `\$([0-9,.]+)`, and rationale text. In `src/server/router.ts`, wire up `GET /api/trade-study` reading `docs/TRADE_STUDY.md`.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/trade-study-parser.test.ts`
Expected: PASS

- [x] **Step 5: Commit Task 2**

```bash
git add src/server/parsers/trade-study-parser.ts src/server/router.ts tests/trade-study-parser.test.ts
git commit -m "feat(server): implement trade study markdown parser and GET /api/trade-study route"
```

---

### Task 3: TUI Slash Commands (`/web`, `/twin-model`, `/briefing`) and Headless Executive Briefing

**Files:**
- Create: `src/core/briefing-formatter.ts`
- Modify: `src/cli/prompts.ts`
- Modify: `src/index.ts`
- Test: `tests/briefing-formatter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BriefingData {
    projectName: string;
    activePhase: string;
    conopsSummary?: string;
    financials: { totalEstimated: number; totalActual: number; netVariance: number };
    phases: Array<{ id: string; name: string; status: string; criticScore?: number }>;
    openIssues: Array<{ title: string; type: string }>;
  }
  export function formatExecutiveBriefingPlain(data: BriefingData): string;
  export function formatExecutiveBriefingMarkdown(data: BriefingData): string;
  ```
- Consumes: `promptSelectLiveModel` and new `promptDigitalTwinSettings` in `src/cli/prompts.ts`.

- [x] **Step 1: Write failing unit test in `tests/briefing-formatter.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { formatExecutiveBriefingPlain, formatExecutiveBriefingMarkdown } from '../src/core/briefing-formatter.js';

describe('Executive Briefing Formatter', () => {
  const data = {
    projectName: 'Solar Field Rig',
    activePhase: 'bom',
    conopsSummary: 'Off-grid deployable solar array.',
    financials: { totalEstimated: 12000, totalActual: 11500, netVariance: -500 },
    phases: [
      { id: 'conops', name: 'CONOPS', status: 'COMPLETED', criticScore: 9.0 },
      { id: 'bom', name: 'BOM', status: 'IN_PROGRESS' }
    ],
    openIssues: [{ title: 'Inverter bracket offset', type: 'non_conformance' }]
  };

  it('formats clean plain text for terminal output', () => {
    const text = formatExecutiveBriefingPlain(data);
    expect(text).toContain('EXECUTIVE BRIEFING');
    expect(text).toContain('Solar Field Rig');
    expect(text).toContain('$12,000');
    expect(text).toContain('Inverter bracket offset');
  });

  it('formats clean markdown suitable for docs/EXECUTIVE_BRIEFING.md', () => {
    const md = formatExecutiveBriefingMarkdown(data);
    expect(md).toContain('# Executive Briefing: Solar Field Rig');
    expect(md).toContain('## Financial Rollup');
    expect(md).toContain('## Phase-Gate Milestone Status');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/briefing-formatter.test.ts`
Expected: FAIL with module not found.

- [x] **Step 3: Implement `src/core/briefing-formatter.ts`, `src/cli/prompts.ts`, and wire commands in `src/index.ts`**

1. In `src/core/briefing-formatter.ts`, implement plain-text and markdown formatters.
2. In `src/cli/prompts.ts`, implement `promptDigitalTwinSettings(availableModels: string[], currentConfig: StarnConfig)` allowing selection between OpenRouter model and Local Endpoint (with custom URL and model name).
3. In `src/index.ts`:
   - Handle `/twin-model`: invokes `promptDigitalTwinSettings`, saves to config.
   - Handle `/briefing`: formats data, prints to console, writes to `docs/EXECUTIVE_BRIEFING.md`.
   - Handle `/web`: starts `startWebServer({ port: 3000, openBrowserOnStart: true })`, prints URLs, and keeps process alive.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/briefing-formatter.test.ts`
Expected: PASS

- [x] **Step 5: Commit Task 3**

```bash
git add src/core/briefing-formatter.ts src/cli/prompts.ts src/index.ts tests/briefing-formatter.test.ts
git commit -m "feat(cli): add /web handoff, /twin-model local configuration, and /briefing report generation"
```

---

### Task 4: AppShell 7-Tab Reorder & Renaming (`web/`)

**Files:**
- Modify: `web/src/layouts/AppShell.tsx:20-65`
- Modify: `web/src/types/api.ts:50-130`
- Modify: `web/src/api/client.ts:30-80`

**Interfaces:**
- Updates `TABS` order: `dashboard` (1), `development` (2), `issues` (3), `parts` (4), `work` (5), `twin` (6), `settings` (7).
- Renames labels: "Parts" (was BOM & Sourcing), "Work Instructions" (was Shop Floor).
- Adds `SubsystemTradeStudy` and `TradeStudyCandidate` to `web/src/types/api.ts`.
- Adds `api.fetchTradeStudy(): Promise<SubsystemTradeStudy[]>` to `web/src/api/client.ts`.

- [x] **Step 1: Update API types and client in `web/src/types/api.ts` and `web/src/api/client.ts`**

Export `SubsystemTradeStudy` and `TradeStudyCandidate`. Add `fetchTradeStudy: () => call<SubsystemTradeStudy[]>('GET', '/api/trade-study')`.

- [x] **Step 2: Reorder tabs in `web/src/layouts/AppShell.tsx`**

Set default tab to `dashboard`. Update tab definitions and icons (`Boxes` for Parts, `Wrench` for Work Instructions).

- [x] **Step 3: Verify web compilation**

Run: `npm --prefix web run build`
Expected: Build succeeds with new tab structure.

- [x] **Step 4: Commit Task 4**

```bash
git add web/src/layouts/AppShell.tsx web/src/types/api.ts web/src/api/client.ts
git commit -m "feat(web): reorder AppShell to 7 canonical tabs and add trade study API client methods"
```

---

### Task 5: Revamped "Parts" Tab with 3 Sub-Tabs (`web/src/views/PartsView.tsx`)

**Files:**
- Create: `web/src/views/PartsView.tsx`
- Delete: `web/src/views/BomView.tsx`
- Modify: `web/src/layouts/AppShell.tsx` (import `PartsView` instead of `BomView`)

**Interfaces:**
- Consumes: `api.fetchBom`, `api.updateBomItem`, `api.fetchTradeStudy` from `../api/client`.
- Renders 3 sub-tabs:
  1. `sourcing`: Candidate Trade Studies (`docs/TRADE_STUDY.md`) with ✅/⚠️/❌ flags, lead times, pricing, and rationales.
  2. `bom`: Engineering BOM (`docs/BOM.md`) with subsystem filter, quantities, specs, and estimated totals.
  3. `parts`: Logistics tracker with order numbers, tracking numbers, status dropdowns, actual totals, and inline row editing.

- [x] **Step 1: Implement `web/src/views/PartsView.tsx` with 3-tab navigation bar**

Include header sub-tabs `[ Sourcing ]`, `[ BOM ]`, `[ Parts ]` with active state styling.
- `sourcing`: Render cards per subsystem displaying candidate comparison table with compliance badges (`bg-emerald-950 text-emerald-300` for ✅, `bg-amber-950 text-amber-300` for ⚠️, `bg-rose-950 text-rose-300` for ❌) and selection rationale.
- `bom`: Clean engineering table showing Item #, Description, Subsystem, Qty, Est Unit, Est Total, and Vendor Links.
- `parts`: Procurement execution table with inline tracking # input, actual total input, status dropdown, variance column, and save/cancel actions.

- [x] **Step 2: Update `web/src/layouts/AppShell.tsx` to mount `PartsView` and remove `BomView.tsx`**

Swap the import and rendering for tab `'parts'`.

- [x] **Step 3: Run web build to verify type safety**

Run: `npm --prefix web run build`
Expected: Clean build (`tsc --noEmit && vite build`).

- [x] **Step 4: Commit Task 5**

```bash
git add web/src/views/PartsView.tsx web/src/layouts/AppShell.tsx
git rm web/src/views/BomView.tsx
git commit -m "feat(web): implement 3-tier Parts hub with Sourcing, BOM, and Parts logistics sub-tabs"
```

---

### Task 6: Dashboard Visual Serpentine Roadmap ("Treasure Map") & Project Overview

**Files:**
- Create: `web/src/components/TreasureMapRoadmap.tsx`
- Modify: `web/src/views/DashboardView.tsx`

**Interfaces:**
- Consumes: `roadmap: RoadmapPhase[]`, `onSelectPhase?: (phaseId: string) => void`.
- Produces: Visual serpentine S-curve milestone trail rendering the 13 canonical phases with status badges, critic scores, and open questions chips.

- [x] **Step 1: Implement `web/src/components/TreasureMapRoadmap.tsx`**

Build a responsive SVG and card milestone component:
- 13 canonical phase nodes arranged across winding rows (Row 1: Left-to-Right 1-4; Row 2: Right-to-Left 8-5; Row 3: Left-to-Right 9-12; Row 4: 13).
- Connecting curved SVG dashed path (`stroke-slate-700` with active segments in `stroke-sky-500`).
- Milestone station cards: phase number, name, artifact name, status ring (Completed emerald, In-Progress sky pulse, Pending Review amber, Locked slate), critic score chip (`8.7/10`), and open questions indicator.
- Click handler allowing the user to select and inspect the phase.

- [x] **Step 2: Update `web/src/views/DashboardView.tsx` to mount `TreasureMapRoadmap` and Project Overview Card**

Add a prominent Project Overview / White Paper card at the top displaying:
- Project title, domain description, active gate, financial summary, and an "Export 2-Page Executive Briefing" button.
- Mount `TreasureMapRoadmap` as the primary visual display.

- [x] **Step 3: Run web build to verify compilation**

Run: `npm --prefix web run build`
Expected: Clean build.

- [x] **Step 4: Commit Task 6**

```bash
git add web/src/components/TreasureMapRoadmap.tsx web/src/views/DashboardView.tsx
git commit -m "feat(web): add serpentine treasure map roadmap and project overview card to dashboard"
```

---

### Task 7: 2-Page Executive Briefing Modal with Direct PDF Export (`window.print()`)

**Files:**
- Create: `web/src/components/ExecutiveBriefingModal.tsx`
- Modify: `web/src/index.css`
- Modify: `web/src/views/DashboardView.tsx`

**Interfaces:**
- Consumes: `DashboardData` from `api.fetchDashboard()`.
- Produces: Modal displaying a structured 2-page print briefing with 1-click "Save as PDF" triggering native print dialog.

- [x] **Step 1: Add `@media print` rules to `web/src/index.css`**

```css
@media print {
  @page {
    size: letter portrait;
    margin: 0.4in;
  }
  body {
    background-color: white !important;
    color: #0f172a !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  /* Hide all app chrome except briefing */
  header, nav, aside, .no-print {
    display: none !important;
  }
  .briefing-modal {
    position: static !important;
    background: white !important;
    color: #0f172a !important;
    padding: 0 !important;
  }
  .briefing-page {
    page-break-after: always !important;
    break-after: page !important;
    min-height: 9.8in;
    box-sizing: border-box;
  }
  .briefing-page:last-child {
    page-break-after: avoid !important;
    break-after: avoid !important;
  }
}
```

- [x] **Step 2: Implement `web/src/components/ExecutiveBriefingModal.tsx`**

- Full-screen modal with "Save as PDF / Print" button calling `window.print()` and Close button.
- **Page 1:** Executive Summary, System Scope, Subsystem Matrix (SS-01 to SS-08), and Budget vs Actual Financial Rollup.
- **Page 2:** Clean Linear Phase-Gate Subway Flowchart (the formal engineering flowchart requested for formal reports), Milestone Deliverable Matrix, and Critical Open Risks / Non-Conformances.

- [x] **Step 3: Wire modal into `web/src/views/DashboardView.tsx`**

Connect "Export 2-Page Executive Briefing" button to open modal state.

- [x] **Step 4: Run web build to verify compilation**

Run: `npm --prefix web run build`
Expected: Clean build.

- [x] **Step 5: Commit Task 7**

```bash
git add web/src/components/ExecutiveBriefingModal.tsx web/src/index.css web/src/views/DashboardView.tsx
git commit -m "feat(web): implement 2-page executive briefing modal with direct PDF export"
```

---

### Task 8: SettingsView Local Digital Twin Endpoint Configuration

**Files:**
- Modify: `web/src/views/SettingsView.tsx`
- Modify: `web/src/types/api.ts`

**Interfaces:**
- Consumes: `Settings` with `digitalTwinProvider`, `digitalTwinBaseUrl`, `digitalTwinModel`.
- Allows user to toggle between `OpenRouter Cloud` and `Local / Private Host (OpenAI-compatible)`.
- If Local: input for base URL (default `http://localhost:11434/v1`) and model identifier.

- [x] **Step 1: Expand `Settings` type in `web/src/types/api.ts`**

Add `digitalTwinProvider?: 'openrouter' | 'local'`, `digitalTwinBaseUrl?: string`, `digitalTwinModel?: string`.

- [x] **Step 2: Update `web/src/views/SettingsView.tsx`**

Add a dedicated "Digital Twin Spatial Model" card with:
- Provider Radio/Toggle: OpenRouter vs Local Endpoint.
- Local Base URL input (with placeholder `http://localhost:11434/v1` or `http://192.168.1.X:8000/v1`).
- Model name input (e.g. `llama3.3:70b`, `qwen2.5-coder:32b`).
- Save button applying updates via `api.saveSettings`.

- [x] **Step 3: Run web build to verify compilation**

Run: `npm --prefix web run build`
Expected: Clean build.

- [x] **Step 4: Commit Task 8**

```bash
git add web/src/views/SettingsView.tsx web/src/types/api.ts
git commit -m "feat(web): add digital twin local endpoint configuration to settings view"
```

---

### Task 9: Continuous UI Self-Critique & Polish Pass

**Files:**
- Modify: `web/src/views/PartsView.tsx`
- Modify: `web/src/views/DashboardView.tsx`
- Modify: `web/src/components/TreasureMapRoadmap.tsx`
- Modify: `web/src/components/ExecutiveBriefingModal.tsx`

**Audit Dimensions:**
1. **Contrast & Theme:** Ensure all badges, chips, and table text maintain ≥4.5:1 WCAG contrast on `bg-slate-950`.
2. **Shop-Floor Ergonomics:** Enforce 44px+ touch targets on all interactive buttons, sub-tabs, and status dropdowns.
3. **Print Layout:** Test print media layout so page 1 and page 2 break cleanly without overflowing to page 3.
4. **Empty States:** Ensure friendly explanatory text if `docs/TRADE_STUDY.md` or `docs/BOM.md` are not yet drafted.

- [x] **Step 1: Audit and apply ergonomics and contrast improvements across views**
- [x] **Step 2: Verify `npm --prefix web run build` and `npx vitest run`**
- [x] **Step 3: Commit Task 9**

```bash
git add web/src/
git commit -m "polish(web): run UI self-critique pass for 44px touch targets, print pagination, and contrast"
```

---

### Task 10: End-to-End Verification & Live Smoke Test

**Files:** None (verification and branch integration).

- [x] **Step 1: Run full strict TypeScript compile**

Run: `npx tsc --noEmit && npm --prefix web run build`
Expected: Zero type errors across backend and frontend.

- [x] **Step 2: Run complete backend test suite**

Run: `npx vitest run`
Expected: All tests passing.

- [x] **Step 3: Smoke test TUI slash commands**

Verify `/web`, `/twin-model`, and `/briefing` in a live smoke run.

- [x] **Step 4: Commit plan completion and push to `origin/master`**

```bash
git push origin master
```
