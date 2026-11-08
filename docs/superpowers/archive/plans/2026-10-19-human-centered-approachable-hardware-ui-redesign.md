# Human-Centered Approachable Hardware UI Redesign Implementation Plan

## Goal
Transform the STARN web UI into an inspiring, easy-on-the-eye, and accessible interface specifically tailored for makers and hardware innovators who want to close the gap from idea to physical build—breaking down technical gaps, materials, costs, and schedule without sacrificing deep engineering rigor.

## Architecture & Principles
- **Warm Precision Aesthetics**: Deep warm slate (`#0b0f17`), comfortable typography, generous line-heights, gentle card borders, and warm cyan/emerald/amber accents.
- **Progressive Disclosure**: Plain-English scannable summaries and visual progress rings up front; deep technical details, pinouts, and BOM calculations easily accessible on demand.
- **5-Hub Maker Lifecycle**:
  1. `Dashboard` ("Where are we?")
  2. `Roadmap` ("What's next?")
  3. `Studio` ("Collaborative AI Workbench")
  4. `Build & Materials` ("Shopping list, shop floor instructions, and workshop tracker")
  5. `Vault & Settings` ("Manuals, quality examples, 3D digital twin, and configuration")
- **Shop-Floor Usability**: Dedicated high-contrast Shop Mode with 56px+ touch targets, big tactile checkmarks, and photo evidence logging.
- **Strict Quality & Accessibility**: WCAG AA contrast (≥ 4.5:1), keyboard navigation, 100% green vitest suites, clean Vite production build.

---

### Task 1: Design Tokens, "Warm Precision" Theme & Global CSS
**Files:**
- Modify: `web/src/index.css`
- Modify: `web/index.html`

- [ ] Update `web/src/index.css` with:
  - Warm slate color tokens (`#0b0f17` canvas, `#111827` surface, soft border `rgba(148, 163, 184, 0.14)`).
  - Subtle CAD dot-grid background helper (`bg-cad-grid`).
  - Strict monospace telemetry and tabular numbers class (`font-telemetry` / `tabular-nums`).
  - High-contrast accessible focus ring (`focus-visible:ring-2 focus-visible:ring-cyan-400`).
  - Plain-English typography scales for `.doc-prose` (comfortable 1.65 line-height, clear section spacing).
- [ ] Verify `npm --prefix web run build` passes cleanly.

---

### Task 2: 5-Hub Navigation Shell with Responsive Drawer & Telemetry Bar
**Files:**
- Modify: `web/src/layouts/AppShell.tsx`
- Modify: `web/src/types/api.ts` (if needed for nav structures)

- [ ] Reorganize top-level navigation from 8 flat tabs into the 5 maker hubs:
  1. `dashboard` (Dashboard)
  2. `roadmap` (Project Roadmap)
  3. `development` (Engineering Studio)
  4. `build` (Materials & Build Floor: unified BOM, Shop Work Instructions, and Workshop Discrepancies)
  5. `vault` (Vault & Settings: Technical Library, 3D Digital Twin, and Config)
- [ ] Header Telemetry Bar:
  - Project Title + Active Phase Badge (e.g. `Stage 02: Architecture`).
  - Live AI status indicator (`● Ready` / `Pulse Working`).
  - Approachable plain-English phase indicator with friendly icon.
- [ ] Add responsive mobile drawer menu with touch-friendly navigation links.
- [ ] Run `npm --prefix web run build` to verify clean build.

---

### Task 3: Approachable Mission Dashboard with Rebalanced 2-Column Grid
**Files:**
- Modify: `web/src/views/DashboardView.tsx`
- Modify: `web/src/components/TreasureMapRoadmap.tsx`

- [ ] Rebalance `DashboardView.tsx` into an approachable 2-column layout:
  - **Left Column (60%)**:
    - Friendly Project Summary & Charter with scannable collapsible cards (Background, Purpose, Objectives, Scope).
    - Quick Action Bar: "Export Executive Briefing (PDF)", "Continue in Studio".
  - **Right Column (40%)**:
    - Visual Progress Meters: Design Phase completion %, Parts Sourcing %, Budget Spend gauge.
    - Workshop Alerts: Unresolved non-conformances and open questions with severity tags.
- [ ] Enhance `TreasureMapRoadmap.tsx`:
  - Plain-English subtitles for each of the 13 stations (e.g., "CONOPS: User Intent", "Architecture: System Layout", "ICD: Wiring & Pinouts", "BOM: Shopping List", "Work Instructions: Assembly Steps").
  - Click-through directly to the Engineering Studio for that document.
- [ ] Run `npm --prefix web run build` and verify clean compilation.

---

### Task 4: Collaborative Hardware Engineering Studio
**Files:**
- Modify: `web/src/views/DevelopmentView.tsx`
- Modify: `web/src/components/CheckpointPanel.tsx`
- Modify: `web/src/components/CriticScorecard.tsx`

- [ ] Enhance top Studio header:
  - Specialist Persona badge (e.g., `⚡ Electrical Lead`, `📐 Systems Architect`, `🔩 Sourcing Specialist`).
  - Friendly document selector dropdown with plain-English stage names and status pills.
- [ ] Enhance Left Comms Panel:
  - Live Action Cards for tool executions (e.g., `🔍 Searching datasheet for motor`, `📄 Reading wiring diagram in manual.pdf`, `✏️ Added battery fuse to BOM`).
  - Helpful starter prompt chips ("What shop tools are needed?", "Verify electrical safety", "Run Critic review").
- [ ] Enhance Right Workspace:
  - Tabbed Document View: `[ Clean Document ]` | `[ Review Changes (Diff) ]` | `[ Critic Scorecard ]` | `[ Reference Examples ]`.
  - Prominent "Approve & Unlock Next Stage" action.
- [ ] Docked Checkpoint Drawer:
  - Non-intrusive slide-up drawer for human-on-the-loop decisions with plain-language summary and clear actions.
- [ ] Run `npm --prefix web run build` and verify clean compilation.

---

### Task 5: Materials & Build Floor with High-Contrast Shop Mode
**Files:**
- Modify: `web/src/views/PartsView.tsx`
- Modify: `web/src/views/WorkInstructionsView.tsx`
- Modify: `web/src/views/IssuesAndQuestionsView.tsx`

- [ ] Consolidate Materials, Work Instructions, and Issues into the **Materials & Build Hub**:
  - Sub-navigation pills: `[ Shopping List (BOM) ]` | `[ Trade Studies ]` | `[ Work Instructions (Shop Mode) ]` | `[ Workshop Tracker (Issues) ]`.
- [ ] In `PartsView.tsx`:
  - Dense, readable table with filter chips (`All`, `Need to Buy`, `Ordered`, `In Shop`).
  - Carrier tracking links (UPS, FedEx, USPS, McMaster-Carr) with delivery status.
  - Inline cost variance indicators.
- [ ] In `WorkInstructionsView.tsx`:
  - **"Shop Floor Mode"** toggle button:
    - High-contrast layout for garage/workshop tablets.
    - Large 56px touch target checkboxes.
    - Prominent safety callout banners.
    - Photo evidence dropzone for each step.
    - Immediate "Flag Discrepancy" button on steps.
- [ ] Run `npm --prefix web run build` and verify clean compilation.

---

### Task 6: Full Regression, Accessibility (WCAG AA), Frontend Tests & Verification
**Files:**
- Create: `tests/web-ui-human-centered.test.ts`
- Run: `npm test` and `npm --prefix web run build`

- [ ] Write integration test `tests/web-ui-human-centered.test.ts` verifying:
  - Hub navigation structures and accessibility labels.
  - Plain-English phase labels and roadmap navigation.
  - Shop mode toggle state in work instructions.
- [ ] Verify 100% green vitest suite (`npm test`).
- [ ] Verify clean production build (`npm --prefix web run build`).
- [ ] Verify core decoupling (`npx vitest run tests/core-decoupling.test.ts`).
- [ ] Commit all changes with structured git messages.
