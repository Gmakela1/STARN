# Parts Pipeline & Web Sourcing Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a comprehensive hardware Parts pipeline featuring a zero-config OpenRouter web search agent (with optional Tavily/Brave API key settings), safe SSRF-protected page scraper (`web_fetch`), a "Grocery List First, Sourcing Second" BOM specialist workflow, atomic procurement status & tracking updates in `docs/BOM.md`, Work Instructions readiness cross-referencing, and full Web UI + CLI parity.

**Architecture:**
- Search client abstraction in `src/tools/search/search-client.ts` supporting zero-config OpenRouter completions with web grounding, plus direct Tavily and Brave Search APIs.
- Strict tool handlers `web_search` and `web_fetch` with SSRF and payload guards, scoped exclusively to the `bom` specialist.
- Upgraded `bomPackage` prompt and secret sauce enforcing Stage 1 (complete grocery list in `BOM.md` first) then Stage 2 (sourcing & trade study in `TRADE_STUDY.md` second).
- Markdown-safe atomic updater `src/server/parsers/bom-updater.ts` for updating line item statuses (`Identified`, `Ordered`, `Shipped`, `Received`, `Bench Tested`, `Consumed`), actual spend, and tracking numbers while recalculating financial rollups.
- REST endpoints for BOM item patching and search settings probe; Web UI Parts Hub enhancement and CLI `/parts` commands.

**Tech Stack:** TypeScript (strict), Node.js `fetch` + `AbortController`, OpenRouter API, Tavily API, Brave Search API, React + Tailwind CSS + Lucide Icons, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-parts-pipeline-and-web-search-design.md`

## Global Constraints
- `core/*`, `workspace/*`, `models/*`, and `tools/*` must never import `cli/*` or `server/*`.
- Tools are strictly scoped: only `bom` specialist has access to `web_search` and `web_fetch`.
- Zero-config default: search must work without any extra API keys if an OpenRouter key is configured.
- Security: `web_fetch` must block loopback, private subnets (RFC1918), and cloud metadata (`169.254.169.254`). Maximum fetched body size 50KB.
- Atomic updates: modifying a BOM item must never corrupt markdown tables, other rows, or section formatting.
- `npx tsc --noEmit` and `vitest run` must pass 100% at every commit.
- UI elements must meet accessibility standards (touch target ≥ 44px, contrast ≥ 4.5:1).

## Review Focus
1. Private IP SSRF bypass via DNS rebinding or `http://127.0.0.1:port` / `http://localhost`.
2. BOM table markdown corruption when item descriptions contain pipe characters (`|`) or special symbols.
3. OpenRouter search fallback handling when OpenRouter rate-limits or returns malformed search output.
4. Financial rollup math precision when actual costs have decimals or missing values.
5. Search provider configuration switching between OpenRouter, Tavily, and Brave without requiring restart.

---

### Task 1: Search Client & Provider Infrastructure

**Files:**
- Create: `src/tools/search/types.ts`
- Create: `src/tools/search/search-client.ts`
- Modify: `src/config.ts`
- Test: `tests/search-client.test.ts`

- [ ] **Step 1: Write failing test in `tests/search-client.test.ts`**
  - Test OpenRouter search provider parses queries and returns formatted results.
  - Test Tavily search provider builds correct payload and parses synthesized results.
  - Test Brave search provider handles headers and parses search snippets.
  - Test provider fallback when no external search keys are configured.
- [ ] **Step 2: Run test to confirm failure**
  - Run: `npx vitest run tests/search-client.test.ts`
- [ ] **Step 3: Implement search types and config in `src/config.ts` and `src/tools/search/types.ts`**
  - Define `SearchConfig`, `WebSearchQuery`, `WebSearchResultItem`, `WebSearchResponse`.
  - Add `search?: SearchConfig` to `StarnConfig` in `src/config.ts`.
- [ ] **Step 4: Implement `src/tools/search/search-client.ts`**
  - Implement `createSearchClient(config: StarnConfig)` with methods `search(query: string, maxResults?: number): Promise<WebSearchResultItem[]>`.
  - Implement OpenRouter grounded search (using OpenRouter client).
  - Implement Tavily fetch (`https://api.tavily.com/search`).
  - Implement Brave Search fetch (`https://api.search.brave.com/res/v1/web/search`).
- [ ] **Step 5: Run tests and confirm passing**
  - Run: `npx vitest run tests/search-client.test.ts`
- [ ] **Step 6: Commit**
  - `git add src/config.ts src/tools/search/ tests/search-client.test.ts`
  - `git commit -m "feat(search): search client supporting OpenRouter, Tavily, and Brave providers"`

---

### Task 2: Web Search and Safe Web Fetch Tools

**Files:**
- Create: `src/tools/handlers/web-search.ts`
- Create: `src/tools/handlers/web-fetch.ts`
- Modify: `src/tools/registry.ts`
- Modify: `src/tools/types.ts`
- Test: `tests/web-search-tool.test.ts`
- Test: `tests/web-fetch-ssrf.test.ts`

- [ ] **Step 1: Write failing tests in `tests/web-search-tool.test.ts` and `tests/web-fetch-ssrf.test.ts`**
  - Test `web_search` tool execution via `ToolRegistry`.
  - Test `web_fetch` tool blocks `http://127.0.0.1`, `http://localhost`, `http://10.0.0.1`, `http://169.254.169.254`.
  - Test `web_fetch` extracts readable text from HTML and truncates payloads > 50KB.
- [ ] **Step 2: Run tests to confirm failure**
  - Run: `npx vitest run tests/web-search-tool.test.ts tests/web-fetch-ssrf.test.ts`
- [ ] **Step 3: Implement `src/tools/handlers/web-fetch.ts` with SSRF defense**
  - Validate protocol (`http:`, `https:`).
  - Resolve DNS and reject loopback (`127.0.0.0/8`), private IPv4 (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`), and IPv6 locals.
  - Implement 10-second `AbortSignal` timeout.
  - Strip HTML tags, script, style, comments; normalize whitespace into readable markdown text.
  - Cap response body to 50KB / 20,000 characters.
- [ ] **Step 4: Implement `src/tools/handlers/web-search.ts`**
  - Call search client with query and optional result limit.
  - Format output clearly for the agent context.
- [ ] **Step 5: Register tools in `src/tools/registry.ts` and update `src/tools/types.ts`**
  - Add tool definitions `web_search` and `web_fetch` to `DEFAULT_TOOLS`.
- [ ] **Step 6: Run tests and confirm passing**
  - Run: `npx vitest run tests/web-search-tool.test.ts tests/web-fetch-ssrf.test.ts`
- [ ] **Step 7: Commit**
  - `git add src/tools/ tests/web-search-tool.test.ts tests/web-fetch-ssrf.test.ts`
  - `git commit -m "feat(tools): web_search and safe web_fetch tools with SSRF guards"`

---

### Task 3: BOM Specialist "Grocery List First, Sourcing Second" Upgrade

**Files:**
- Modify: `src/specialists/packages/bom/index.ts`
- Modify: `src/specialists/types.ts`
- Test: `tests/bom-specialist-sourcing.test.ts`

- [ ] **Step 1: Write failing test in `tests/bom-specialist-sourcing.test.ts`**
  - Verify `bomPackage.allowedTools` includes `web_search` and `web_fetch`.
  - Verify other specialist packages (`conops`, `architecture`, `requirements`, etc.) do NOT include `web_search` or `web_fetch`.
  - Verify BOM prompt contains explicit instructions for Stage 1 (grocery list in `BOM.md` first) and Stage 2 (sourcing in `TRADE_STUDY.md` second).
- [ ] **Step 2: Run test to confirm failure**
  - Run: `npx vitest run tests/bom-specialist-sourcing.test.ts`
- [ ] **Step 3: Update `src/specialists/packages/bom/index.ts`**
  - Add `web_search` and `web_fetch` to `allowedTools`.
  - Update system prompt with explicit two-stage instructions:
    1. Stage 1: Build the complete grocery list across all subsystems in `docs/BOM.md` (all items `Identified`, integer quantities, baseline estimated budget) before web searching.
    2. Stage 2: Sourcing & Trade Study in `docs/TRADE_STUDY.md` using `web_search` and `web_fetch` to compare real candidate components, then update `BOM.md` with selected manufacturer model numbers, URLs, and market prices.
  - Update secret sauce example with realistic web links, candidate specs, and lead-time markers.
- [ ] **Step 4: Run tests and confirm passing**
  - Run: `npx vitest run tests/bom-specialist-sourcing.test.ts`
- [ ] **Step 5: Commit**
  - `git add src/specialists/ tests/bom-specialist-sourcing.test.ts`
  - `git commit -m "feat(bom): grocery list first and web sourcing workflow in BOM specialist"`

---

### Task 4: Master BOM Parsing & Atomic Procurement Update Engine

**Files:**
- Create: `src/server/parsers/bom-updater.ts`
- Modify: `src/server/parsers/bom-parser.ts`
- Test: `tests/bom-updater.test.ts`

- [ ] **Step 1: Write failing test in `tests/bom-updater.test.ts`**
  - Test updating an existing row's status (`Identified` → `Ordered` → `Shipped` → `Received` → `Bench Tested` → `Consumed`).
  - Test updating actual total spend and recalculating net budget variance and committed spend.
  - Test updating order and tracking numbers.
  - Test preserving table formatting, comments, and open questions without corruption.
- [ ] **Step 2: Run test to confirm failure**
  - Run: `npx vitest run tests/bom-updater.test.ts`
- [ ] **Step 3: Implement `src/server/parsers/bom-updater.ts`**
  - Parse markdown table rows cleanly.
  - Match row by `itemId` (e.g. `SS01-01`).
  - Update row cells (escape pipe characters).
  - Recalculate `## 2. Financial & Procurement Rollup` section:
    - Sum estimated totals.
    - Sum actual committed totals.
    - Calculate net budget variance.
    - Compute procurement progress percentages.
- [ ] **Step 4: Update `src/server/parsers/bom-parser.ts` if needed**
  - Ensure parser extracts carrier, tracking links, order numbers, and all 6 statuses.
- [ ] **Step 5: Run tests and confirm passing**
  - Run: `npx vitest run tests/bom-updater.test.ts`
- [ ] **Step 6: Commit**
  - `git add src/server/parsers/ tests/bom-updater.test.ts`
  - `git commit -m "feat(bom): atomic markdown row updater and financial rollup recalculator"`

---

### Task 5: Server REST Endpoints & Search Settings Management

**Files:**
- Modify: `src/server/router.ts`
- Modify: `src/config.ts`
- Test: `tests/server-bom-api.test.ts`
- Test: `tests/server-search-settings.test.ts`

- [ ] **Step 1: Write failing tests in `tests/server-bom-api.test.ts` and `tests/server-search-settings.test.ts`**
  - Test `PATCH /api/bom/items/:itemId` updates `docs/BOM.md` and returns updated item and financials.
  - Test `GET /api/settings/search` returns active search provider and masked keys.
  - Test `POST /api/settings/search` updates search config in `~/.starn/config.json`.
  - Test `POST /api/settings/search/probe` checks search connectivity.
- [ ] **Step 2: Run tests to confirm failure**
  - Run: `npx vitest run tests/server-bom-api.test.ts tests/server-search-settings.test.ts`
- [ ] **Step 3: Implement endpoints in `src/server/router.ts`**
  - Add `PATCH /api/bom/items/:itemId` handler.
  - Add `GET /api/settings/search` handler.
  - Add `POST /api/settings/search` handler.
  - Add `POST /api/settings/search/probe` handler.
- [ ] **Step 4: Run tests and confirm passing**
  - Run: `npx vitest run tests/server-bom-api.test.ts tests/server-search-settings.test.ts`
- [ ] **Step 5: Commit**
  - `git add src/server/ tests/server-bom-api.test.ts tests/server-search-settings.test.ts`
  - `git commit -m "feat(server): BOM item patch endpoint and search settings API"`

---

### Task 6: Web UI Parts Hub Enhancement & Search Settings

**Files:**
- Modify: `web/src/views/PartsView.tsx`
- Modify: `web/src/views/SettingsView.tsx`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/types/api.ts`

- [ ] **Step 1: Update web API client and types**
  - Add `updateBomItem(itemId: string, patch: Partial<BomItem>)` in `web/src/api/client.ts`.
  - Add `fetchSearchSettings()`, `saveSearchSettings()`, and `probeSearchProvider()` in `web/src/api/client.ts`.
  - Update `BomItem` and `SearchConfig` types in `web/src/types/api.ts`.
- [ ] **Step 2: Enhance `web/src/views/PartsView.tsx`**
  - **Sourcing Sub-Tab:** Show candidate comparison cards, compliance tags, vendor links.
  - **BOM Sub-Tab:** Master grocery list table with inline edit, budget metrics banner.
  - **Parts Sub-Tab:** Procurement logistics tracker with status dropdown (`Identified`, `Ordered`, `Shipped`, `Received`, `Bench Tested`, `Consumed`), clickable carrier tracking links (auto-detecting FedEx, UPS, USPS), actual spend input, and save/cancel actions.
- [ ] **Step 3: Enhance `web/src/views/SettingsView.tsx`**
  - Add "Web Search & Sourcing Provider" card.
  - Provider selector: `OpenRouter (Built-in, zero config)` | `Tavily` | `Brave Search`.
  - Masked API key inputs with save and test connection button.
- [ ] **Step 4: Verify web build**
  - Run: `npm --prefix web run build`
- [ ] **Step 5: Commit**
  - `git add web/src/`
  - `git commit -m "feat(web): parts procurement logistics tracker, carrier links, and search settings"`

---

### Task 7: CLI Commands Parity & End-to-End Verification

**Files:**
- Create: `src/cli/parts-commands.ts`
- Modify: `src/cli/ui.ts`
- Modify: `src/cli/prompts.ts`
- Test: `tests/cli-parts.test.ts`

- [ ] **Step 1: Write failing test in `tests/cli-parts.test.ts`**
  - Test `/parts` renders procurement table with statuses and financial rollup.
  - Test `/parts update` updates item status and actual cost from CLI.
  - Test `/search-key` sets search provider and key.
- [ ] **Step 2: Run test to confirm failure**
  - Run: `npx vitest run tests/cli-parts.test.ts`
- [ ] **Step 3: Implement CLI commands in `src/cli/parts-commands.ts`**
  - Implement `/parts`, `/parts update <itemId> [status] [actual] [tracking]`, `/trade-study [subsystem]`.
  - Register in CLI prompt handler (`src/cli/prompts.ts`).
- [ ] **Step 4: Run full verification suite**
  - Run: `npm test`
  - Run: `npm run build`
- [ ] **Step 5: Commit**
  - `git add src/cli/ tests/cli-parts.test.ts`
  - `git commit -m "feat(cli): /parts and /parts update procurement commands"`
