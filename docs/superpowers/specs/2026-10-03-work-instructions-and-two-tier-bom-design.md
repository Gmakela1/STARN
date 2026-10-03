# Two-Tier BOM, Work Instructions Specialist & Action-Gated Testing — Specification

**Date:** 2026-10-03  
**Status:** Approved  
**Scope:** BOM Specialist (`docs/BOM.md` & `docs/TRADE_STUDY.md`), Build Sequence Specialist (`docs/build_sequences/`), Work Instructions Specialist (`docs/work_instructions/`), Test Plans Specialist (`docs/TEST_PLANS.md`), Workspace State, and test suite  

---

## 1. Problem Statement

1. **Procurement vs. Trade-Study Conflation:** The current Bill of Materials (`BOM.md`) mixes candidate comparison matrices with procurement information, lacks critical physical tracking fields (notably **`Quantity`**, live vendor URLs, order/tracking numbers, procurement status stages, actual unit/total prices, and financial variance), and does not calculate automated budget rollups.
2. **Build Sequence Detail Collapse:** `BUILD-SEQUENCE.md` currently attempts to act as both a high-level project assembly schedule and a step-by-step physical manual. In complex hardware projects, compressing 15–30 multi-step procedures into a single document causes output token exhaustion, generic instructions, and a lack of granular physical details (wrench sizes, torque specs, safety/PPE).
3. **No Mechanism for Shop-Floor Reactive Rework:** When a field failure or non-conformance occurs during assembly (e.g., a stripped thread, fitting leak, or misaligned bracket), there is no isolated mechanism to author a corrective procedure without regenerating the entire macro build sequence.
4. **Ungated Test Execution Hazards:** Physical test plans currently lack explicit upstream action prerequisites. Running a high-pressure or high-voltage test before prerequisite mechanical mounts, wire harnesses, or battery isolations are complete creates severe safety and hardware damage hazards.
5. **Scattered Evidence Storage:** Without a standardized media repository, build photos, torque verifications, and test measurements risk being saved inconsistently across directories, making automated UI binding difficult.

---

## 2. Goals & Non-Goals

### Goals
- **Two-Tier BOM Architecture:**
  - `docs/BOM.md`: The authoritative procurement, inventory, and cost ledger containing part descriptions, subsystem mapping, **Quantity (`Qty`)**, source URLs, order/tracking numbers, procurement status (`Identified`, `Ordered`, `Shipped`, `Received`, `Bench Tested`), estimated unit/total price, actual total price, variance, and a financial rollup summary.
  - `docs/TRADE_STUDY.md`: The engineering candidate comparison matrix evaluating candidate options against system requirements, lead times, and compatibility.
- **Dedicated Work Instructions Specialist (`work-instructions`):**
  - Creates modular, surgical shop-floor procedures in `docs/work_instructions/`.
  - Naming convention: `ACTION-<NUM>-<SLUG>-WORK-INSTRUCTION.md` (and `-2.md`, `-3.md` for successive revisions/reworks).
  - Includes exact tool/socket sizes, torque specs, threadlockers, PPE warnings, detailed step-by-step checklists, evidence slots, and hardware non-conformance logs.
- **Build Sequence as Macro Orchestrator:**
  - `docs/build_sequences/BUILD_SEQUENCE_{GATE}.md` generates the **Master Action Table**, sequencing linear steps (`ACTION-01`, `ACTION-02`, etc.) and hyperlinking each to its dedicated Work Instruction document.
- **Bidirectional Test Plan Gating:**
  - `docs/TEST_PLANS.md` enforces a `Gating Prerequisites (MANDATORY BEFORE EXECUTION)` block at the top of each test plan, explicitly checking that required physical actions are `COMPLETED`.
  - Work Instructions link directly to required test plans as inline gating checkpoints.
- **Flat Master Evidence Repository:**
  - Standardize `artifacts/` as the single flat directory for all uploaded evidence.
  - Standardized filename pattern: `ACTION-<NUM>-<SLUG>-WI-<VERSION>-<DESCRIPTOR>.<ext>`.
- **13-Phase Workflow Progression:**
  - Formally update `ORDERED_WORKFLOW_PHASES` to include `work-instructions` as Phase 11 (between `build-sequence` and `testplans`).

### Non-Goals
- Real-time hardware telemetry ingestion: This release focuses on structured documentation, checklists, file linkages, and agent generation.
- Automated carrier tracking scraping: Tracking numbers are stored as plain text fields for user entry and web display.

---

## 3. Architecture & Data Design

### 3.1 Two-Tier BOM Structure

#### Tier 1: `docs/BOM.md` (Procurement, Inventory & Cost Rollup)
```markdown
# Bill of Materials (BOM) & Procurement Tracker: [Project Name]

## 1. Master Procurement & Inventory Ledger

| Item # | Part / Description | Subsystem | Qty | Source / URL | Order & Tracking # | Status | Est. Unit | Est. Total | Actual Total | Variance |
| :---: | :--- | :---: | :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **SS01-01** | ME1115 BLDC Motor | SS-01 | 1 | [link] | #ORD-9821 (1Z999...) | Received | $895.00 | $895.00 | $920.00 | +$25.00 |
| **SS02-01** | 20S 72V 80Ah LiFePO4 | SS-02 | 1 | [link] | #B-4412 (9400...) | Shipped | $1,450.00 | $1,450.00 | $1,450.00 | $0.00 |
| **SS07-03** | 1/2" JIC to SAE -08 Fitting | SS-07 | 4 | [link] | #H-102 | Ordered | $8.50 | $34.00 | $36.00 | +$2.00 |

*Allowed Statuses:* `Identified` | `Ordered` | `Shipped` | `Received` | `Bench Tested`

## 2. Financial & Procurement Rollup
- **Total Estimated Budget:** $2,379.00
- **Total Actual Committed Spend:** $2,406.00
- **Net Budget Variance:** +$27.00
- **Procurement Progress:** 2 of 3 line items committed/shipped (66%) | 1 Verified Received (33%)
```

#### Tier 2: `docs/TRADE_STUDY.md` (Candidate Evaluation & Trade Study)
Authored alongside `BOM.md` by the BOM specialist, containing per-subsystem candidate comparison matrices, requirement compliance (✅/⚠️/❌), lead times, long-lead flags (★), and design decision rationales.

---

### 3.2 Master Action Table in `BUILD_SEQUENCE.md`

`docs/build_sequences/BUILD_SEQUENCE_{GATE}.md` contains:
```markdown
# Build Sequence: [Gate Name] — [Project Name]

## Pre-Build Parts Receipt Checklist
- [ ] [SS01-01] ME1115 BLDC Motor received and bench-tested
- [ ] [SS02-01] 20S 72V 80Ah Battery Pack received and cell voltages verified

## Master Action Table

| Action # | Action Description | Target Subsystem | Prerequisite Actions | Work Instruction Document | Status | Non-Conformance |
| :---: | :--- | :---: | :---: | :--- | :---: | :---: |
| **ACTION-01** | Remove Diesel Engine & Drain Fluids | SS-01 | None | `docs/work_instructions/ACTION-01-REMOVE-DIESEL-ENGINE-WORK-INSTRUCTION.md` | READY | NONE |
| **ACTION-02** | Driveline & Transmission Shaft Pilot Measurement | SS-01 | ACTION-01 | `docs/work_instructions/ACTION-02-SHAFT-PILOT-MEASURE-WORK-INSTRUCTION.md` | PENDING | NONE |
| **ACTION-03** | Mount Electric Motor & Bellhousing Adapter | SS-01 | ACTION-02 | `docs/work_instructions/ACTION-03-MOUNT-ELECTRIC-MOTOR-WORK-INSTRUCTION.md` | PENDING | NONE |
| **ACTION-04** | Fabricate Motor & Battery Chassis Mounts | SS-06 | ACTION-01 | `docs/work_instructions/ACTION-04-FABRICATE-MOUNTS-WORK-INSTRUCTION.md` | PENDING | NONE |
```

---

### 3.3 Work Instructions Specialist & Document Structure

- **Specialist ID:** `work-instructions`
- **Name:** `Work Instructions & Shop Floor Procedures`
- **Output Path:** `docs/work_instructions/ACTION-<NUM>-<SLUG>-WORK-INSTRUCTION.md`
- **Allowed Tools:** `fs_read`, `fs_write`, `fs_edit`, `fs_list`, `state_read`, `state_update`, `example_reader`

#### Document Layout:
```markdown
# Work Instruction: ACTION-03 — Mount Electric Motor & Bellhousing Adapter
**Milestone Gate:** MVC / Powertrain  
**Target Subsystem:** SS-01 (Traction Motor) | **Interface:** ICD-M-01  
**Status:** [READY | IN-PROGRESS | COMPLETED | BLOCKED]

---

## 1. Prerequisites & Required Resources
- **Prerequisite Actions:** ACTION-01 (Engine Removed), ACTION-02 (Shaft Pilot Verified)
- **Parts from BOM:**
  - 1x ME1115 BLDC Motor (BOM #SS01-01)
  - 1x SAE 3 Bellhousing Adapter Plate (BOM #SS01-02)
  - 4x M10-1.5 x 40mm Grade 10.9 Zinc Bolts (BOM #SS01-04)
- **Required Tools & Equipment:**
  - 17mm socket & 3/8" ratchet
  - Calibrated torque wrench (range 20–100 ft-lbs)
  - Loctite 271 (Red high-strength threadlocker)
  - Brake cleaner & lint-free shop rags
  - Dial indicator with magnetic base
- **Safety Equipment / PPE:**
  - ANSI Z87.1 safety glasses, steel-toe boots, mechanic gloves

---

## 2. Step-by-Step Action Checklist
- [ ] **Step 1:** Spray transmission bellhousing mating face with brake cleaner and wipe completely dry.
- [ ] **Step 2:** Slide SAE 3 adapter plate over transmission pilot flange. Verify adapter seats flat against face with zero rocking.
- [ ] **Step 3:** Mount dial indicator to transmission case; measure adapter pilot runout. Verify total indicated runout (TIR) <= 0.05 mm.
- [ ] **Step 4:** Apply 3 drops of Loctite 271 to the first 4 threads of each M10 bolt.
- [ ] **Step 5:** Thread all 4 bolts finger-tight. Torque in star pattern to 45 ft-lbs (61 Nm) using calibrated torque wrench.
- [ ] **Step 6: [GATED TEST PLAN EXECUTION: TP-MECH-01 — Shaft Concentricity & Runout]**
  - Verify all prerequisites in `docs/TEST_PLANS.md#TP-MECH-01` are satisfied.
  - Mount electric motor shaft into coupler. Hand-rotate motor shaft 360 degrees.
  - Verify zero mechanical binding or spline chatter.
- [ ] **Step 7: [RECORD EVIDENCE]**
  - Take clear photo showing torque marks across M10 bolt heads.
  - Save to `artifacts/ACTION-03-MOUNT-MOTOR-WI-1-TORQUE-MARKS.jpg`.

---

## 3. Verification & Evidence Artifacts
- **Completion Photo / Media:** `artifacts/ACTION-03-MOUNT-MOTOR-WI-1-TORQUE-MARKS.jpg`
- **Measured Data:** Radial runout: `[ 0.03 mm ]` (Specification <= 0.05 mm)
- **Sign-off:** Builder — Date: `YYYY-MM-DD`

---

## 4. Hardware Non-Conformance / Bug Log
*(If an issue, defect, or mismatch occurs, flag here)*
- **Flag Status:** [NONE | OPEN_NON_CONFORMANCE | RESOLVED]
- **Defect Description:** (e.g. "Bellhousing pilot bore is 82.5mm but adapter pilot boss is 85.0mm; will not seat flush.")
- **Defect Photo / Evidence:** `artifacts/ACTION-03-MOUNT-MOTOR-WI-1-DEFECT-PILOT-MISMATCH.jpg`
- **AI Recommendation / Resolution:** (Populated during non-conformance review)
```

---

### 3.4 Bidirectional Test Plan Gating in `TEST_PLANS.md`

Every test plan in `docs/TEST_PLANS.md` must lead with an explicit gating block:
```markdown
## Test Plan: TP-HYD-01 — Hydraulic Loop Pressure & Relief Hold
- **Target Subsystem:** SS-07 (PTO / Hydraulics) | **Interface:** ICD-H-01
- **Critical Safety Class:** High Pressure Fluid (2,100 PSI)

### Gating Prerequisites (MANDATORY BEFORE EXECUTION)
- [ ] **ACTION-01:** Remove Diesel Engine & Drain Fluids — `COMPLETED`
- [ ] **ACTION-03:** Mount Electric Motor & Bellhousing Adapter — `COMPLETED`
- [ ] **ACTION-05:** Install Battery Pack & HV Distribution — `COMPLETED`
- [ ] **ACTION-06:** Wire Motor Controller & 12V Logic Harness — `COMPLETED`
- [ ] **ACTION-07:** Install Hydraulic Pump, Reservoir & Hoses — `COMPLETED`
- [ ] **Work Instruction Sign-off:** `docs/work_instructions/ACTION-07-HYDRAULIC-PUMP-INSTALL-WORK-INSTRUCTION.md` signed off.
*CRITICAL SAFETY WARNING: Do NOT energize pump or connect pressure transducer if any prerequisite action above is incomplete.*

### Pass / Fail Criteria
- **Holding Pressure:** 2,100 PSI ± 50 PSI for 5 continuous minutes.
- **Allowed Pressure Drop:** <= 50 PSI.
- **Visual Inspection:** Zero weeping, dripping, or aerosol misting at any fitting or hose crimp.
```

---

### 3.5 13-Phase Workflow Integration in `src/workspace/state.ts`

`ORDERED_WORKFLOW_PHASES` updated:
1. `conops` (`docs/CONOPS.md`)
2. `architecture` (`docs/ARCHITECTURE.md`)
3. `icd` (`docs/ICD.md`)
4. `capabilities` (`docs/CAPABILITIES.md`)
5. `requirements` (`docs/REQUIREMENTS.md`)
6. `bom` (`docs/BOM.md` & `docs/TRADE_STUDY.md`)
7. `rtm` (`docs/RTM.md`)
8. `milestones` (`docs/MILESTONES.md`)
9. `risk-register` (`docs/RISK_REGISTER.md`)
10. `build-sequence` (`docs/build_sequences/BUILD_SEQUENCE_{GATE}.md`)
11. **`work-instructions` (`docs/work_instructions/`)** *(New Phase)*
12. `testplans` (`docs/TEST_PLANS.md`)
13. `sow` (`docs/SOW.md`)

Scaffolding automatically ensures:
- `docs/work_instructions/` exists.
- `artifacts/` exists.

---

## 4. Verification & Testing

1. **State Tests (`tests/workspace.test.ts`):**
   - Verify workflow initializes with 13 phases.
   - Verify directory scaffolding creates `docs/work_instructions/` and `artifacts/`.
2. **BOM Specialist Tests (`tests/specialists.test.ts`):**
   - Verify BOM specialist generates tables containing `Qty`, `Source / URL`, `Order & Tracking #`, `Status`, `Actual Price`, and `Financial & Procurement Rollup`.
3. **Work Instructions Specialist Tests (`tests/work-instructions.test.ts`):**
   - Verify `work-instructions` package exists, requires `BUILD_SEQUENCE` prerequisite, uses `fs_write`/`fs_edit`, and has specialized rubric.
4. **Build Sequence Specialist Tests (`tests/build-sequence.test.ts`):**
   - Verify `build-sequence` produces Master Action Table linking to Work Instructions.
5. **Test Plans Specialist Tests (`tests/testplans.test.ts`):**
   - Verify `testplans` prompts and rubric enforce prerequisite action gating at the top of each test plan.
6. **Regression:**
   - Full test suite passes: `npm test` (`tsc --noEmit && vitest run`).
