# Document Viewer & Manual Status Slash Commands — Specification

**Date:** 2026-10-03  
**Status:** Approved  
**Scope:** CLI presentation layer (`src/cli/doc-viewer.ts`, `src/index.ts`, `src/cli/ui.ts`), Workspace State (`src/workspace/state.ts`), and test suite  

---

## 1. Problem Statement

1. **No Read-Only Document Inspection:** Users currently cannot view historical or approved deliverables in the terminal without triggering an AI turn or reverting an approved document to draft via `/goto`. When an artifact is approved, reviewing it requires either inspecting raw markdown outside the CLI or risking unwanted edits/agent runs.
2. **Missing Manual State Gating:** Users occasionally review, edit, or approve documents manually (or want to bypass full agent drafting if an external artifact is provided). Currently, the only path to `approved` status is passing the harsh critic loop in `runAgentToolLoop`. Similarly, reverting an approved document to draft requires navigating through `/goto` interactive prompts rather than a direct command.

---

## 2. Goals & Non-Goals

### Goals
- **Interactive Read-Only Viewer (`/view`):**
  - Allows inspecting any deliverable (e.g. `/view conops`, `/view 2`, or `/view` with an interactive selector).
  - 100% token-free: does not invoke OpenRouter, the agent loop, or the Critic.
  - Rich inspection UI:
    - Document header & metadata (phase, file path, approval status, critic score).
    - Table of Contents (`[t]`).
    - Browse by Section (`[s]`).
    - Full Document Paged View (`[p]`).
    - Back / Exit (`[b]`).
- **Direct Manual Approval (`/approve`):**
  - Allows marking an existing document as `approved` directly (e.g. `/approve architecture` or `/approve 2`).
  - Verifies the document exists on disk.
  - Computes and stores the SHA-256 `approvedContentHash`.
  - Advances workflow phase and prints updated roadmap.
- **Direct Revert to Draft (`/draft` or `/revert`):**
  - Allows reverting an approved document to `draft` directly (e.g. `/draft conops`).
  - Automatically re-locks downstream workflow phases (transitive) and prints impact warning.
- **Strict Decoupling:**
  - Interactive UI logic remains strictly in `src/cli/*`.
  - State management methods in `src/workspace/state.ts` remain pure and free of terminal libraries (`chalk`, `@inquirer/prompts`).

### Non-Goals
- Editing documents inside `/view`: `/view` is strictly read-only.
- Replacing the Critic on AI-generated turns: Turns executed by specialists still require Critic review.

---

## 3. Architecture & Interface Design

### 3.1 Workspace State Additions (`src/workspace/state.ts`)

Add method to `ProjectStateManager`:
```typescript
public manualApproveArtifact(artifactId: string): { success: boolean; error?: string; artifact?: ArtifactRecord } {
  const normalizedId = artifactId.toUpperCase();
  const phaseDef = ORDERED_WORKFLOW_PHASES.find(p => p.id.toUpperCase() === normalizedId);
  const title = phaseDef?.name || `${normalizedId} Document`;
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

  return { success: true, artifact: this.getState().artifacts.find(a => a.id === normalizedId) };
}
```

### 3.2 Document Viewer Component (`src/cli/doc-viewer.ts`)

Export a dedicated interactive viewer:
```typescript
export async function runDocumentViewer(options: {
  projectPath: string;
  stateManager: ProjectStateManager;
  targetArg?: string;
}): Promise<void>;
```
1. **Target Resolution:**
   - If `targetArg` is provided: resolves phase using `resolvePhaseRef(targetArg)`.
   - If `targetArg` is missing: prompts user with `@inquirer/prompts` `select` listing all available deliverables in the workflow, indicating which exist on disk and their status (`APPROVED`, `DRAFT`, `MISSING`).
2. **File Check:**
   - If file does not exist, prints helpful guidance and returns.
3. **Interactive Menu Loop:**
   - Displays header box: Title, status, critic score, word count, path.
   - Menu choices:
     - `▶ Browse by Section`: Select a heading (from `extractSections`) and display it.
     - `📖 View Full Document (Paged)`: Paginate 30 lines at a time.
     - `📑 View Table of Contents (TOC)`: Display `formatDocumentToc`.
     - `↩ Exit Viewer`: Returns to the main CLI prompt.

### 3.3 Command Handling in `src/index.ts`

Intercept the commands before the agent loop:
- **`/view [target]`**: Invokes `runDocumentViewer(...)`. Continues main CLI prompt loop.
- **`/approve [target]`**: 
  - Resolves target.
  - Calls `stateManager.manualApproveArtifact(targetId)`.
  - Advances phase if applicable: `stateManager.advanceToNextPhase()`.
  - Prints success badge and `formatWorkflowRoadmap`.
- **`/draft [target]` / `/revert [target]`**:
  - Resolves target.
  - Calls `stateManager.revertArtifactToDraft(targetId)`.
  - Prints warning and `formatWorkflowRoadmap`.

### 3.4 Help Screen (`src/cli/ui.ts`)

Update `formatHelp()` to include the new commands:
```text
  /view [doc]      Inspect an approved or drafted deliverable (read-only viewer)
  /approve [doc]   Manually approve an existing document and unlock next phase
  /draft [doc]     Revert an approved document to draft and re-lock downstream phases
```

---

## 4. Verification & Testing

1. **State Unit Tests (`tests/workspace.test.ts`):**
   - Test `manualApproveArtifact`:
     - Returns error if file does not exist.
     - Successfully records artifact as approved with SHA-256 hash when file exists.
     - Synchronizes workflow phase status to `approved`.
2. **Doc Viewer & CLI Command Tests (`tests/doc-viewer.test.ts`):**
   - Unit tests for phase resolution and viewer helpers.
   - Test that `/view`, `/approve`, `/draft` quick commands are parsed correctly.
3. **Full Suite Regression:**
   - `npm test` (`tsc --noEmit && vitest run`) clean.
