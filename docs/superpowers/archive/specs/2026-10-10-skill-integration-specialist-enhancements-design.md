# Skill-Inspired Specialist & Tool Enhancements Design

## 1. Executive Summary & Intent
This specification defines targeted enhancements to STARN's specialists and tools, inspired by curated capabilities from the AI Agent Skills ecosystem (`awesome-claude-skills`). Rather than adding monolithic or heavy dependencies, each capability is pruned to the bare minimum required for physical and hardware project management (solar sheds, power conversions, outdoor robotics, fabrication), strictly scoped to the exact specialists that need them to eliminate hallucination vectors.

### Deployment & Runtime Philosophy (Local Package & Cloudflare Compatibility)
STARN is designed to run in two primary target environments:
1. **Local CLI/Package:** Users install STARN via npm (`npx starn` / `npm install`) or run locally. It must stay lightweight, fast, have zero native build dependencies (no node-gyp / C++ compilation), and zero security audit vulnerabilities.
2. **Cloud-Hosted / Cloudflare Support:** Future deployment targets include Cloudflare Workers/Pages or containerized environments. Heavy dependencies with complex filesystem assumptions or known vulnerabilities (e.g. legacy SheetJS/xlsx CVEs or deep sub-dependency trees) break serverless bundles and introduce security risks.

Therefore, document extraction is implemented with **zero external npm dependencies**, using Node.js built-ins (`zlib.inflateRawSync` / Web standard streams) and pure TypeScript string/XML parsers.

The four core capabilities are:
1. **Zero-Dependency Reference Document Ingestion (`docx`, `csv`, `pdf`):** Gives specialists the ability to ingest real vendor spec sheets, equipment schedules, wiring lists, and manuals dropped into `reference/` via `fs_read` without external package bloat.
2. **Grounded Technical Research & Trade Studies (Architecture & ICD):** Extends `web_search` and `web_fetch` strictly to the `architecture` and `icd` specialists with strict citation requirements for hardware specifications, wire gauges, and communication protocols.
3. **Physical Safety & Defense-in-Depth Auditing:** Incorporates defense-in-depth, single-point-of-failure isolation, and physical/electrical safety into the system prompts and Critic rubrics for `architecture`, `icd`, and `risk-register`.
4. **Combinatorial Test Matrix Generation (Test Plans):** Enhances the `testplans` specialist with pairwise/combinatorial parameter testing matrices (inspired by PICT) to ensure multi-variable hardware behaviors (temperature × SOC × load) are verified without combinatorial explosion.

---

## 2. Architecture & Detailed Design

### 2.1 Multi-Format Reference Document Ingestion
**Location:** `src/tools/document-extractors/` & `src/tools/handlers/fs-read.ts`

- **Supported Formats:**
  - `.pdf`: Existing `extractTextFromPdf` (via `pdfjs-dist`).
  - `.docx`: Zero-dependency ZIP entry reader extracting text from `word/document.xml` using Node built-in `zlib.inflateRawSync`. Extracts paragraph breaks, tab stops, and text nodes cleanly while ignoring formatting tags.
  - `.csv`: Zero-dependency tabular parser converting CSV rows and columns into clean, aligned Markdown tables with header separators. Capped at 250 rows to protect context window, adding a truncation notice if exceeded.
  - Plain text (`.md`, `.txt`, `.json`, etc.): Standard UTF-8 read.
- **Portability:** Extractors accept file paths or Buffers/Uint8Arrays, decoupling them from local storage and allowing future Cloudflare R2 / virtual storage adapters.
- **Tool Scoping:** `fs_read` remains available to specialists that have file read access, but now automatically recognizes binary office formats and returns structured text rather than garbled characters.
- **Safety & Error Handling:** Corrupt or password-protected files return a helpful failure message rather than crashing the tool execution loop.

### 2.2 Grounded Technical Research & Trade Studies
**Location:** `src/specialists/packages/architecture/index.ts` & `src/specialists/packages/icd/index.ts`

- **Allowed Tools Expansion:**
  - `architecture`: Add `web_search` and `web_fetch` to `allowedTools`.
  - `icd`: Add `web_search` and `web_fetch` to `allowedTools`.
  - All other specialists (except `bom` and `general`) remain restricted to filesystem and state tools.
- **System Prompt Rules:**
  - Grounding: When specifying protocols (e.g., J1939 CAN 2.0B, RS-485 Modbus RTU), voltage ranges, or connector pinouts, query `web_search` or inspect `reference/` files.
  - Citations: Explicitly cite manufacturer datasheets or documentation URLs in `docs/ARCHITECTURE.md` and `docs/ICD.md`.
  - Anti-hallucination: Inventing pinouts or non-standard protocols is strictly prohibited.

### 2.3 Physical Safety & Defense-in-Depth
**Location:** Specialist Prompts & Critic Rubrics (`architecture`, `icd`, `risk-register`)

- **Architecture:**
  - System prompt: Require single-point-of-failure analysis and fail-safe defaults (loss of signal or auxiliary 12V power must force high-voltage contactors open).
  - Critic rubric: Add Criterion 7: "Physical Safety & Defense-in-Depth: Does the architecture account for fail-safe default states, physical isolation, and environmental ingress protection?"
- **ICD:**
  - System prompt: Require electrical protection specifications (fusing, circuit breakers, reverse polarity diode protection, galvanic isolation) for every high-voltage or power-carrying interface.
  - Critic rubric: Add Criterion: "Interface Safety & Protection: Are voltage/current thresholds, fuse ratings, wire AWG sizing, and isolation barriers clearly specified?"
- **Risk Register:**
  - System prompt: Require multi-layered defense (primary prevention + secondary containment + emergency response) for severe physical hazards.
  - Critic rubric: Evaluate defense-in-depth mitigations for high-severity failure modes.

### 2.4 Combinatorial Test Matrix Generation
**Location:** `src/specialists/packages/testplans/index.ts`

- **System Prompt Enhancement:**
  - For complex multi-variable subsystems (battery management, thermal loops, powertrain control), require a **Combinatorial Test Matrix** table.
  - Parameters must include operating states (e.g. ambient temp [Cold, Room, Hot], battery charge [Low, Mid, Full], system load [Idle, Nominal, Peak]).
- **Secret Sauce Example:**
  - Add a realistic combinatorial matrix to `testplansSecretSauce` demonstrating pairwise parameter coverage for electrical conversion testing.
- **Critic Rubric:**
  - Evaluate whether multi-variable procedures use combinatorial parameter coverage to catch edge-case interactions.

---

## 3. Verification & Quality Gates
- **Type Safety:** Zero errors with `npx tsc --noEmit`.
- **Vitest Suite:** 100% passing tests across all new and existing test suites.
- **Unit Tests:**
  - `tests/document-extractors.test.ts`: Tests `docx`, `xlsx`, `csv`, and `pdf` extractors.
  - `tests/architecture-research.test.ts`: Verifies `architecture` specialist has `web_search`/`web_fetch` and prompt citation rules.
  - `tests/icd-research.test.ts`: Verifies `icd` specialist has `web_search`/`web_fetch` and interface safety rules.
  - `tests/safety-critic-rubrics.test.ts`: Verifies defense-in-depth and safety criteria in `architecture`, `icd`, and `risk-register` rubrics.
  - `tests/testplans-combinatorial.test.ts`: Verifies combinatorial matrix requirements and secret sauce in `testplans`.
- **Web Build:** Clean build with `npm --prefix web run build`.
