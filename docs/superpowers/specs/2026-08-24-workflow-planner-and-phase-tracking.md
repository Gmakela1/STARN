# STARN Workflow Planner & Phase Management Specification

**Date:** 2026-08-24  
**Status:** Validated Design  
**Context:** Prevents cross-document misrouting by introducing a stage-bound project roadmap with explicit user phase override and confirmation.

---

## 1. Objectives & Overview

To ensure total engineering discipline and prevent the agent from updating the wrong document when user prompts contain cross-domain keywords, STARN introduces the **Project Workflow Planner**:

1. **Structured 7-Phase Engineering Lifecycle:**
   - `[1] CONOPS / User Intent` (`docs/CONOPS.md`)
   - `[2] Product Capabilities` (`docs/CAPABILITIES.md`)
   - `[3] System Requirements` (`docs/REQUIREMENTS.md`)
   - `[4] Traceability Matrix (RTM)` (`docs/RTM.md`)
   - `[5] Project Milestones` (`docs/MILESTONES.md`)
   - `[6] Work Breakdown Structure (WBS)` (`docs/WBS.md`)
   - `[7] Statement of Work (SOW)` (`docs/SOW.md`)

2. **Active Phase Anchoring:**
   - The project's active phase is stored in `state.json` (`workflow.activePhase`).
   - When a user is working on a deliverable (e.g. `CONOPS`), all iterative prompts and feedback are directed strictly to that specialist and its target document until the user approves the deliverable or explicitly switches phases.

3. **User Phase Override with Confirmation:**
   - Users can jump to any phase at any time via natural language (e.g., *"I want to redo the CONOPS"*, *"Jump to WBS"*) or commands (`/goto <phase>`, `/plan`, `/next`).
   - When a phase jump is requested, STARN presents an interactive confirmation verifying that the user wants to switch the active target document.

4. **Terminal Roadmap Visualization:**
   - Renders a clean status banner showing approved deliverables, in-progress targets, and locked/pending phases.

---

## 2. Workflow State Schema (`state.json`)

```json
{
  "workflow": {
    "activePhase": "conops",
    "phases": {
      "conops": { "status": "approved", "artifactPath": "docs/CONOPS.md", "updatedAt": "2026-08-24T00:53:41Z" },
      "capabilities": { "status": "in_progress", "artifactPath": "docs/CAPABILITIES.md", "updatedAt": null },
      "requirements": { "status": "pending", "artifactPath": "docs/REQUIREMENTS.md", "updatedAt": null },
      "rtm": { "status": "locked", "artifactPath": "docs/RTM.md", "updatedAt": null },
      "milestones": { "status": "pending", "artifactPath": "docs/MILESTONES.md", "updatedAt": null },
      "wbs": { "status": "pending", "artifactPath": "docs/WBS.md", "updatedAt": null },
      "sow": { "status": "pending", "artifactPath": "docs/SOW.md", "updatedAt": null }
    }
  }
}
```

---

## 3. Workflow Roadmap UI (`/plan` / Status Banner)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        STARN PROJECT WORKFLOW ROADMAP                  │
│                                                                        │
│  [1] CONOPS / User Intent      ● APPROVED   (docs/CONOPS.md)           │
│  [2] Product Capabilities      ► IN PROGRESS (Active Target)           │
│  [3] System Requirements       ○ PENDING                               │
│  [4] Traceability Matrix (RTM) 🔒 LOCKED    (Requires Requirements)    │
│  [5] Project Milestones        ○ PENDING                               │
│  [6] Work Breakdown (WBS)      ○ PENDING                               │
│  [7] Statement of Work (SOW)   ○ PENDING                               │
│                                                                        │
│  Commands: /plan (show roadmap), /goto <phase> (switch target phase)  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Phase Transition & Override Logic

1. **Automatic Progression on Checkpoint Approval:**
   - When the user approves a deliverable at a checkpoint (e.g. `CONOPS`), the workflow manager marks `conops` as `approved` and proposes advancing to the next logical phase (`capabilities`).
2. **Explicit Phase Override:**
   - If the user enters `/goto conops` or says *"I want to redo the CONOPS"*:
   - The system intercepts the phase change request.
   - Shows confirmation: `? Switch active target to [CONOPS / User Intent] (docs/CONOPS.md)? (Y/n)`
   - On confirmation, updates `workflow.activePhase = 'conops'` and sets the target deliverable.

---

## 5. Context-Aware Classification
- `classifyRequest()` receives `currentActivePhase`.
- If the user's message is an edit or refinement while inside an active phase (e.g. currently in `conops` and user says *"Add 120V AC charging specs"*), the classifier stays locked on `conops` unless a phase override is explicitly declared.
