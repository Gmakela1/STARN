# Document Viewer & Manual Status Commands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/view`, `/approve`, and `/draft` slash commands enabling read-only deliverable inspection and direct manual state transitions in the CLI without triggering agentic LLM turns.

**Architecture:**
- `ProjectStateManager.manualApproveArtifact(artifactId)` in `src/workspace/state.ts` computes content hash, updates artifact status, and unlocks downstream phases.
- `src/cli/doc-viewer.ts` provides interactive section browsing, paged full-document reading, and TOC viewing.
- `src/index.ts` intercepts `/view`, `/approve`, `/draft` commands before the agent loop to keep operations 100% token-free and presentation-isolated.
- `src/cli/ui.ts` documents new commands in the `/help` table.

**Tech Stack:** TypeScript (strict), Vitest, `@inquirer/prompts`, `chalk`, `boxen`.

**Spec:** `docs/superpowers/specs/2026-10-03-doc-viewer-and-manual-status-design.md`

## Global Constraints

- Must pass `npm test` (`tsc --noEmit && vitest run`) without errors or warnings.
- `core/*` and `workspace/*` must remain strictly I/O-agnostic (no terminal libraries).
- Follow Test-Driven Development (TDD) for every step.

---

## File Structure

| File | Responsibility | Action |
| :--- | :--- | :--- |
| `src/workspace/state.ts` | Add `manualApproveArtifact(artifactId)` method. | Modify |
| `tests/workspace.test.ts` | Unit tests for `manualApproveArtifact`. | Modify |
| `src/cli/doc-viewer.ts` | Interactive CLI document viewer component. | Create |
| `tests/doc-viewer.test.ts` | Unit tests for document viewer target resolution and helpers. | Create |
| `src/index.ts` | Wire `/view`, `/approve`, `/draft` command interception. | Modify |
| `src/cli/ui.ts` | Update `/help` command listing. | Modify |

---

## Tasks

### Task 1: Add `manualApproveArtifact` to `ProjectStateManager`

**Files:**
- Modify: `src/workspace/state.ts`
- Test: `tests/workspace.test.ts`

- [x] **Step 1: Write failing unit test in `tests/workspace.test.ts`**

Add tests asserting:
1. `manualApproveArtifact` returns error if file does not exist.
2. `manualApproveArtifact` succeeds when file exists, computes SHA-256 hash, updates artifact to `approved`, and sets phase status to `approved`.

```typescript
describe('manualApproveArtifact', () => {
  it('fails if artifact file does not exist on disk', () => {
    const mgr = new ProjectStateManager(tempDir);
    mgr.getOrCreateState('p1', 'Test');
    const res = mgr.manualApproveArtifact('conops');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Document not found');
  });

  it('approves artifact and sets content hash when file exists', () => {
    const mgr = new ProjectStateManager(tempDir);
    mgr.getOrCreateState('p1', 'Test');
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'CONOPS.md'), '# CONOPS\nSystem definition');

    const res = mgr.manualApproveArtifact('conops');
    expect(res.success).toBe(true);
    expect(res.artifact?.status).toBe('approved');
    expect(res.artifact?.approvedContentHash).toBeDefined();

    const state = mgr.getState();
    expect(state.workflow?.phases.conops.status).toBe('approved');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workspace.test.ts -t "manualApproveArtifact"`  
Expected: FAIL (`mgr.manualApproveArtifact is not a function`).

- [x] **Step 3: Implement `manualApproveArtifact` in `src/workspace/state.ts`**

```typescript
  public manualApproveArtifact(artifactId: string): { success: boolean; error?: string; artifact?: ArtifactRecord } {
    const normalizedId = artifactId.toUpperCase();
    const phaseDef = ORDERED_WORKFLOW_PHASES.find(p => p.id.toUpperCase() === normalizedId);
    const title = phaseDef?.name || `${normalizedId} Deliverable`;
    const defaultPath = phaseDef ? phaseDef.artifactPath : `docs/${normalizedId}.md`;

    const diskPath = path.join(this.projectPath, defaultPath);
    if (!fs.existsSync(diskPath)) {
      return {
        success: false,
        error: `Document not found on disk at ${defaultPath}. Create or draft it first.`
      };
    }

    const content = fs.readFileSync(diskPath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    const state = this.getState();
    const existing = state.artifacts.find(a => a.id === normalizedId);
    const criticScore = existing?.criticScore ?? 9.0;

    this.recordArtifact({
      id: normalizedId,
      title,
      path: defaultPath,
      status: 'approved',
      criticScore,
      approvedContentHash: hash
    });

    return {
      success: true,
      artifact: this.getState().artifacts.find(a => a.id === normalizedId)
    };
  }
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workspace.test.ts -t "manualApproveArtifact"`  
Expected: PASS.

- [x] **Step 5: Run full workspace tests**

Run: `npx vitest run tests/workspace.test.ts`  
Expected: PASS.

- [x] **Step 6: Commit Task 1**

```bash
git add src/workspace/state.ts tests/workspace.test.ts
git commit -m "feat(state): add manualApproveArtifact to ProjectStateManager"
```

---

### Task 2: Create Interactive Document Viewer Component (`src/cli/doc-viewer.ts`)

**Files:**
- Create: `src/cli/doc-viewer.ts`
- Create: `tests/doc-viewer.test.ts`

- [x] **Step 1: Write unit tests in `tests/doc-viewer.test.ts`**

Test helper functions:
1. `resolveDocTarget(targetArg: string, phases: WorkflowPhaseDefinition[])` resolving by ID, number, or name.
2. Formatter for viewer header.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/doc-viewer.test.ts`  
Expected: FAIL.

- [x] **Step 3: Implement `src/cli/doc-viewer.ts`**

Export:
- `resolveDocTarget(targetArg, phases)`
- `runDocumentViewer(options)`:
  - Select document if not provided.
  - Verify file exists.
  - Display header, TOC, section browser, or paged view.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/doc-viewer.test.ts`  
Expected: PASS.

- [x] **Step 5: Commit Task 2**

```bash
git add src/cli/doc-viewer.ts tests/doc-viewer.test.ts
git commit -m "feat(cli): create interactive document viewer component"
```

---

### Task 3: Wire `/view`, `/approve`, `/draft` in `src/index.ts` & update `/help`

**Files:**
- Modify: `src/index.ts`
- Modify: `src/cli/ui.ts`

- [x] **Step 1: Update `/help` command listing in `src/cli/ui.ts`**

Add `/view`, `/approve`, `/draft` to the help table.

- [x] **Step 2: Wire commands in `src/index.ts`**

In the main command prompt loop before the turn:
1. Handle `/view [doc]` -> invoke `runDocumentViewer(...)`, then `continue`.
2. Handle `/approve [doc]` -> resolve phase, call `stateManager.manualApproveArtifact(...)`, advance phase, print confirmation & roadmap, then `continue`.
3. Handle `/draft [doc]` (or `/revert [doc]`) -> resolve phase, call `stateManager.revertArtifactToDraft(...)`, print confirmation & roadmap, then `continue`.

- [x] **Step 3: Run full test suite & type-check**

Run: `npm test`  
Expected: All tests PASS, `tsc --noEmit` clean.

- [x] **Step 4: Build distribution & commit**

```bash
git add src/index.ts src/cli/ui.ts
git commit -m "feat(cli): wire /view, /approve, and /draft slash commands"
```
