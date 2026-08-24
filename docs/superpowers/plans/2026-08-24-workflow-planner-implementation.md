# STARN Workflow Planner & Phase Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a stage-bound Project Workflow Planner that tracks document lifecycle progress, locks active phase scope to prevent cross-document misrouting, and allows explicit user phase overrides with confirmation.

**Architecture:** Extends `ProjectState` with a structured 7-phase workflow (`conops` -> `capabilities` -> `requirements` -> `rtm` -> `milestones` -> `wbs` -> `sow`). Integrates roadmap visualization (`/plan`), phase-aware classification, and confirmation prompts for phase jumps.

**Tech Stack:** TypeScript (ES2022 / Node.js 20+), Vitest, Inquirer / `@inquirer/prompts`, Chalk, Boxen.

**Spec:** `docs/superpowers/specs/2026-08-24-workflow-planner-and-phase-tracking.md`

## Global Constraints
- Node.js 20+ compatibility with pure TypeScript and ESM (`"type": "module"`).
- All 7 phases tracked in `state.json`.
- Classifier must be phase-aware: user edits stay anchored to `activePhase` unless an explicit phase switch is requested and confirmed.
- User can trigger `/plan`, `/goto <phase>`, `/next` at any prompt.

---

### Task 1: Workflow State & Phase Roadmap Management

**Files:**
- Modify: `src/workspace/types.ts`
- Modify: `src/workspace/state.ts`
- Test: `tests/workspace.test.ts`

**Interfaces:**
- Produces: `WorkflowPhase`, `WorkflowState`, `ProjectStateManager.setActivePhase(phase)`, `ProjectStateManager.advanceToNextPhase()`

- [ ] **Step 1: Write failing tests for workflow state in `tests/workspace.test.ts`**

```typescript
// tests/workspace.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('Project Workflow State Manager', () => {
  let tempBaseDir: string;

  beforeEach(() => {
    tempBaseDir = path.join(os.tmpdir(), 'starn-workflow-test-' + Date.now());
    fs.mkdirSync(tempBaseDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempBaseDir, { recursive: true, force: true });
  });

  it('initializes workflow with 7 phases and activePhase set to conops', () => {
    const stateMgr = new ProjectStateManager(tempBaseDir);
    const state = stateMgr.getOrCreateState('p1', 'Tractor EV');
    expect(state.workflow).toBeDefined();
    expect(state.workflow.activePhase).toBe('conops');
    expect(Object.keys(state.workflow.phases)).toEqual(
      expect.arrayContaining(['conops', 'capabilities', 'requirements', 'rtm', 'milestones', 'wbs', 'sow'])
    );
  });

  it('switches active phase and advances to next logical phase upon approval', () => {
    const stateMgr = new ProjectStateManager(tempBaseDir);
    stateMgr.getOrCreateState('p1', 'Tractor EV');

    stateMgr.setActivePhase('conops');
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'CONOPS Document',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.2
    });

    const nextPhase = stateMgr.advanceToNextPhase();
    expect(nextPhase).toBe('capabilities');
    expect(stateMgr.getState().workflow.activePhase).toBe('capabilities');
    expect(stateMgr.getState().workflow.phases.conops.status).toBe('approved');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workspace.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `src/workspace/types.ts` and `src/workspace/state.ts`**

Implement `WorkflowState`, `WorkflowPhaseInfo`, and workflow state transition methods.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/workspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workspace/ tests/workspace.test.ts
git commit -m "feat: implement 7-phase workflow state and phase advancement in workspace manager"
```

---

### Task 2: Workflow Roadmap UI & Commands

**Files:**
- Modify: `src/cli/ui.ts`
- Modify: `src/cli/prompts.ts`
- Test: `tests/cli-unit.test.ts`

**Interfaces:**
- Produces: `formatWorkflowRoadmap(state: ProjectState): string`, `/plan`, `/goto` command interceptor.

- [ ] **Step 1: Write failing tests for roadmap formatting in `tests/cli-unit.test.ts`**

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-unit.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `formatWorkflowRoadmap` in `src/cli/ui.ts`**

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/cli-unit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/ tests/cli-unit.test.ts
git commit -m "feat: implement terminal workflow roadmap display and phase visualization"
```

---

### Task 3: Context-Aware Classifier & Phase Override Confirmation

**Files:**
- Modify: `src/core/classifier.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/index.ts`
- Test: `tests/discovery-and-classifier.test.ts`
- Test: `tests/core-loop.test.ts`

**Interfaces:**
- Produces: `classifyRequest(prompt, client, model, activePhase)` anchoring edits to active phase and detecting explicit phase switches.

- [ ] **Step 1: Write failing tests for phase-anchored classification and override detection**

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery-and-classifier.test.ts`
Expected: FAIL

- [ ] **Step 3: Update classifier and core runner with phase confirmation**

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ src/index.ts tests/
git commit -m "feat: implement phase-aware request classification and interactive phase override confirmation"
```

---

### Task 4: Autonomous Testbed Scenarios & Full Verification

**Files:**
- Modify: `testbed/runner.ts`
- Run: `npm run build && npm test`

- [ ] **Step 1: Full build and test suite verification**
- [ ] **Step 2: Commit and push to master**
