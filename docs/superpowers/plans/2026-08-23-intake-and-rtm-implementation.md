# STARN Intake Workflow, RTM Specialist & UI Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade STARN with a dynamic 1-by-1 intake interview for new projects, a dedicated gated RTM (Requirements Traceability Matrix) package, standardized `1.a` and `Requirement 1.a` document schemas, multi-turn session memory, and streamlined terminal UI.

**Architecture:** Enhances the TypeScript modular engine to maintain session-level conversational transcripts, track intake state in `state.json`, gate specialist packages on prior approved deliverables, extract clean markdown without conversational commentary, and render tabular RTMs and scannable requirement matrices.

**Tech Stack:** TypeScript (ES2022 / Node.js 20+), Vitest, Inquirer / `@inquirer/prompts`, Chalk, Boxen, Zod.

**Spec:** `docs/superpowers/specs/2026-08-23-starn-intake-and-rtm-design.md`

## Global Constraints
- Node.js 20+ compatibility with pure TypeScript and ESM (`"type": "module"`).
- Plain-text units (`72V`, `-20°C to +45°C`, `12 kW`, `120 Nm/s`), clean ASCII block diagrams, no raw LaTeX math formatting (`$\text{...}$`).
- RTM specialist package must be 100% tabular and gated on approved requirements.
- Capabilities formatted as `1.a`, `1.b`; Requirements formatted as `Requirement 1.a`, `Requirement 1.b`.
- Test-driven development for every module using Vitest.

---

### Task 1: Project State Extension for Intake & Prerequisites

**Files:**
- Modify: `src/workspace/types.ts`
- Modify: `src/workspace/state.ts`
- Test: `tests/workspace.test.ts`

**Interfaces:**
- Produces: `IntakeState`, `ProjectStateManager.updateIntake()`, `ProjectStateManager.isArtifactApproved(id)`

- [ ] **Step 1: Write failing tests for intake state and artifact prerequisite checks**

```typescript
// tests/workspace.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('Project State Manager - Intake & Prerequisites', () => {
  let tempBaseDir: string;

  beforeEach(() => {
    tempBaseDir = path.join(os.tmpdir(), 'starn-intake-test-' + Date.now());
    fs.mkdirSync(tempBaseDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempBaseDir, { recursive: true, force: true });
  });

  it('manages intake state across one-by-one interview turns', () => {
    const stateMgr = new ProjectStateManager(tempBaseDir);
    const initial = stateMgr.getOrCreateState('p1', 'Tractor EV');
    expect(initial.intake.completed).toBe(false);
    expect(initial.intake.currentQuestionIndex).toBe(0);

    stateMgr.recordIntakeAnswer('projectName', 'Electric Tractor Conversion');
    stateMgr.recordIntakeAnswer('projectIntent', 'Mow 2 acres and tow small yard trailers');
    stateMgr.incrementIntakeQuestion();

    const updated = stateMgr.getState();
    expect(updated.intake.answers.projectName).toBe('Electric Tractor Conversion');
    expect(updated.intake.answers.projectIntent).toContain('Mow 2 acres');
    expect(updated.intake.currentQuestionIndex).toBe(1);
  });

  it('checks if prerequisite artifacts are approved', () => {
    const stateMgr = new ProjectStateManager(tempBaseDir);
    stateMgr.getOrCreateState('p1', 'Tractor EV');

    expect(stateMgr.isArtifactApproved('CAPABILITIES')).toBe(false);
    expect(stateMgr.isArtifactApproved('REQUIREMENTS')).toBe(false);

    stateMgr.recordArtifact({
      id: 'REQUIREMENTS',
      title: 'System Requirements',
      path: 'docs/REQUIREMENTS.md',
      status: 'approved',
      criticScore: 9.0
    });

    expect(stateMgr.isArtifactApproved('REQUIREMENTS')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workspace.test.ts`
Expected: FAIL (missing intake properties/methods)

- [ ] **Step 3: Update `src/workspace/types.ts` and `src/workspace/state.ts`**

Implement `IntakeState`, initialize `intake` in `getOrCreateState`, and add `recordIntakeAnswer()`, `incrementIntakeQuestion()`, `completeIntake()`, and `isArtifactApproved(id)`.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/workspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workspace/ tests/workspace.test.ts
git commit -m "feat: add intake tracking and artifact prerequisite checks to workspace state"
```

---

### Task 2: Dedicated RTM Specialist & Numbering Schema Updates

**Files:**
- Create: `src/specialists/packages/rtm/index.ts`
- Create: `src/specialists/packages/requirements/index.ts`
- Modify: `src/specialists/packages/capabilities/index.ts`
- Modify: `src/specialists/types.ts`
- Modify: `src/specialists/registry.ts`
- Test: `tests/specialists.test.ts`

**Interfaces:**
- Produces: `rtmPackage`, `requirementsPackage`, `SpecialistPackage.prerequisiteArtifactId`

- [ ] **Step 1: Write failing tests for RTM package and updated specialist schemas**

```typescript
// tests/specialists.test.ts
import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Specialist Packages & RTM', () => {
  const registry = new SpecialistRegistry();

  it('loads RTM and separated Requirements packages with prerequisite metadata', () => {
    const rtm = registry.get('rtm');
    expect(rtm).toBeDefined();
    expect(rtm!.name).toContain('Traceability Matrix');
    expect(rtm!.prerequisiteArtifactId).toBe('REQUIREMENTS');
    expect(rtm!.secretSauceExamples[0]).toContain('| Req ID | Requirement Summary | Method |');

    const reqs = registry.get('requirements');
    expect(reqs).toBeDefined();
    expect(reqs!.prerequisiteArtifactId).toBe('CAPABILITIES');
    expect(reqs!.systemPrompt).toContain('Requirement 1.a');
  });

  it('capabilities package enforces 1.a numbering and plain text units', () => {
    const cap = registry.get('capabilities');
    expect(cap).toBeDefined();
    expect(cap!.systemPrompt).toContain('1.a');
    expect(cap!.systemPrompt).toContain('plain-text');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/specialists.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement RTM, Requirements, and updated Capabilities packages**

Implement `src/specialists/packages/rtm/index.ts`, `src/specialists/packages/requirements/index.ts`, update `src/specialists/packages/capabilities/index.ts`, `src/specialists/types.ts`, and `src/specialists/registry.ts`.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/specialists.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/specialists/ tests/specialists.test.ts
git commit -m "feat: add dedicated RTM package and standardize 1.a and Requirement 1.a schemas"
```

---

### Task 3: Guided 1-by-1 Intake Interview & Multi-Turn Session Memory

**Files:**
- Modify: `src/core/discovery.ts`
- Modify: `src/core/runner.ts`
- Test: `tests/core-loop.test.ts`

**Interfaces:**
- Produces: `CoreRunner.executeTurn()` with multi-turn message retention, 1-by-1 guided intake workflow, and prerequisite validation.

- [ ] **Step 1: Write failing tests for intake questions and prerequisite blocking**

```typescript
// tests/core-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoreRunner } from '../src/core/runner.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('Core Runner Intake & Multi-Turn', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;
  let mockClient: OpenRouterClient;
  let toolRegistry: ToolRegistry;
  let specialistRegistry: SpecialistRegistry;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-runner-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('p1', 'Tractor Test');
    mockClient = new OpenRouterClient({ apiKey: 'mock' });
    toolRegistry = new ToolRegistry();
    specialistRegistry = new SpecialistRegistry();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('blocks RTM execution if REQUIREMENTS artifact is not approved', async () => {
    const result = await CoreRunner.executeTurn({
      userPrompt: 'Generate an RTM matrix for the tractor',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    expect(result.specialistId).toBe('general');
    expect(result.output).toContain('Requirements have not yet been approved');
  });

  it('initiates 1-by-1 intake when no CONOPS exists on a new project', async () => {
    const result = await CoreRunner.executeTurn({
      userPrompt: 'Start the project and make a CONOPS',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      sessionMessages: []
    });

    expect(result.specialistId).toBe('conops');
    expect(result.requiresReview).toBe(false); // Question turn, not a full document
    expect(result.output).toContain('What is the project?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core-loop.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `src/core/discovery.ts` and `src/core/runner.ts`**

Implement multi-turn history pass-through, prerequisite checking before specialist execution, and 1-by-1 intake state progression for CONOPS.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/core-loop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ tests/core-loop.test.ts
git commit -m "feat: implement 1-by-1 guided intake workflow and multi-turn session transcript"
```

---

### Task 4: Clean Markdown Extraction & Streamlined Terminal UI

**Files:**
- Modify: `src/cli/checkpoint.ts`
- Modify: `src/cli/ui.ts`
- Modify: `src/index.ts`
- Test: `tests/cli-unit.test.ts`

**Interfaces:**
- Produces: `extractCleanMarkdownDocument(rawText: string): string`, `formatDocumentPreview(content: string, title: string): string`

- [ ] **Step 1: Write failing tests for clean document markdown extraction and previews**

```typescript
// tests/cli-unit.test.ts
import { describe, it, expect } from 'vitest';
import { extractCleanMarkdownDocument, formatDocumentPreview } from '../src/cli/ui.js';

describe('Clean Markdown Extraction & Previews', () => {
  it('strips conversational preamble and extracts pure markdown deliverable', () => {
    const raw = `Here is your requested deliverable:\n\n# Concept of Operations (CONOPS)\n## 1.0 Executive Summary\nTractor conversion.\n\nLet me know if you want revisions!`;
    const cleaned = extractCleanMarkdownDocument(raw);
    expect(cleaned.startsWith('# Concept of Operations (CONOPS)')).toBe(true);
    expect(cleaned).not.toContain('Here is your requested deliverable');
    expect(cleaned).not.toContain('Let me know if you want revisions');
  });

  it('formats clean preview box for large documents', () => {
    const content = `# Concept of Operations\n## 1.0 Executive Summary\nLine 1\nLine 2\n## 2.0 Operational Environment\nLine 3\n## 3.0 System Modes\nLine 4`;
    const preview = formatDocumentPreview(content, 'CONOPS Document');
    expect(preview).toContain('CONOPS Document');
    expect(preview).toContain('Executive Summary');
    expect(preview).toContain('Operational Environment');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-unit.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement extraction, preview formatting, and update checkpoint workflow**

Implement `extractCleanMarkdownDocument` and `formatDocumentPreview` in `src/cli/ui.ts`, update `src/cli/checkpoint.ts` to save cleaned markdown, and update `src/index.ts` to maintain `sessionMessages` transcript across the interactive loop.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/cli-unit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/ src/index.ts tests/cli-unit.test.ts
git commit -m "feat: implement clean markdown artifact extraction and collapsible terminal previews"
```

---

### Task 5: Autonomous Testbed Scenarios & Full Verification

**Files:**
- Modify: `testbed/types.ts`
- Create: `testbed/test_prompts/03_tractor_ev_rtm.json`
- Modify: `testbed/grading_criteria/rubrics.ts`
- Modify: `testbed/runner.ts`
- Test: `tests/testbed.test.ts`

- [ ] **Step 1: Write testbed tests for RTM tabular verification**

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/testbed.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement test scenario, rubric, and runner updates**

- [ ] **Step 4: Run full test suite and build verification**

Run: `npm run build && npm test`
Expected: ALL PASS

- [ ] **Step 5: Commit and Push**

```bash
git add testbed/ tests/testbed.test.ts
git commit -m "feat: add RTM test scenario and verify full autonomous test suite"
```
