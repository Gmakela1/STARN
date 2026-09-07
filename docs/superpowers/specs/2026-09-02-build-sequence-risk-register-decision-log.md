# Design Spec: Build Sequence, Risk Register & Decision Log

## Overview

Add three new capabilities to STARN's preparation pipeline: a **Build Sequence** phase (step-by-step assembly procedures per milestone gate), a **Risk Register** phase (structured risk identification and management), and a **Decision Log** (cross-cutting design decision record). These sit between Milestones and Test Plans in the existing 10-phase workflow.

## Motivation

- **Build Sequence:** Milestones define *what* to achieve (gates with acceptance criteria). There is no document that sequences *how* to get there — the step-by-step assembly procedure referencing Architecture, ICD, BOM, and Risk Register. Without it, the builder has to mentally reconstruct the build order from scattered documents.
- **Risk Register:** Hardware projects have physical, supply-chain, and schedule risks that are expensive if missed. No formal risk tracking exists (only `openRisks` strings in state.json). A structured register with if/then conditions, source traceability, and phase impact is needed.
- **Decision Log:** Design decisions are made across every phase but never recorded centrally. Six months later, "why did we pick 72V?" is lost. A lightweight append-only log captures rationale.

## Design Decisions

### Build Sequence is a New Phase (not embedded in Milestones)

- Each milestone gate (MVC, IOC, FOC) gets its own standalone document: `docs/build_sequences/BUILD_SEQUENCE_MVC.md`
- Created one at a time, sequentially. Each subsequent phase reads the prior build sequence and builds on it.
- **Prerequisite:** Milestones + Risk Register must be approved before Build Sequence can run.
- **Allowed tools:** `fs_read`, `fs_write`, `fs_list`, `state_read`, `example_reader`

### Build Sequence ↔ Test Plan Integration

The Build Sequence and Test Plan for each milestone gate are tightly coupled through a stop-and-verify pattern:

1. **Build Sequence marks stopping points:** Each step that requires verification carries a `→ VERIFY: TP-XXX` marker that references a specific test procedure in the Test Plan.
2. **Test Plan provides the detailed procedure:** Each test procedure carries a backward link (`Build Sequence Reference: Build Sequence MVC, Step 5`) so there is linkage and traceability from the test plan back to the exact stopping point in the build sequence.
3. **The linkage is one-way:** The Build Sequence stays a compact linear instruction manual (a signpost: "stop here, go test"). The Test Plan is the detailed reference with procedure, expected values, and data entry fields. We do NOT back-annotate the full test procedure into the Build Sequence — that would create two copies of the same information, a maintenance liability.
4. **Test Plans include system-level tests not tied to any specific build step** (e.g., 1-hour continuous runtime, full thermal endurance). These have no Build Sequence Reference.

### Test Plan Data Entry Format (Tabular)

The Test Plan specialist produces **tabulated data entry sheets**, not just line-item procedures. Each step-specific test gets a data table where the builder records actual measurements against expected values with pass/fail checkboxes:

```
### TP-MVP-01: Mechanical Concentricity & Mounting Torque Verification
- **Build Sequence Reference:** Build Sequence MVC, Step 5
- **Required Tools:** Dial indicator, torque wrench
- **Procedure:** (numbered steps)

| Parameter | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Total indicated runout (mm) | ≤ 0.050 | ___ | ☐ / ☐ |
| Bolt 1 torque (ft-lbs) | 45 | ___ | ☐ / ☐ |
| Bolt 2 torque (ft-lbs) | 45 | ___ | ☐ / ☐ |
| Bolt 3 torque (ft-lbs) | 45 | ___ | ☐ / ☐ |
| Bolt 4 torque (ft-lbs) | 45 | ___ | ☐ / ☐ |

**Overall Result:** ☐ Pass / ☐ Fail
**Notes:** _________________________________
```

System-level tests (not tied to a build step) use the same table format but omit the Build Sequence Reference:

```
### TP-MVP-07: System-Level — 1-Hour Continuous Runtime
- **Not tied to a specific build step — run after all MVC steps complete**
- **Procedure:** (numbered steps)

| Time (min) | Pack Voltage (V) | Motor Temp (°C) | Controller Temp (°C) |
|---|---|---|---|
| 0 | ___ | ___ | ___ |
| 15 | ___ | ___ | ___ |
| 30 | ___ | ___ | ___ |
| 45 | ___ | ___ | ___ |
| 60 | ___ | ___ | ___ |

**Result:** ☐ Pass (≥60 min runtime) / ☐ Fail
```

- Every test procedure includes at least one data table (expected vs actual, pass/fail).
- Tests can have multiple data tables (one per measurement point).
- The builder fills in actual values during the build as they hit each `→ VERIFY` marker.
- The Test Plan specialist reads the Build Sequence to learn where tests slot in, then author procedures + data tables referencing those steps.

### Risk Register is a New Phase (not cross-cutting)

- Full phase that blocks downstream workflow (must be approved before Build Sequence).
- Auto-generates an initial table from upstream docs + pending risk flags, then runs a verification interview with the user and asks for user-contributed risks.
- **Prerequisite:** Milestones must be approved.
- **Allowed tools:** `fs_read`, `fs_write`, `fs_list`, `state_read`, `example_reader`

### Decision Log is a Lightweight Convention (not a new phase)

- No new specialist. Each existing specialist's system prompt is augmented to append decisions to `docs/DECISIONS.md` via `fs_write` when significant choices are made.
- Structure: ID, date, phase, decision, alternatives considered, rationale, source reference, status.
- The critic does not evaluate the decision log. It is purely informational.
- The Build Sequence specialist reads it to understand reasoning behind design choices.

## Workflow

### Updated Phase Order

```
CONOPS → Architecture → ICD → Capabilities → Requirements → BOM → RTM → Milestones → Risk Register → Build Sequence (MVC) → Build Sequence (IOC) → Build Sequence (FOC) → Test Plans → SOW
```

### Cross-Cutting Artifacts

- `docs/DECISIONS.md` — appended to by all specialists
- `docs/RISK_REGISTER.md` — generated by Risk Register specialist
- `docs/build_sequences/BUILD_SEQUENCE_MVC.md` (and IOC, FOC) — generated by Build Sequence specialist

### Risk Flagging Mechanism

A `pendingRisks` array in `state.json` allows any specialist to flag a risk observation before the Risk Register phase runs:

```json
{
  "pendingRisks": [
    {
      "source": "architecture",
      "section": "SS-01: Traction Motor & Coupling",
      "risk": "IF motor shaft pilot diameter doesn't match transmission THEN adapter plate fabrication adds 2+ weeks"
    }
  ]
}
```

- Pre-Milestones specialists do NOT include `phaseImpacted` — only the Risk Register specialist enriches that during the interview.
- On Risk Register approval, `pendingRisks` is cleared.

## Detailed Specialists

### Build Sequence Specialist

**ID:** `build-sequence`
**Name:** Build Sequence & Assembly Planning
**Prerequisite:** `milestones`, `risk-register`
**Output:** `docs/build_sequences/BUILD_SEQUENCE_{GATE}.md` (one per milestone gate)

**Document structure:**

```
# Build Sequence: [Gate Name] — [Project Name]

## Pre-Build Checklist
- [From BOM] Parts received and verified
- [From Risk Register] Critical mitigations in place

## Step-by-Step Procedure

### Step 1: [Action]
- [From Architecture SS-XX] Reference to subsystem
- [From ICD ICD-M-XX] Reference to interface
- [From BOM] Reference to part
- [From Risk Register R-XX] Risk mitigation
- *Test Point: [Placeholder for Test Plans]*

### Step 2: [Action]
...
```

**Behavior:**
- Reads all upstream docs (Architecture, ICD, BOM, Milestones, Risk Register, Decision Log)
- References prior build sequences if they exist (for IOC building on MVC)
- **Gate selection:** The user specifies which gate to build (e.g., "build the MVC sequence"). The specialist reads the Milestones doc for that gate's criteria and produces only that gate's document. Three separate runs produce three separate documents.
- Each step traces to source documents
- **Stopping points:** Steps requiring verification carry a `→ VERIFY: TP-XXX (Test Name)` marker referencing the Test Plan. This is a compact signpost — the detailed procedure lives in the Test Plan, not here.
- Test points are marked inline as placeholders for Test Plans to fill
- Writes to disk via `fs_write`

### Test Plan Specialist (Updated Behavior)

The existing Test Plan specialist (`src/specialists/packages/testplans/index.ts`) is updated to integrate with the Build Sequence.

**New behavior:**
1. **Reads the Build Sequence:** Before authoring test procedures, the specialist reads `docs/build_sequences/BUILD_SEQUENCE_{GATE}.md` to find all `→ VERIFY: TP-XXX` markers.
2. **Produces tabular data entry sheets:** Each test procedure includes a data table with Expected, Actual, and Pass/Fail columns for the builder to fill in.
3. **Backward linkage:** Each step-specific test carries a `Build Sequence Reference` field (e.g., "Build Sequence MVC, Step 5") so anyone reading the test plan knows exactly where in the build it fits.
4. **System-level tests:** Tests not tied to a specific build step are labeled "Not tied to a specific build step — run after all [GATE] steps complete" and carry no Build Sequence Reference.

The output format is documented in the **Test Plan Data Entry Format (Tabular)** section above.

### Risk Register Specialist

**ID:** `risk-register`
**Name:** Risk Register
**Prerequisite:** `milestones`
**Output:** `docs/RISK_REGISTER.md`

**Document structure:**

```
# Risk Register: [Project Name]

| ID | Risk (If/Then) | Source | Phase Impacted | Impact Description | Mitigation | Status |

## Auto-Generated (from project documents + pending flags)

## User-Contributed (from interview)
```

**Columns:**
1. **ID** — R-01, R-02, etc.
2. **Risk (If/Then)** — "IF [trigger] THEN [consequence]"
3. **Source** — Which document/section this risk derives from (e.g., "Architecture §SS-01")
4. **Phase Impacted** — Which milestone phase(s) this affects (MVC, IOC, FOC, or blank)
5. **Impact Description** — Descriptive text, not just a severity label
6. **Mitigation** — What is being done to address it
7. **Status** — Open, Mitigating, Resolved, Accepted

**Execution flow:**
1. Read all upstream docs + `pendingRisks` from state
2. Auto-generate initial risk table
3. Interview: verify each risk with user, adjust impact/mitigation, dismiss if not real
4. Ask user: "Any risks from your experience that I wouldn't have found in the docs?"
5. Write final document
6. Critic evaluates for grounding in real documents
7. On approval: clear `pendingRisks` from state

### Decision Log Convention

**File:** `docs/DECISIONS.md`

**Entry format:**

```
## D-XXX: [Title]
- **Date:** YYYY-MM-DD
- **Phase:** [Phase ID]
- **Decision:** [What was chosen]
- **Alternatives Considered:** [What was rejected and why]
- **Rationale:** [Why this choice was made]
- **Source:** [Document/section reference]
- **Status:** ✅ Final / 🔄 Pending / ❌ Superseded
```

**Generation mechanism (consolidation at approval, not per-specialist):**

Specialists are **not** modified to write to the decision log. Instead, a small fixed process runs at the human checkpoint whenever a specialist document is approved:

1. **After approval:** The checkpoint code reads the approved document from disk.
2. **Extract:** It scans for a predefined marker (e.g., `## Design Decisions` or `### Design Decisions`) and extracts all entries under that section.
3. **Append:** It appends the extracted entries to `docs/DECISIONS.md` with a standardized format.
4. **Idempotent:** The process checks for duplicate entry IDs before appending to avoid duplicates on re-approval or revision.

**Requirements on specialists:**
- Each specialist that makes design decisions MUST include a `## Design Decisions` (or `### Design Decisions`) section in its output document.
- This is already present in the Architecture specialist's secret sauce example. The other specialists' existing output formats already include decision-like content (BOM candidate tables, ICD interface selections, etc.).
- The specialist's system prompt is augmented with **one line** (not a paragraph): *"Include a `## Design Decisions` section listing any significant choices made, alternatives considered, and rationale."*
- This is a structural requirement of the output format, not a separate decision-about-whether-to-log — it removes the meta-judgment the LLM had to make.

**Benefits over per-specialist appends:**
- ✅ Zero extra tool calls during specialist execution (no read-modify-write dance)
- ✅ One centralized writer = consistent format, no drift
- ✅ No token spend on meta-judgment ("was this decision significant enough?")
- ✅ Decisions are harvested from the *approved* version of the document, not the draft
- ✅ No risk of the LLM writing to DECISIONS.md but forgetting to write the main document

## Data Model Changes

### `state.json` additions

```json
{
  "pendingRisks": [
    {
      "source": "architecture",
      "section": "SS-01: Traction Motor & Coupling",
      "risk": "IF motor shaft pilot diameter doesn't match transmission THEN adapter plate fabrication adds 2+ weeks"
    }
  ]
}
```

### `ORDERED_WORKFLOW_PHASES` additions

```typescript
{ id: 'risk-register', name: 'Risk Register', artifactPath: 'docs/RISK_REGISTER.md' },
{ id: 'build-sequence', name: 'Build Sequence & Assembly Planning', artifactPath: 'docs/build_sequences/BUILD_SEQUENCE_{GATE}.md' },
```

### `state_update` tool

The `state_update` tool already exists and can write arbitrary fields. No new tool needed.

## Testing Strategy

### Unit Tests
1. Build Sequence specialist registers correctly in registry
2. Risk Register specialist registers correctly in registry
3. `ORDERED_WORKFLOW_PHASES` contains both new phases in correct order
4. Phase prerequisite gate blocks correctly (Milestones → Risk Register → Build Sequence)
5. `pendingRisks` accumulates flags from multiple specialists
6. `pendingRisks` clears on approval
7. Decision log harvest: extracts `## Design Decisions` section from a document and appends to DECISIONS.md
8. Decision log harvest: idempotent — does not duplicate entries on re-approval
9. Test Plan output includes tabular data entry format (Expected vs Actual vs Pass/Fail)
10. Test Plan includes Build Sequence Reference on step-specific tests
11. Test Plan omits Build Sequence Reference on system-level tests

### Integration Tests
1. Existing 63 tests still pass
2. Phase ordering tests pass with 12 phases

### Manual Testing
1. User runs STARN, advances through Milestones, triggers Risk Register
2. User verifies auto-generated risks, adds user-contributed risks
3. User approves Risk Register, advances to Build Sequence (MVC)
4. User verifies build sequence references upstream docs correctly and includes `→ VERIFY: TP-XXX` markers at stopping points
5. User approves MVC Build Sequence, advances to Build Sequence (IOC)
6. User verifies IOC builds on MVC
7. User approves a document (e.g., Architecture) and verifies that `docs/DECISIONS.md` was auto-populated with the Design Decisions section from that document
8. User approves a revision of the same document and verifies no duplicate entries in DECISIONS.md
8. User advances to Test Plans (MVC). User verifies:
   - Test procedures reference Build Sequence steps via `Build Sequence Reference` field
   - Each test includes a tabular data entry sheet (Expected | Actual | Pass/Fail)
   - System-level tests exist without Build Sequence Reference
   - User can print the test plan, fill in actual values, and check pass/fail

## File Changes

### New Files
- `src/specialists/packages/build-sequence/index.ts` — Build Sequence specialist
- `src/specialists/packages/risk-register/index.ts` — Risk Register specialist
- `tests/build-sequence.test.ts` — Build Sequence unit tests
- `tests/risk-register.test.ts` — Risk Register unit tests

### Modified Files
- `src/specialists/registry.ts` — register two new specialists
- `src/workspace/state.ts` — add to `ORDERED_WORKFLOW_PHASES`
- `src/workspace/types.ts` — add `pendingRisks` to `ProjectState` type
- `src/specialists/packages/testplans/index.ts` — update to read Build Sequence, produce tabular data entry tables, add Build Sequence Reference linkage
- `src/cli/checkpoint.ts` — add decision log harvest step: after accept/override, scan approved document for `## Design Decisions` section, extract entries, append to `docs/DECISIONS.md`
- `src/specialists/packages/architecture/index.ts` — add one line to output format: "Include a `## Design Decisions` section" (already present in examples, just formalize)
- `src/specialists/packages/icd/index.ts` — add one line to output format: "Include a `## Design Decisions` section"
- `src/specialists/packages/bom/index.ts` — add one line to output format: "Include a `## Design Decisions` section" (already has candidate selection tables)
- `src/specialists/packages/requirements/index.ts` — add one line to output format: "Include a `## Design Decisions` section"
- `src/specialists/packages/capabilities/index.ts` — add one line to output format: "Include a `## Design Decisions` section"
- `src/specialists/packages/conops/index.ts` — add one line to output format: "Include a `## Design Decisions` section"
- `src/specialists/packages/milestones/index.ts` — add one line to output format: "Include a `## Design Decisions` section"
- `tests/specialists.test.ts` — update specialist count assertions
- `tests/workspace.test.ts` — update phase ordering assertions

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Build Sequence specialist hallucinates assembly steps not grounded in upstream docs | Critic validates against source documents; if a step can't be traced to a source, it's flagged |
| Risk Register specialist invents risks not grounded in real documents | Same critic validation; risk source column must reference a real document section |
| Decision Log harvest misses entries if specialist didn't include a Design Decisions section | One-line structural prompt addition forces the section into every specialist's output format; checkpoint code validates the section exists before attempting harvest |
| Decision Log accumulates duplicates on re-approval | Harvest code checks for duplicate entry IDs (D-XXX) before appending |
| User adds 20+ risks manually, making the interview tedious | Interview is bounded — auto-generated risks are verified first, then one open-ended question for user-contributed risks |