# Skill-Inspired Specialist & Tool Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate high-leverage skill capabilities from the Claude Skills ecosystem (multi-format reference document ingestion, grounded technical research, physical safety/defense-in-depth, and combinatorial test matrices) into STARN's specialists and tools with strict specialist-level scoping.

**Architecture:** Add zero-dependency/pure-TypeScript document extractors (`docx`, `csv`) to `fs_read` so specialists can read real reference files in `reference/` without external package bloat or security vulnerabilities. Scope `web_search` and `web_fetch` strictly to `architecture` and `icd` specialists with citation requirements. Embed defense-in-depth criteria into `architecture`, `icd`, and `risk-register` prompts and critic rubrics. Embed pairwise combinatorial parameter matrices into the `testplans` specialist.

**Tech Stack:** TypeScript, Node.js built-ins (`zlib`, `fs`, `path`), `pdfjs-dist` (existing), Vitest, React.

**Spec:** `docs/superpowers/specs/2026-10-10-skill-integration-specialist-enhancements-design.md`

## Global Constraints
- **Zero External Document Dependencies:** Do NOT add heavy or vulnerable third-party packages (e.g. `mammoth`, `xlsx`). Use pure TypeScript and Node.js built-ins (`zlib.inflateRawSync` / standard streams) to ensure fast local installation and 100% compatibility with future Cloudflare (Workers / Pages / R2) deployments.
- **Decoupled Core:** `core/*`, `workspace/*`, `models/*`, `tools/*`, and `specialists/*` must never import `cli/*` or `server/*`.
- **Strict Tool Scoping:** Only specifically authorized specialists (`bom`, `general`, `architecture`, `icd`) receive `web_search` and `web_fetch`. Never grant web tools globally.
- **Payload & Context Defense:** Document extractors must cap output (e.g. 250 rows for CSV) to avoid context exhaustion.
- **Zero Type Errors:** `npx tsc --noEmit` must pass with 0 errors.
- **100% Green Vitest Suite:** All existing and new tests must pass.
- **Clean Web Build:** `npm --prefix web run build` must succeed.

---

## Tasks

### Task 1: Zero-Dependency Document Ingestion Engine (`docx`, `csv`)
**Files:**
- Create: `src/tools/document-extractors/docx-extractor.ts`
- Create: `src/tools/document-extractors/csv-extractor.ts`
- Modify: `src/tools/handlers/fs-read.ts`
- Create: `tests/document-extractors.test.ts`

- [ ] Write failing test in `tests/document-extractors.test.ts` testing extraction of DOCX (parsing `word/document.xml` from synthetic ZIP buffer) and CSV table formatting.
- [ ] Run `npx vitest run tests/document-extractors.test.ts` and verify test fails.
- [ ] Implement `src/tools/document-extractors/docx-extractor.ts` to extract clean text/paragraphs from DOCX buffers/files using Node's built-in `zlib`.
- [ ] Implement `src/tools/document-extractors/csv-extractor.ts` to format CSV files as clean markdown tables with 250-row truncation cap.
- [ ] Update `src/tools/handlers/fs-read.ts` to route `.docx` and `.csv` to their dedicated extractors alongside `.pdf`, while retaining plain-text handling for other extensions.
- [ ] Run `npx vitest run tests/document-extractors.test.ts` and verify test passes.
- [ ] Run `npx tsc --noEmit` and verify zero errors.
- [ ] Commit changes: `feat(tools): zero-dependency document ingestion (docx, csv, pdf)`.

---

### Task 2: Grounded Technical Research for Architecture & ICD Specialists
**Files:**
- Modify: `src/specialists/packages/architecture/index.ts`
- Modify: `src/specialists/packages/icd/index.ts`
- Create: `tests/specialist-research.test.ts`

- [ ] Write failing tests in `tests/specialist-research.test.ts` verifying:
  - `architecture` specialist `allowedTools` contains `web_search` and `web_fetch`.
  - `icd` specialist `allowedTools` contains `web_search` and `web_fetch`.
  - Other specialist packages (e.g. `conops`, `requirements`, `milestones`, `build-sequence`) do NOT have `web_search` or `web_fetch`.
  - System prompts of `architecture` and `icd` require technical citations and grounding in `reference/` files or web datasheets.
- [ ] Run `npx vitest run tests/specialist-research.test.ts` and verify failure.
- [ ] Update `src/specialists/packages/architecture/index.ts`:
  - Add `'web_search'` and `'web_fetch'` to `allowedTools`.
  - Add technical grounding rules to `systemPrompt` (inspecting `reference/` documents, verifying physical dimensions and communication bus specs via web search, citing sources).
- [ ] Update `src/specialists/packages/icd/index.ts`:
  - Add `'web_search'` and `'web_fetch'` to `allowedTools`.
  - Add interface grounding rules to `systemPrompt` (verifying pinouts, AWG wire ratings, connector part numbers, and signal voltages via web search and reference files).
- [ ] Run `npx vitest run tests/specialist-research.test.ts` and verify test passes.
- [ ] Run `npx tsc --noEmit` to verify type safety.
- [ ] Commit changes: `feat(specialists): add grounded technical research to architecture and icd`.

---

### Task 3: Physical Safety & Defense-in-Depth in Prompts & Critic Rubrics
**Files:**
- Modify: `src/specialists/packages/architecture/index.ts`
- Modify: `src/specialists/packages/icd/index.ts`
- Modify: `src/specialists/packages/risk-register/index.ts`
- Create: `tests/safety-critic-rubrics.test.ts`

- [ ] Write failing tests in `tests/safety-critic-rubrics.test.ts` verifying:
  - `architecture` system prompt and critic rubric require single-point-of-failure isolation, fail-safe defaults, and environmental protection.
  - `icd` system prompt and critic rubric require overcurrent protection, fusing, wire gauge sizing, and isolation barriers.
  - `risk-register` system prompt and critic rubric mandate defense-in-depth mitigations (prevention + containment + cutoff).
- [ ] Run `npx vitest run tests/safety-critic-rubrics.test.ts` and verify failure.
- [ ] Update `src/specialists/packages/architecture/index.ts`:
  - Enhance `systemPrompt` with defense-in-depth design rules (fail-safe contactors, thermal dissipation paths, ingress rating).
  - Add Criterion 7 to `criticRubric`: "Physical Safety & Defense-in-Depth".
- [ ] Update `src/specialists/packages/icd/index.ts`:
  - Enhance `systemPrompt` with physical interface safety rules (fusing, reverse polarity protection, shielding, ground loops).
  - Add Criterion to `criticRubric`: "Interface Safety & Overcurrent Protection".
- [ ] Update `src/specialists/packages/risk-register/index.ts`:
  - Enhance `systemPrompt` with defense-in-depth hazard containment requirements.
  - Update `criticRubric` to evaluate multi-layered safety barriers.
- [ ] Run `npx vitest run tests/safety-critic-rubrics.test.ts` and verify test passes.
- [ ] Run `npx tsc --noEmit` and verify type safety.
- [ ] Commit changes: `feat(critic): embed physical safety and defense-in-depth into architecture, icd, and risk rubrics`.

---

### Task 4: Combinatorial Test Matrix in Test Plans Specialist
**Files:**
- Modify: `src/specialists/packages/testplans/index.ts`
- Create: `tests/testplans-combinatorial.test.ts`

- [ ] Write failing tests in `tests/testplans-combinatorial.test.ts` verifying:
  - `testplans` package `systemPrompt` requires Combinatorial Test Matrices for multi-variable subsystems.
  - `testplans` secret sauce example contains a formatted Combinatorial Test Matrix table.
  - `testplans` `criticRubric` evaluates combinatorial coverage of parameter interactions and boundary conditions.
- [ ] Run `npx vitest run tests/testplans-combinatorial.test.ts` and verify failure.
- [ ] Update `src/specialists/packages/testplans/index.ts`:
  - Enhance `systemPrompt`: require pairwise/combinatorial parameter tables (e.g. ambient temp × state of charge × mechanical load) for complex hardware tests.
  - Update `testplansSecretSauce` with a concrete combinatorial environmental/load stress test table.
  - Update `criticRubric` to require combinatorial parameter verification on multi-variable procedures.
- [ ] Run `npx vitest run tests/testplans-combinatorial.test.ts` and verify test passes.
- [ ] Run `npx tsc --noEmit` and verify type safety.
- [ ] Commit changes: `feat(testplans): add combinatorial test matrices and pairwise stress verification`.

---

### Task 5: Full Regression, Web Build & Integration Verification
**Files:**
- Modify: `docs/superpowers/TODO.md`

- [ ] Run full vitest test suite (`npm test`) and confirm all 66+ test files and 370+ tests pass.
- [ ] Run web build (`npm --prefix web run build`) and confirm clean compilation.
- [ ] Verify core decoupling: `npx vitest run tests/core-decoupling.test.ts`.
- [ ] Update `docs/superpowers/TODO.md` to record completion of skill integration.
- [ ] Commit and push to `origin/master`.
