# Two-Tier BOM, Work Instructions Specialist & Action-Gated Testing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the two-tier BOM (Procurement Ledger in `BOM.md` with quantity, URLs, tracking, and cost rollups + `TRADE_STUDY.md` for candidate comparisons), dedicated `work-instructions` specialist for per-action shop-floor checklists, Master Action Table in `BUILD_SEQUENCE.md`, flat `artifacts/` evidence directory, and bidirectional prerequisite action gating in `TEST_PLANS.md`.

**Architecture:**
- `ORDERED_WORKFLOW_PHASES` expands to 13 canonical phases with `work-instructions` inserted at Phase 11.
- `ProjectStateManager.scaffoldProjectDirectories()` ensures `docs/work_instructions/` and `artifacts/` are scaffolded.
- `src/specialists/packages/bom/index.ts` is upgraded to produce the Two-Tier BOM (procurement ledger with `Qty`, tracking, actual prices, and cost rollups in `BOM.md`, plus candidate comparison in `TRADE_STUDY.md`).
- `src/specialists/packages/build-sequence/index.ts` is upgraded to author the Master Action Table linking to Work Instructions.
- New specialist `src/specialists/packages/work-instructions/index.ts` authors surgical per-action work instructions (`ACTION-<NUM>-<SLUG>-WORK-INSTRUCTION.md`).
- `src/specialists/packages/testplans/index.ts` is upgraded to enforce Gating Prerequisites checklists at the top of each test plan.
- `src/core/classifier.ts` is updated with routing rules for `work-instructions`.

**Tech Stack:** TypeScript (strict), Vitest. No external dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-work-instructions-and-two-tier-bom-design.md`

## Global Constraints

- Must pass `npm test` (`tsc --noEmit && vitest run`) without errors or warnings.
- `core/*`, `workspace/*`, and `specialists/*` must remain strictly I/O-agnostic.
- Follow Test-Driven Development (TDD) for every step.

---

## File Structure

| File | Responsibility | Action |
| :--- | :--- | :--- |
| `src/workspace/state.ts` | Add `work-instructions` to `ORDERED_WORKFLOW_PHASES` (13 phases); scaffold `docs/work_instructions/` and `artifacts/`. | Modify |
| `tests/workspace.test.ts` | Verify 13 workflow phases and new directory scaffolding. | Modify |
| `src/specialists/packages/bom/index.ts` | Upgrade prompts, rubrics, and secret sauce for Two-Tier BOM (`Qty`, URLs, tracking, actual prices, variance, rollups, `TRADE_STUDY.md`). | Modify |
| `tests/specialists.test.ts` | Update BOM specialist test expectations. | Modify |
| `src/specialists/packages/build-sequence/index.ts` | Upgrade prompts and examples for Master Action Table linking to Work Instructions. | Modify |
| `src/specialists/packages/work-instructions/index.ts` | **New** specialist package for per-action Work Instructions. | Create |
| `src/specialists/registry.ts` | Register `work-instructions` specialist. | Modify |
| `tests/work-instructions.test.ts` | **New** unit tests for `work-instructions` specialist. | Create |
| `src/specialists/packages/testplans/index.ts` | Mandate Gating Prerequisites block at top of each test plan. | Modify |
| `src/core/classifier.ts` | Add `work-instructions` classification definition. | Modify |
| `AGENTS.md` | Update canonical workflow chain from 12 to 13 phases. | Modify |

---

## Tasks

### Task 1: 13-Phase Workflow & Workspace Scaffolding

**Files:**
- Modify: `src/workspace/state.ts`
- Modify: `tests/workspace.test.ts`

- [x] **Step 1: Write failing tests in `tests/workspace.test.ts`**

Update the phase count test and add scaffolding check:
```typescript
  it('initializes workflow with 13 phases and activePhase set to conops', () => {
    const projPath = path.join(tempBaseDir, 'wf-13-project');
    fs.mkdirSync(projPath, { recursive: true });
    const stateMgr = new ProjectStateManager(projPath);
    const state = stateMgr.getOrCreateState('p1', 'Tractor EV');
    expect(state.workflow).toBeDefined();
    expect(state.workflow.activePhase).toBe('conops');
    expect(Object.keys(state.workflow.phases)).toEqual(
      expect.arrayContaining(['conops', 'architecture', 'icd', 'capabilities', 'requirements', 'bom', 'rtm', 'milestones', 'risk-register', 'build-sequence', 'work-instructions', 'testplans', 'sow'])
    );
    expect(Object.keys(state.workflow.phases).length).toBe(13);
  });

  it('scaffolds docs/work_instructions and artifacts directories', () => {
    const projPath = path.join(tempBaseDir, 'scaffold-dirs-project');
    fs.mkdirSync(projPath, { recursive: true });
    const stateMgr = new ProjectStateManager(projPath);
    stateMgr.getOrCreateState('p1', 'Tractor EV');

    expect(fs.existsSync(path.join(projPath, 'docs', 'work_instructions'))).toBe(true);
    expect(fs.existsSync(path.join(projPath, 'artifacts'))).toBe(true);
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workspace.test.ts -t "13 phases"`  
Expected: FAIL.

- [x] **Step 3: Update `src/workspace/state.ts`**

1. In `ORDERED_WORKFLOW_PHASES`:
```typescript
  { id: 'build-sequence', name: 'Build Sequence & Assembly Planning', artifactPath: 'docs/build_sequences/BUILD_SEQUENCE_{GATE}.md' },
  { id: 'work-instructions', name: 'Work Instructions & Shop Floor Procedures', artifactPath: 'docs/work_instructions/ACTION-{NUM}-{SLUG}-WORK-INSTRUCTION.md' },
  { id: 'testplans', name: 'Test Plans & Procedures', artifactPath: 'docs/TEST_PLANS.md' },
```
2. In `scaffoldProjectDirectories()`:
```typescript
    const workInstDir = path.join(this.projectPath, 'docs', 'work_instructions');
    const artifactsDir = path.join(this.projectPath, 'artifacts');
    if (!fs.existsSync(workInstDir)) fs.mkdirSync(workInstDir, { recursive: true });
    if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
```
3. Update `resolveArtifactPaths` to support `{NUM}` or `work_instructions`:
```typescript
  if (artifactPath.includes('work_instructions')) {
    const dir = path.join(projectPath, 'docs', 'work_instructions');
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f));
    } catch {
      return [];
    }
  }
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workspace.test.ts`  
Expected: PASS (all 9 tests).

- [x] **Step 5: Commit Task 1**

```bash
git add src/workspace/state.ts tests/workspace.test.ts
git commit -m "feat(workspace): add work-instructions to 13-phase workflow and scaffold artifacts dir"
```

---

### Task 2: Two-Tier BOM & Cost Rollup Upgrade

**Files:**
- Modify: `src/specialists/packages/bom/index.ts`
- Modify: `tests/specialists.test.ts`

- [x] **Step 1: Write/update tests in `tests/specialists.test.ts`**

Assert that BOM secret sauce and rubric enforce `Qty`, procurement tracking columns, cost rollups, and trade study separation:
```typescript
  it('enforces Two-Tier BOM structure with Qty, order tracking, and cost rollups', () => {
    const bom = specialistRegistry.get('bom');
    expect(bom).toBeDefined();
    expect(bom?.systemPrompt).toContain('Qty');
    expect(bom?.systemPrompt).toContain('Financial & Procurement Rollup');
    expect(bom?.systemPrompt).toContain('TRADE_STUDY.md');
    expect(bom?.secretSauceExamples[0]).toContain('| Qty |');
    expect(bom?.secretSauceExamples[0]).toContain('Financial & Procurement Rollup');
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/specialists.test.ts -t "Two-Tier BOM"`  
Expected: FAIL.

- [x] **Step 3: Update `src/specialists/packages/bom/index.ts`**

Update `bomSecretSauce`, `systemPrompt`, and `criticRubric`:
- Add `Qty`, `Source / URL`, `Order & Tracking #`, `Status`, `Est. Unit`, `Est. Total`, `Actual Total`, `Variance` to `docs/BOM.md`.
- Add `## Financial & Procurement Rollup` section.
- Instruct creating `docs/TRADE_STUDY.md` for candidate options and trade-offs.
- Update `criticRubric` to require `Qty`, financial rollup, and procurement tracking fields.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/specialists.test.ts`  
Expected: PASS.

- [x] **Step 5: Commit Task 2**

```bash
git add src/specialists/packages/bom/index.ts tests/specialists.test.ts
git commit -m "feat(bom): upgrade to Two-Tier BOM with quantity, procurement tracking, and cost rollups"
```

---

### Task 3: Build Sequence Master Action Table Upgrade

**Files:**
- Modify: `src/specialists/packages/build-sequence/index.ts`
- Modify: `tests/build-sequence.test.ts`

- [x] **Step 1: Write/update test in `tests/build-sequence.test.ts`**

Assert that `build-sequence` prompt and secret sauce enforce the Master Action Table linking to Work Instructions in `docs/work_instructions/`.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build-sequence.test.ts`  
Expected: FAIL.

- [x] **Step 3: Implement in `src/specialists/packages/build-sequence/index.ts`**

- Update `buildSequenceSecretSauce` to include the `## Master Action Table` with columns: `Action #`, `Action Description`, `Target Subsystem`, `Prerequisite Actions`, `Work Instruction Document`, `Status`, `Non-Conformance`.
- Update `systemPrompt` and `criticRubric` to mandate the Master Action Table and hyperlinks to `docs/work_instructions/ACTION-<NUM>-<SLUG>-WORK-INSTRUCTION.md`.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/build-sequence.test.ts`  
Expected: PASS.

- [x] **Step 5: Commit Task 3**

```bash
git add src/specialists/packages/build-sequence/index.ts tests/build-sequence.test.ts
git commit -m "feat(build-sequence): mandate Master Action Table linking to Work Instructions"
```

---

### Task 4: Dedicated Work Instructions Specialist (`work-instructions`)

**Files:**
- Create: `src/specialists/packages/work-instructions/index.ts`
- Modify: `src/specialists/registry.ts`
- Create: `tests/work-instructions.test.ts`

- [x] **Step 1: Write failing unit tests in `tests/work-instructions.test.ts`**

Verify package metadata, prompt, allowed tools, and secret sauce:
```typescript
import { describe, it, expect } from 'vitest';
import { workInstructionsPackage } from '../src/specialists/packages/work-instructions/index.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Work Instructions Specialist', () => {
  it('is registered with correct metadata and prerequisites', () => {
    const registry = new SpecialistRegistry();
    const pkg = registry.get('work-instructions');
    expect(pkg).toBeDefined();
    expect(pkg?.id).toBe('work-instructions');
    expect(pkg?.prerequisiteArtifactId).toBe('BUILD_SEQUENCE');
    expect(pkg?.requiresCritic).toBe(true);
    expect(pkg?.allowedTools).toContain('fs_write');
    expect(pkg?.allowedTools).toContain('fs_edit');
  });

  it('contains secret sauce with prerequisites, checklists, evidence, and non-conformance log', () => {
    const sauce = workInstructionsPackage.secretSauceExamples[0];
    expect(sauce).toContain('Prerequisites & Required Resources');
    expect(sauce).toContain('Step-by-Step Action Checklist');
    expect(sauce).toContain('Verification & Evidence Artifacts');
    expect(sauce).toContain('Hardware Non-Conformance / Bug Log');
    expect(sauce).toContain('artifacts/');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/work-instructions.test.ts`  
Expected: FAIL.

- [x] **Step 3: Implement `src/specialists/packages/work-instructions/index.ts` and register it**

- Define `workInstructionsSecretSauce` with:
  - Header with Milestone Gate, Target Subsystem, Status (`READY | IN-PROGRESS | COMPLETED | BLOCKED`).
  - Section 1: Prerequisites & Required Resources (Prereq Actions, BOM Parts with Quantities, Tools with exact sizes/torque, PPE).
  - Section 2: Step-by-Step Action Checklist with inline gated test plan executions.
  - Section 3: Verification & Evidence Artifacts (`artifacts/` flat naming).
  - Section 4: Hardware Non-Conformance / Bug Log with Flag Status (`NONE | OPEN_NON_CONFORMANCE | RESOLVED`).
- Define `workInstructionsPackage` with `id: 'work-instructions'`, `prerequisiteArtifactId: 'BUILD_SEQUENCE'`.
- Register in `src/specialists/registry.ts`.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/work-instructions.test.ts`  
Expected: PASS.

- [x] **Step 5: Commit Task 4**

```bash
git add src/specialists/packages/work-instructions/index.ts src/specialists/registry.ts tests/work-instructions.test.ts
git commit -m "feat(specialists): implement dedicated Work Instructions specialist"
```

---

### Task 5: Bidirectional Action Gating in Test Plans & Classifier Integration

**Files:**
- Modify: `src/specialists/packages/testplans/index.ts`
- Modify: `src/core/classifier.ts`
- Modify: `AGENTS.md`
- Test: `tests/testplans-update.test.ts`

- [x] **Step 1: Write/update test in `tests/testplans-update.test.ts`**

Assert that Test Plans prompt and secret sauce mandate the `### Gating Prerequisites (MANDATORY BEFORE EXECUTION)` section listing prerequisite actions/work instructions.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/testplans-update.test.ts`  
Expected: FAIL.

- [x] **Step 3: Implement gating in `src/specialists/packages/testplans/index.ts`**

- Update `testplansSecretSauce`, `systemPrompt`, and `criticRubric` to mandate:
  `### Gating Prerequisites (MANDATORY BEFORE EXECUTION)` with required upstream actions (e.g. Action 01, Action 03, Action 05) and work instruction sign-offs.

- [x] **Step 4: Update `src/core/classifier.ts` and `AGENTS.md`**

- In `src/core/classifier.ts`, add `"work-instructions"` description to the classifier routing prompt.
- In `AGENTS.md`, update workflow chain to document the 13 canonical phases.

- [x] **Step 5: Run full test suite & type-check**

Run: `npm test` (`tsc --noEmit && vitest run`)  
Expected: All tests pass, zero type errors.

- [x] **Step 6: Commit Task 5**

```bash
git add src/specialists/packages/testplans/index.ts src/core/classifier.ts AGENTS.md tests/testplans-update.test.ts
git commit -m "feat(testplans): enforce bidirectional prerequisite action gating and update classifier"
```

---

### Task 6: Full Pipeline Verification & Push

- [x] **Step 1: Run `npm test`**
- [x] **Step 2: Run `npx tsc`**
- [x] **Step 3: Push commits to `origin/master`**
