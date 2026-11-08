# Design Specification: Sub-Project 3 — Parts Pipeline & Web Sourcing Agent

**Date:** 2026-10-10  
**Status:** Draft for Review  
**Author:** AI Agent (Brainstorming Path)  
**Target:** STARN Core, Specialists, Server, CLI, Web UI  

---

## 1. Executive Summary & Goals

Sub-Project 3 delivers an end-to-end hardware procurement and sourcing system for STARN. It bridges early engineering requirements to real-world parts acquisition and physical shop floor assembly:

1. **Zero-Config Web Search & Sourcing Agent:**
   - Equips the BOM / Sourcing specialist with native `web_search` and `web_fetch` tools.
   - **Zero-config default:** Operates out of the box using OpenRouter's built-in web search grounding—no additional accounts, keys, or external daemon processes required.
   - **Optional search key boost:** Provides settings for Tavily (purpose-built for LLM agent extraction) and Brave Search API keys for power users or local-model setups.
   - **Direct URL scraper (`web_fetch`):** SSRF-protected page/datasheet fetcher returning clean markdown text.

2. **Two-Tier Sourcing Automation:**
   - The specialist uses search tools to discover candidate components, extracts specs/datasheets, verifies compliance against `REQUIREMENTS.md` and `ICD.md`, and writes `TRADE_STUDY.md`.
   - Primary selections are written into `BOM.md` with explicit quantities, vendor URLs, estimated prices, and budget rollups.

3. **End-to-End Procurement Lifecycle:**
   - Tracks parts across 6 discrete stages: `Identified` → `Ordered` → `Shipped` → `Received` → `Bench Tested` → `Consumed`.
   - Provides live carrier tracking, actual spend vs budget variance, and lead-time risk highlights.
   - Bridges BOM items to Work Instructions: checks whether required parts for a work instruction procedure are in inventory (`Received` or `Bench Tested`) before marking build steps ready.

4. **Full Web UI & CLI Parity:**
   - **Web UI:** Enhanced 3-tier Parts Hub (`Sourcing` / `BOM` / `Parts`) with inline status transitions, carrier tracking links, budget variance rollup, and Search Settings panel.
   - **CLI:** Interactive `/parts` status table and `/parts update` command, plus `/settings search` configuration.

---

## 2. Web Search Architecture & Tools

### 2.1 Tool Interfaces (`src/tools/handlers/web-search.ts` and `web-fetch.ts`)

Two new strictly-scoped tools are introduced in `src/tools/`:

```typescript
export interface WebSearchInput {
  query: string;
  maxResults?: number; // default 5, max 10
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  content?: string; // provided by Tavily when available
}

export interface WebSearchOutput {
  provider: 'openrouter' | 'tavily' | 'brave';
  query: string;
  results: WebSearchResultItem[];
}
```

```typescript
export interface WebFetchInput {
  url: string;
  selector?: string; // optional selector
}

export interface WebFetchOutput {
  url: string;
  title?: string;
  content: string; // clean markdown text, truncated to 20,000 chars
  status: number;
}
```

### 2.2 Provider Execution Strategies

1. **OpenRouter (Default / Zero-Config):**
   - Uses the existing OpenRouter client and API key.
   - Sends a focused system query with `plugins: [{ id: "web", max_results: 5 }]` or queries OpenRouter's web-grounded completions to extract candidate parts, real vendor links, specifications, and pricing.
   - Requires **zero extra setup** from the user.

2. **Tavily Search (Recommended API Key):**
   - Direct HTTP call to `POST https://api.tavily.com/search`.
   - Headers: `Content-Type: application/json`.
   - Payload: `{ api_key, query, search_depth: "basic", max_results: 5, include_answer: true }`.
   - Extracts synthesized answers and clean page markdown snippets directly.

3. **Brave Search (Optional API Key):**
   - Direct HTTP call to `GET https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`.
   - Headers: `Accept: application/json`, `X-Subscription-Token: ${apiKey}`.
   - Returns title, URL, and descriptive snippet.

### 2.3 SSRF Defense & Security Guardrails (`web-fetch.ts`)
- URL validation: must be `http://` or `https://`.
- DNS resolution guard: resolves hostname before fetching and rejects private IP ranges:
  - `127.0.0.0/8` (Loopback)
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC1918 Private)
  - `169.254.0.0/16` (Link-local / Cloud Metadata)
  - `::1`, `fc00::/7`, `fe80::/10` (IPv6 loopback / local)
- Payload truncation: Max response body capped at 50KB; returned markdown capped at 20,000 characters.
- Timeout: Hard 10-second timeout on all network requests using `AbortController`.

### 2.4 Tool Scoping
- In accordance with `AGENTS.md` ("Tools are strictly scoped per specialist package"), `web_search` and `web_fetch` are allowed **only** for:
  - `bom` specialist (for sourcing and trade studies)
  - Optional `general` specialist (for user research questions)
- All other specialists (`conops`, `architecture`, `requirements`, etc.) do **not** have access to web search tools.

---

## 3. Configuration & Settings

### 3.1 Global Config (`~/.starn/config.json`)
Extended with optional search settings:

```json
{
  "search": {
    "provider": "openrouter",
    "tavilyApiKey": "tvly-...",
    "braveApiKey": "BSA..."
  }
}
```

### 3.2 Web Settings & CLI Commands
- **Web UI (`SettingsView.tsx`):**
  - "Web Search & Sourcing Provider" card.
  - Dropdown: `OpenRouter (Built-in, zero config)` | `Tavily` | `Brave Search`.
  - API Key input (masked) for Tavily or Brave.
  - "Test Search" button triggering a probe query (`GET /api/settings/search-probe`).
- **CLI Commands:**
  - `/settings search` — view active search provider and status.
  - `/search-key [tavily|brave] <key>` — configure a search key directly from the terminal.

---

## 4. Two-Tier Sourcing & Trade Study Workflow ("Grocery List First, Sourcing Second")

### 4.1 Two-Stage Specialist Execution Discipline
The BOM specialist follows an explicit two-stage workflow to prevent wandering or hallucinating components:

1. **Stage 1: Generate the Detailed "Grocery List" (Framework BOM):**
   - The specialist reads `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, and `docs/ICD.md`.
   - Before touching any web search tools, the specialist drafts the complete master "grocery list" into `docs/BOM.md`.
   - Every required component across all subsystems (traction motor, controller, battery pack/cells, contactors, pre-charge resistors, throttle potbox, fuses, hydraulic fittings, wiring harnesses, structural fasteners, gauges) is enumerated.
   - For each item, the grocery list specifies:
     - `Item #` (e.g., `SS01-01`, `SS02-01`)
     - Target engineering requirements / technical spec envelope (e.g. `72V nominal, 12kW peak, 0-3500 RPM, SAE 3 flange`)
     - Exact required `Qty` (integer)
     - `Status: Identified`
     - Baseline estimated budget allocations
   - This ensures 100% requirements coverage before any shopping begins.

2. **Stage 2: Web Sourcing & Trade Study ("Go Get the Groceries"):**
   - With the grocery list locked in, the specialist systematically works through each item using `web_search` and `web_fetch`.
   - It searches for real manufacturer parts that fulfill the exact specifications on the list.
   - For major components, it authors `docs/TRADE_STUDY.md` comparing 2–3 real candidate parts with live vendor links, datasheets, lead times, and unit pricing.
   - It selects the winning candidate and updates `docs/BOM.md` with:
     - Manufacturer & exact part model number
     - Real vendor link
     - Current estimated market price
     - Long-lead order flag (★ or ★★)
     - Recalibrated total budget and procurement rollup.

---

## 5. Procurement Lifecycle & Parts Pipeline

### 5.1 Six Lifecycle Stages
1. `Identified`: Part is specified in `BOM.md` with target vendor and estimated price. Not yet ordered.
2. `Ordered`: Order placed with vendor. Order # recorded. Lead time clock begins.
3. `Shipped`: Carrier tracking number provided. Active tracking link available in UI.
4. `Received`: Package arrived at shop floor. Inspected for physical shipping damage.
5. `Bench Tested`: Initial bench test or electrical validation completed (e.g. motor spins on bench, battery pack voltage balanced).
6. `Consumed`: Component physically installed into the vehicle/assembly as part of a Work Instruction step.

### 5.2 Server REST API Endpoints

- `GET /api/bom`: Returns parsed BOM items, financial rollup, and long-lead items.
- `PATCH /api/bom/items/:itemId`:
  - Payload: `{ status?, qty?, estUnit?, actualTotal?, orderNumber?, trackingNumber?, carrier?, notes? }`
  - Atomically updates the corresponding table row in `docs/BOM.md` and recalibrates the Financial Rollup table (`Total Actual Committed Spend`, `Net Budget Variance`, `Procurement Progress`).
- `GET /api/trade-study`: Returns parsed candidate comparison tables from `docs/TRADE_STUDY.md`.
- `POST /api/bom/promote-candidate`:
  - Promotes an approved candidate from `docs/TRADE_STUDY.md` into `docs/BOM.md`.

### 5.3 Work Instructions Inventory Gating
In `docs/work-instructions/`:
- Each procedure lists `Parts from BOM` with IDs (e.g. `SS01-01`, `SS01-02`).
- The Work Instructions API cross-references required parts with BOM item statuses:
  - If any required part is `< Received`, procedure shows badge: `⚠️ Waiting on parts: SS01-02 (Shipped)`.
  - If all required parts are `Received` or `Bench Tested`, badge displays: `✅ All parts staged & ready`.

---

## 6. User Interface & CLI Implementation

### 6.1 Web UI (`PartsView.tsx`)
- **Sub-Tab 1: Sourcing (`TRADE_STUDY.md`)**
  - Subsystem cards displaying candidate tables.
  - Compliance indicators (`✅ Meets requirements`, `⚠️ Deviations`, `❌ Non-compliant`).
  - Direct vendor external links.
  - "Promote to Master BOM" button.
- **Sub-Tab 2: Master BOM (`BOM.md`)**
  - Master ledger table with integer `Qty`, `Est. Unit`, `Est. Total`, `Actual Total`, `Variance`.
  - Subsystem filter & live text search.
  - Top financial metrics banner: Total Budget, Actual Spend, Variance, Progress %.
- **Sub-Tab 3: Parts (Logistics & Shop Floor)**
  - Tracking status chips (`Identified` | `Ordered` | `Shipped` | `Received` | `Bench Tested`).
  - Clickable carrier tracking links (auto-detects FedEx, UPS, USPS, DHL, or generic link).
  - Inline row editor for tracking numbers, order numbers, and actual spend receipts.

### 6.2 CLI Parity
- `/parts`: Displays color-coded table of procurement statuses, carrier tracking numbers, and financial rollup.
- `/parts update <item-id> [status] [actual] [tracking]`: Rapid inline update from the terminal.
- `/trade-study [subsystem]`: Displays candidate trade studies in formatted terminal tables.

---

## 7. Verification & Testing Strategy

1. **Unit Tests:**
   - `web-search.test.ts`: Verify OpenRouter, Tavily, and Brave query parsers, fallback handling, and error isolation.
   - `web-fetch.test.ts`: Test SSRF blocker (rejects `127.0.0.1`, `169.254.169.254`, `localhost`), HTML text stripper, and payload size bounds.
   - `bom-updater.test.ts`: Verify atomic row editing in `docs/BOM.md` markdown table and recalculation of financial rollups.
2. **Specialist & Tool Tests:**
   - Verify `bomPackage` allows `web_search` and `web_fetch`.
   - Verify non-BOM specialists (`conops`, `architecture`, `requirements`) reject web search tools.
3. **Integration Tests:**
   - `server-bom-api.test.ts`: Test `PATCH /api/bom/items/:itemId` updating markdown files and recalculating metrics.
   - `server-search-probe.test.ts`: Test search provider connectivity and settings persistence.
4. **End-to-End Build & UI Verification:**
   - `tsc --noEmit` and full vitest suite pass 100%.
   - `npm --prefix web run build` succeeds cleanly.
