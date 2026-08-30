# System Architecture, ICD, BOM & Workflow Restructuring

> **Status:** Design Document  
> **Date:** 2026-08-30  
> **Implements:** Restructuring STARN's workflow to add System Architecture, ICD, BOM phases, drop WBS, and add cross-cutting Change Impact Analysis

## Motivation

The current 8-phase workflow (CONOPS → Capabilities → Requirements → RTM → Milestones → Test Plans → WBS → SOW) generates requirements and milestones from a generic CONOPS without explicit subsystem decomposition. For complex projects, this leads to:

- Requirements that are too generic because they aren't grounded in real subsystem boundaries
- No interface definitions between subsystems, making integration testing ambiguous
- A WBS that duplicates the work of decomposition without adding value
- No mechanism to track candidate parts, datasheets, or long-lead procurement items
- No way to cascade changes when upstream documents are revised

## New Workflow

```
CONOPS (with system-level capabilities section)
  ↓
System Architecture (subsystem decomposition, block diagram, dependency graph)
  ↓
ICD (interface definitions between subsystems)
  ↓
Capabilities (per-subsystem functional traits)
  ↓
Requirements (per-subsystem quantified thresholds)
  ↓
BOM (candidate parts, datasheet links, long-lead flags)
  ↕  ← feedback loop: no part fits → design decision back to Requirements/Capabilities
  ↓
RTM (traceability matrix per-subsystem)
  ↓
Milestones (MVC/IOC/FOC per-subsystem layering)
  ↓
Test Plans (subsystem integration tests per milestone)
  ↓
SOW (contractor statements of work, if needed)
```

**WBS is dropped.** System Architecture + ICD + BOM + Milestones already cover decomposition.

**Cross-cutting:** Change Impact Analysis specialist (operates on demand, not a linear phase).

## Phase Details

### Phase 1: CONOPS (Modified)
- **Deliverable:** `docs/CONOPS.md`
- **Change:** Add a system-level capabilities section (e.g., "The system provides electric traction, onboard charging, PTO-driven implements, operator dashboard, and emergency safety isolation")
- **Purpose:** Gives the Architecture specialist concrete system-level capabilities to decompose into subsystems
- **Otherwise unchanged:** 6-section structure, story-based intake, Section 6 open questions

### Phase 2: System Architecture (New)
- **Deliverable:** `docs/ARCHITECTURE.md`
- **Prerequisite:** CONOPS approved
- **Contents:**
  1. System Block Diagram (text-based subsystem map)
  2. Subsystem Catalog (SS-01 through SS-N, each with description, key interfaces, dependencies)
  3. Dependency Graph (what blocks what, parallel work streams, critical path)
  4. Key Design Decisions surfaced as open questions
- **Rules:** Every subsystem must trace to a CONOPS system-level capability. Interfaces between subsystems are identified (even if not fully defined yet). Key design decisions (voltage domain, battery chemistry, comm protocol) are surfaced as open questions — not silently assumed.
- **Critic checks:** Subsystem traceability to CONOPS, interface identification, dependency graph presence, design decisions surfaced

### Phase 3: ICD (Interface Control Document) (New)
- **Deliverable:** `docs/ICD.md`
- **Prerequisite:** Architecture approved
- **Contents:**
  1. Mechanical Interfaces (ICD-M-01, ICD-M-02...) — bolt patterns, pilot diameters, shaft splines, loads
  2. Electrical Interfaces (ICD-E-01, ICD-E-02...) — voltage, current, wire gauge, connector type
  3. Data / Signal Interfaces (ICD-D-01, ICD-D-02...) — protocol, baud rate, message IDs
  4. Thermal Interfaces (ICD-T-01, ICD-T-02...) — heat rejection, airflow, ducting
- **Rules:** Every interface traces to a relationship in the Architecture block diagram. Open/unknown parameters are explicitly flagged. Clean plain-text units only.
- **Critic checks:** Interface traceability to Architecture, domain grouping, open parameter flagging, plain-text units

### Phase 4: Capabilities (Modified)
- **Deliverable:** `docs/CAPABILITIES.md`
- **Prerequisite:** ICD approved
- **Change:** Per-subsystem functional traits instead of system-wide generic capabilities
- **Numbering:** `SS-01.a`, `SS-01.b`, `SS-02.a`, `SS-02.b`...
- **Rules:** Each capability cites subsystem ID and ICD interface. Purely functional/behavioral — no numeric tolerances (those go in Requirements). No premature part numbers or vendor names (those go in BOM).
- **Critic checks:** Coverage of all subsystems, subsystem ID tracing, functional-only traits, ICD interface references, no vendor/part references

### Phase 5: Requirements (Modified)
- **Deliverable:** `docs/REQUIREMENTS.md`
- **Prerequisite:** Capabilities approved
- **Change:** Per-subsystem quantified requirements
- **Numbering:** `Requirement SS-01.a`, `Requirement SS-01.b`...
- **Rules:** Each requirement traces to a specific Capability. Respects ICD parameters. If a requirement pushes beyond ICD limits, it must be flagged as a design decision. Quantified metrics with clear units and tolerances.
- **Critic checks:** Capability traceability, metric quantification, ICD consistency, design decision flagging, no LaTeX

### Phase 6: BOM (Bill of Materials) (New)
- **Deliverable:** `docs/BOM.md`
- **Prerequisite:** Requirements approved
- **Process:**
  1. Pass 1 (draft): Specialist reads per-subsystem requirements and generates candidate parts with datasheet links, lead times, and satisfaction flags
  2. Pass 2 (user review): User reviews candidates. If no part fits a requirement, triggers a design decision
- **Contents:**
  - Per-subsystem candidate part tables (Candidate, Specs, Satisfies?, Lead Time, Source, Price)
  - Design Decisions Required section (mismatches flagged for user resolution)
  - Long-lead item markers (★ = 4-8 weeks, ★★ = 8+ weeks)
- **Rules:** Each candidate lists which requirements it satisfies and which it misses. If no candidate satisfies a critical requirement, it is explicitly listed in Design Decisions. The specialist does NOT silently downgrade a requirement to fit available parts.
- **Feedback loop:** When no part fits, the Change Impact specialist flags the requirement as needing revision. This flows back to Requirements and potentially Capabilities.

### Phase 7: RTM (Existing, Adapted)
- **Deliverable:** `docs/RTM.md`
- **Prerequisite:** Requirements + BOM approved
- **Change:** Per-subsystem traceability. Each row traces to a subsystem requirement.
- **Columns:** `| Capability Ref | Req ID | Requirement Statement | Method | Pass / Fail Acceptance Threshold |`
- **Otherwise unchanged:** 4 verification methods (Inspect, Test, Demo, Analysis), 100% requirement coverage

### Phase 8: Milestones (Modified)
- **Deliverable:** `docs/MILESTONES.md`
- **Prerequisite:** RTM approved
- **Change:** Subsystem-layered milestones instead of abstract capability-layered milestones
- **Structure:**
  - **MVC:** Close the core subsystem loop (motor + controller + battery as a closed system)
  - **IOC:** Add dashboard, charging, safety interlocks
  - **FOC:** Add PTO, hydraulics, weatherproofing
- **Otherwise unchanged:** 3-section structure (Phase Objective, Requirements & Acceptance Gates, Evolution & Upgrade Provisions)

### Phase 9: Test Plans (Modified)
- **Deliverable:** `docs/TEST_PLANS.md`
- **Prerequisite:** Milestones approved
- **Change:** Subsystem integration tests instead of component-level tests
- **Focus:** Tests verify that subsystem interfaces work together at each milestone gate
- **Format:** TP-MVP-xx, TP-IOC-xx, TP-FOC-xx — otherwise unchanged

### Phase 10: SOW (Unchanged)
- **Deliverable:** `docs/SOW.md`
- **Prerequisite:** Test Plans approved
- **Unchanged from current implementation**

## Cross-Cutting: Change Impact Analysis Specialist

**Not a linear phase** — a standalone specialist the user invokes on demand.

### Trigger Events

1. **Upstream document revised:** User approves a change to CONOPS, Architecture, ICD, Capabilities, or Requirements. The specialist reads all downstream documents and flags inconsistencies.
2. **BOM gap found:** No candidate part satisfies a requirement. The specialist flags the requirement and the upstream capability as needing a design decision.
3. **User asks:** "/check-impact" or "What needs to change if I update X?"

### What It Produces

```
## Change Impact Analysis

**Source of change:** CONOPS Section 2 (voltage domain changed from 48V to 72V)

**Affected documents:**
| Document | Status | Action Needed |
|---|---|---|
| docs/ARCHITECTURE.md | ✅ Up to date | No change |
| docs/ICD.md | ❌ Needs update | ICD-E-01 (bus voltage), ICD-E-02 (motor voltage) |
| docs/CAPABILITIES.md | ❌ Needs update | SS-01.a, SS-02.a voltage references |
| docs/REQUIREMENTS.md | ❌ Needs update | SS-01.a, SS-02.a, SS-03.a — all voltage-dependent |
| docs/BOM.md | ❌ Needs update | All motor candidates re-evaluate |
| docs/RTM.md | ⚠️ Check | Rows referencing changed requirements |
| docs/MILESTONES.md | ⚠️ Check | MVP gate voltage thresholds |
| docs/TEST_PLANS.md | ⚠️ Check | TP-MVP-02 voltage thresholds |
| docs/SOW.md | ✅ No change | No voltage-dependent scope |

**Recommended actions:**
1. Re-run ICD specialist to update electrical interface parameters
2. Re-run Requirements specialist to update voltage-dependent thresholds
3. Re-run BOM specialist to re-evaluate candidates against new voltage
4. Review RTM, Milestones, Test Plans for voltage threshold consistency
```

### Rules

- Does NOT automatically rewrite documents — it flags what needs changing and recommends actions
- The user decides which specialists to re-run
- Compares the current content of upstream documents against the approved artifact records in state.json
- When an upstream document's `updatedAt` timestamp is newer than a downstream document's `updatedAt`, it flags the downstream document

## Prerequisite Chain Summary

```
CONOPS → Architecture → ICD → Capabilities → Requirements → BOM → RTM → Milestones → Test Plans → SOW
```

- BOM has a feedback loop back to Requirements and Capabilities when parts don't fit
- Change Impact Analysis is cross-cutting, not a phase

## Files to Create

| File | Purpose |
|---|---|
| `src/specialists/packages/architecture/index.ts` | System Architecture specialist |
| `src/specialists/packages/icd/index.ts` | ICD specialist |
| `src/specialists/packages/bom/index.ts` | BOM specialist |
| `src/specialists/packages/change-impact/index.ts` | Change Impact Analysis specialist |

## Files to Modify

| File | Change |
|---|---|
| `src/specialists/registry.ts` | Register 4 new specialists |
| `src/specialists/packages/conops/index.ts` | Add system-level capabilities section to CONOPS prompt |
| `src/specialists/packages/capabilities/index.ts` | Retarget per-subsystem, change numbering, add prerequisite ARCHITECTURE+ICD |
| `src/specialists/packages/requirements/index.ts` | Retarget per-subsystem, change numbering, add prerequisite CAPABILITIES+ICD |
| `src/specialists/packages/rtm/index.ts` | Update prerequisite to REQUIREMENTS+BOM |
| `src/specialists/packages/milestones/index.ts` | Update for subsystem-layered milestones |
| `src/specialists/packages/testplans/index.ts` | Update for subsystem integration tests |
| `src/workspace/state.ts` | Update ORDERED_WORKFLOW_PHASES to new ordering, remove WBS |
| `src/workspace/types.ts` | Remove WBS phase, add ARCHITECTURE, ICD, BOM |
| `src/core/runner.ts` | Update prerequisite checks, add BOM feedback loop handling |
| `src/core/classifier.ts` | Add new specialist IDs to VALID_SPECIALISTS |
| `tests/*.test.ts` | Update tests for new phase ordering |

## Files to Delete

| File | Reason |
|---|---|
| `src/specialists/packages/wbs/index.ts` | WBS is dropped — System Architecture + ICD + BOM cover decomposition |
| `src/specialists/packages/wbs/` (directory) | Clean up |

## Non-Goals

- The BOM does not integrate with real supplier APIs or live part databases — candidates are generated from the specialist's training knowledge, and users fill in real links/prices
- The Change Impact Analysis specialist does not auto-rewrite documents — it only flags inconsistencies
- The CONOPS system-level capabilities section does not replace the existing 6-section structure — it's an addition to Section 1