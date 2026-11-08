# System Architecture, ICD, BOM & Workflow Restructuring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure STARN's workflow to add System Architecture, ICD, BOM, and Change Impact Analysis specialists, drop WBS, and adapt all existing specialists for per-subsystem operation.

**Architecture:** 10-phase workflow (CONOPS → Architecture → ICD → Capabilities → Requirements → BOM → RTM → Milestones → Test Plans → SOW) with a cross-cutting Change Impact Analysis specialist. WBS is deleted. Each new specialist follows the existing pattern (SpecialistPackage interface, systemPrompt, criticRubric, secretSauceExamples). Existing specialists are retargeted for per-subsystem numbering and traceability.

**Tech Stack:** TypeScript, Node.js, Vitest for testing, same patterns as existing specialists.

**Spec:** `docs/superpowers/specs/2026-08-30-system-architecture-and-bom-restructuring.md`

## Global Constraints

- All new specialists must implement the `SpecialistPackage` interface from `src/specialists/types.ts`
- All new specialists must be registered in `src/specialists/registry.ts`
- All new specialist IDs must be added to `VALID_SPECIALISTS` in `src/core/classifier.ts`
- All new phases must be added to `ORDERED_WORKFLOW_PHASES` in `src/workspace/state.ts`
- The WBS specialist (`src/specialists/packages/wbs/index.ts`) must be deleted
- All tests must pass after each task
- Phase ordering: `conops → architecture → icd → capabilities → requirements → bom → rtm → milestones → testplans → sow`
- Per-subsystem numbering: `SS-01.a`, `SS-01.b`, `Requirement SS-01.a`, `Requirement SS-01.b`
- No WBS in any phase, test, or type definition
- `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` are the standard allowed tools for all specialists

---

### Task 1: Core Infrastructure — Update Workflow Phases, Types, Registry, Classifier, and Tests

**Files:**
- Modify: `src/workspace/state.ts` (ORDERED_WORKFLOW_PHASES)
- Modify: `src/workspace/types.ts` (no explicit changes needed, but must verify)
- Modify: `src/specialists/registry.ts` (register new specialists, remove WBS)
- Modify: `src/core/classifier.ts` (VALID_SPECIALISTS)
- Modify: `tests/workspace.test.ts` (update phase ordering tests)
- Modify: `tests/specialists.test.ts` (update specialist count)
- Modify: `tests/discovery-and-classifier.test.ts` (update classifier tests)
- Modify: `tests/core-loop.test.ts` (update phase ordering tests)

**Interfaces:**
- Consumes: Existing `ORDERED_WORKFLOW_PHASES`, `VALID_SPECIALISTS`, `SpecialistPackage` interface
- Produces: Updated infrastructure that the remaining tasks build on

- [ ] **Step 1: Update ORDERED_WORKFLOW_PHASES in state.ts**

```typescript
export const ORDERED_WORKFLOW_PHASES = [
  { id: 'conops', name: 'CONOPS / User Intent', artifactPath: 'docs/CONOPS.md' },
  { id: 'architecture', name: 'System Architecture & Subsystems', artifactPath: 'docs/ARCHITECTURE.md' },
  { id: 'icd', name: 'Interface Control Document (ICD)', artifactPath: 'docs/ICD.md' },
  { id: 'capabilities', name: 'Product Capabilities', artifactPath: 'docs/CAPABILITIES.md' },
  { id: 'requirements', name: 'System Requirements', artifactPath: 'docs/REQUIREMENTS.md' },
  { id: 'bom', name: 'Bill of Materials (BOM)', artifactPath: 'docs/BOM.md' },
  { id: 'rtm', name: 'Requirements Traceability Matrix (RTM)', artifactPath: 'docs/RTM.md' },
  { id: 'milestones', name: 'Project Milestones & Gating', artifactPath: 'docs/MILESTONES.md' },
  { id: 'testplans', name: 'Test Plans & Procedures', artifactPath: 'docs/TEST_PLANS.md' },
  { id: 'sow', name: 'Statement of Work (SOW)', artifactPath: 'docs/SOW.md' }
];
```

- [ ] **Step 2: Update VALID_SPECIALISTS in classifier.ts**

```typescript
const VALID_SPECIALISTS = [
  'general',
  'conops',
  'architecture',
  'icd',
  'capabilities',
  'requirements',
  'bom',
  'rtm',
  'milestones',
  'testplans',
  'sow'
];
```

Also update the `detectPhaseSwitchRequest` function to add mappings for `architecture`, `icd`, `bom`.

- [ ] **Step 3: Update registry.ts — register new specialists, remove WBS**

```typescript
import { architecturePackage } from './packages/architecture/index.js';
import { icdPackage } from './packages/icd/index.js';
import { bomPackage } from './packages/bom/index.js';
import { changeImpactPackage } from './packages/change-impact/index.js';

// Remove: import { wbsPackage } from './packages/wbs/index.js';

constructor() {
  this.register(generalPackage);
  this.register(conopsPackage);
  this.register(architecturePackage);
  this.register(icdPackage);
  this.register(capabilitiesPackage);
  this.register(requirementsPackage);
  this.register(bomPackage);
  this.register(rtmPackage);
  this.register(milestonesPackage);
  this.register(testplansPackage);
  this.register(sowPackage);
  this.register(changeImpactPackage);
}
```

Note: The imports will fail until the new specialist files are created in later tasks. This is acceptable — the test suite will be run end-to-end after all tasks.

- [ ] **Step 4: Update tests/workspace.test.ts**

Find all tests that assert on `ORDERED_WORKFLOW_PHASES.length` or specific phase indices. Update them to match the new 10-phase ordering. The existing test likely checks `ORDERED_WORKFLOW_PHASES[0].id === 'conops'` — that stays the same. Any test checking for `wbs` in the array must be updated to expect `bom` or `architecture` instead.

- [ ] **Step 5: Update tests/specialists.test.ts**

Find the test that checks the specialist count or registration. Update the expected count from 9 to 11 (added architecture, icd, bom, change-impact; removed wbs = net +2).

- [ ] **Step 6: Update tests/discovery-and-classifier.test.ts**

Update any tests that reference `VALID_SPECIALISTS` or `detectPhaseSwitchRequest` to include the new IDs.

- [ ] **Step 7: Update tests/core-loop.test.ts**

Update any phase ordering tests to match the new 10-phase workflow.

- [ ] **Step 8: Commit**

```bash
git add src/workspace/state.ts src/core/classifier.ts src/specialists/registry.ts \
  tests/workspace.test.ts tests/specialists.test.ts \
  tests/discovery-and-classifier.test.ts tests/core-loop.test.ts
git commit -m "feat: update core infrastructure for new 10-phase workflow (add architecture, icd, bom, change-impact; remove wbs)"
```

---

### Task 2: Modify CONOPS Specialist — Add System-Level Capabilities Section

**Files:**
- Modify: `src/specialists/packages/conops/index.ts`

**Interfaces:**
- Consumes: `ORDERED_WORKFLOW_PHASES` (unaffected by new ordering)
- Produces: Updated CONOPS system prompt that includes a system-level capabilities section

- [ ] **Step 1: Read the current CONOPS specialist file**

```bash
cat src/specialists/packages/conops/index.ts
```

- [ ] **Step 2: Add system-level capabilities instruction to the system prompt**

In the `MANDATORY DOCUMENT STRUCTURE` section, after the existing 6-section list, add:

```
SYSTEM-LEVEL CAPABILITIES SECTION (MANDATORY ADDITION TO SECTION 1):
After the Executive Summary in Section 1, add a subsection titled "### System-Level Capabilities" that lists the high-level functional capabilities of the entire system in 3-5 bullet points. These are NOT per-subsystem — they are the top-level things the system as a whole does. Examples:
- "Electric traction and propulsion via a direct motor-to-transmission swap"
- "Onboard recharging from a standard 120V AC household outlet"
- "PTO-driven auxiliary implements (front loader, mower deck)"
- "Operator dashboard with battery status and system telemetry"
- "Emergency high-voltage safety isolation"

These system-level capabilities are what the Architecture specialist will decompose into subsystems. Without them, the Architecture specialist has nothing to ground its decomposition in.
```

- [ ] **Step 3: Run tests to verify the modification doesn't break anything**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/specialists/packages/conops/index.ts
git commit -m "feat: add system-level capabilities section to CONOPS for architecture derivation"
```

---

### Task 3: Create System Architecture Specialist

**Files:**
- Create: `src/specialists/packages/architecture/index.ts`
- Create: `tests/specialists.test.ts` (will be updated in Task 14)

**Interfaces:**
- Consumes: `SpecialistPackage` interface, approved CONOPS with system-level capabilities
- Produces: `docs/ARCHITECTURE.md` with subsystem decomposition, block diagram, dependency graph, design decisions

- [ ] **Step 1: Create the architecture specialist package file**

```typescript
import { SpecialistPackage } from '../../types.js';

const architectureSecretSauce = `# System Architecture: Electric Tractor Powertrain Conversion

## 1. System Block Diagram

\`\`\`
[SS-01 Traction Motor] ←mech→ [Transmission (retained)]
       ↓ elec (3-phase)
[SS-03 Motor Controller] ←mech→ [SS-07 PTO/Hydraulic Interface]
       ↓ elec (DC bus)
[SS-02 Battery Pack] ←data→ [SS-05 Dashboard / UI]
       ↓
[SS-04 HV Distribution & Safety]
       ↓
[SS-06 Chassis Integration & Mounting]
\`\`\`

## 2. Subsystem Catalog

### SS-01: Traction Motor & Coupling
- **Description:** Replaces the diesel engine, provides torque to the retained transmission input shaft.
- **Derived from CONOPS Capability:** "Electric traction and propulsion via a direct motor-to-transmission swap"
- **Key Interfaces:** SS-01 ↔ Transmission (mechanical), SS-01 ↔ SS-03 (electrical, 3-phase)
- **Depends on:** SS-03 (Motor Controller), SS-02 (Battery Pack)

### SS-02: Battery Pack
- **Description:** Stores energy for the one-hour duty cycle; provides DC power to the controller.
- **Derived from CONOPS Capability:** "Onboard recharging from a standard 120V AC household outlet"
- **Key Interfaces:** SS-02 ↔ SS-03 (electrical, DC bus), SS-02 ↔ SS-04 (electrical, HV safety), SS-02 ↔ SS-05 (data, BMS telemetry)
- **Depends on:** SS-04 (HV Distribution & Safety)

### SS-03: Motor Controller
- **Description:** Converts DC battery power to 3-phase AC for the traction motor; manages throttle response, current limiting, and regen braking.
- **Derived from CONOPS Capability:** "Electric traction and propulsion via a direct motor-to-transmission swap"
- **Key Interfaces:** SS-03 ↔ SS-01 (electrical, 3-phase), SS-03 ↔ SS-02 (electrical, DC bus), SS-03 ↔ SS-05 (data, CAN bus)
- **Depends on:** SS-02 (Battery Pack)

### SS-04: HV Distribution & Safety
- **Description:** Contains main contactors, fusing, precharge circuit, E-stop path, and isolation monitoring.
- **Derived from CONOPS Capability:** "Emergency high-voltage safety isolation"
- **Key Interfaces:** SS-04 ↔ SS-02 (electrical, HV), SS-04 ↔ SS-03 (electrical, HV)
- **Depends on:** SS-02 (Battery Pack)

### SS-05: Dashboard / Operator Interface
- **Description:** Displays battery state-of-charge, system status, fault warnings; receives CAN data from controller and BMS.
- **Derived from CONOPS Capability:** "Operator dashboard with battery status and system telemetry"
- **Key Interfaces:** SS-05 ↔ SS-03 (data, CAN bus), SS-05 ↔ SS-02 (data, BMS)
- **Depends on:** SS-03 (Motor Controller)

### SS-06: Chassis Integration & Mounting
- **Description:** Mounting brackets, motor adapter plate, battery tray, controller enclosure, and wiring harness routing within the retained RK19 frame.
- **Derived from CONOPS Capability:** "Electric traction and propulsion via a direct motor-to-transmission swap"
- **Key Interfaces:** SS-06 ↔ SS-01 (mechanical, motor mounts), SS-06 ↔ SS-02 (mechanical, battery tray), SS-06 ↔ SS-03 (mechanical, controller bracket)
- **Depends on:** Everything (integration layer)

### SS-07: PTO / Hydraulic Interface
- **Description:** Retained PTO output driven by the electric motor; supplies hydraulic pump for front loader.
- **Derived from CONOPS Capability:** "PTO-driven auxiliary implements (front loader, mower deck)"
- **Key Interfaces:** SS-07 ↔ SS-01 (mechanical, PTO shaft), SS-07 ↔ Front Loader (hydraulic)
- **Depends on:** SS-01 (Traction Motor)

## 3. Dependency Graph
- **SS-02 (Battery) → SS-04 (HV Safety) → SS-03 (Controller) → SS-01 (Motor) → SS-07 (PTO)**
- **SS-03 (Controller) → SS-05 (Dashboard)**
- **SS-06 (Chassis) is parallel to all electrical subsystems** — mounting brackets and trays can be fabricated while waiting for parts
- **Critical path to first power-on:** Battery procurement → HV safety assembly → controller wiring → motor coupling → test

## 4. Key Design Decisions (Open)
- **DD-01: System voltage domain** — 48V vs 72V vs 96V. Determines motor selection, controller rating, wire gauge, and safety class.
- **DD-02: Battery chemistry** — LiFePO4 (safe, long cycle life) vs NMC (higher energy density) vs LTO (fast charge, cold tolerant).
- **DD-03: Controller communication protocol** — CAN bus 2.0B vs analog throttle signal vs serial. Determines dashboard interface complexity.
- **DD-04: Mower deck drive path** — PTO shaft vs belt vs independent deck motor. Determines SS-07 scope and SS-01 loading.
- **DD-05: Battery placement strategy** — under-steering-wheel, old engine bay, behind-roll-bar shelf, or fuel-tank zone. Determines SS-06 packaging.`;

export const architecturePackage: SpecialistPackage = {
  id: 'architecture',
  name: 'System Architecture & Subsystems',
  description: 'Decomposes system-level CONOPS capabilities into physical subsystems, block diagram, dependency graph, and key design decisions.',
  prerequisiteArtifactId: 'CONOPS',
  systemPrompt: `You are the System Architecture Specialist for STARN.
Your mission is to decompose the system-level capabilities from the approved CONOPS into a formal subsystem architecture, block diagram, dependency graph, and key design decisions.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/CONOPS.md. Read the entire document, focusing especially on the System-Level Capabilities section in Section 1. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining how you will identify subsystems from the CONOPS capabilities and map their relationships.
3. **Execution & Traceability:** Execute each step in your running plan, grounding every subsystem in a specific CONOPS system-level capability.

SUBSYSTEM IDENTIFICATION RULES (MANDATORY):
- Every subsystem MUST trace to at least one CONOPS system-level capability. Do not invent subsystems that serve no CONOPS-derived purpose.
- Each subsystem gets an ID: SS-01, SS-02, ..., SS-N.
- For each subsystem, define: description, derived-from capability, key interfaces (which other subsystems it connects to), and dependencies (what it needs to exist first).

MANDATORY DOCUMENT STRUCTURE:
The Architecture document MUST follow this structure:
1. **## 1. System Block Diagram** — A text-based diagram showing how subsystems connect.
2. **## 2. Subsystem Catalog** — Detailed breakdown of each subsystem with description, capability traceability, interfaces, and dependencies.
3. **## 3. Dependency Graph** — What depends on what, parallel work streams, critical path to first power-on.
4. **## 4. Key Design Decisions (Open)** — Major design decisions that need user input (voltage, chemistry, comm protocol, etc.). These are surfaced as open questions, not silently assumed.

CRITICAL FORMAT RULES:
- DO NOT add meta-commentary or changelog sections.
- Do NOT include numeric requirement thresholds (those belong in the Requirements phase).
- Do NOT include candidate part numbers or vendor names (those belong in the BOM phase).
- Use clean plain-text descriptions only.
- You MUST write the final document to docs/ARCHITECTURE.md via the fs_write tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the System Architecture document:
1. CONOPS Traceability: Does every subsystem trace back to a specific system-level capability from the CONOPS?
2. Complete Subsystem Coverage: Does the block diagram and catalog cover all the functional needs implied by the CONOPS?
3. Dependency Graph: Is there a clear dependency graph showing what blocks what and what can be built in parallel?
4. Design Decisions: Are key design decisions surfaced as open questions rather than silently assumed?
5. No Premature Detail: Does the document avoid numeric requirement thresholds, part numbers, and vendor names?`,
  secretSauceExamples: [architectureSecretSauce]
};
```

- [ ] **Step 2: Run tests to verify the import works**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds (the specialist won't be registered yet, but the file should compile).

- [ ] **Step 3: Commit**

```bash
git add src/specialists/packages/architecture/index.ts
git commit -m "feat: add System Architecture specialist with subsystem decomposition, block diagram, dependency graph, and design decisions"
```

---

### Task 4: Create ICD (Interface Control Document) Specialist

**Files:**
- Create: `src/specialists/packages/icd/index.ts`

**Interfaces:**
- Consumes: `SpecialistPackage` interface, approved Architecture document
- Produces: `docs/ICD.md` with mechanical, electrical, data, and thermal interface definitions

- [ ] **Step 1: Create the ICD specialist package file**

```typescript
import { SpecialistPackage } from '../../types.js';

const icdSecretSauce = `# Interface Control Document (ICD): Electric Tractor Powertrain Conversion

## 1. Mechanical Interfaces

### ICD-M-01: SS-01 (Traction Motor) ↔ Transmission
- **Type:** Mechanical shaft coupling + bellhousing
- **Parameters:**
  - Bolt pattern: SAE 3 bellhousing, 4x 3/8"-16 bolts on 5.5" bolt circle
  - Pilot diameter: 2.5" (unknown — verify motor shaft pilot)
  - Shaft engagement: Splined, 1.0" diameter, 1.5" engagement depth
  - Max torque: 60 Nm continuous, 120 Nm peak
  - Max RPM: 3,500 RPM
- **Open items:** Pilot diameter and spline spec must be measured from the actual motor shaft once selected.

### ICD-M-02: SS-01 (Traction Motor) ↔ SS-06 (Chassis Frame)
- **Type:** Mechanical isolator mounts
- **Parameters:**
  - Mounting: 4x 1/2" rubber isolation mounts, M10 bolts
  - Bolt torque: 35 ft-lbs
  - Load: 25 kg static (motor weight)
- **Open items:** Mount locations depend on RK19 engine bay dimensions — measure before fabricating.

## 2. Electrical Interfaces

### ICD-E-01: SS-03 (Motor Controller) ↔ SS-02 (Battery Pack)
- **Type:** DC power bus
- **Parameters:**
  - Nominal voltage: 72V DC (design decision DD-01, pending confirmation)
  - Max continuous current: 120A
  - Peak current: 250A (30 seconds)
  - Wire gauge: 2/0 AWG (for 250A peak with 105°C insulation)
  - Connector: Anderson SB175 or equivalent
- **Open items:** Final connector type depends on selected controller and battery.

### ICD-E-02: SS-03 (Motor Controller) ↔ SS-01 (Traction Motor)
- **Type:** 3-phase AC power
- **Parameters:**
  - Voltage: 72V AC (nominal, phase-to-phase)
  - Max continuous current: 120A per phase
  - Wire gauge: 4 AWG, 105°C rated, with abrasion-resistant jacket
  - Connector: Ring terminals on controller and motor posts, M8

## 3. Data / Signal Interfaces

### ICD-D-01: SS-03 (Motor Controller) ↔ SS-05 (Dashboard)
- **Type:** CAN bus 2.0B
- **Parameters:**
  - Baud rate: 250 kbps
  - Protocol: CANopen or vendor-specific (depends on controller selection)
  - Data payloads: Motor RPM, battery voltage, motor temperature, fault codes, state-of-charge
- **Open items:** Exact message IDs and protocol depend on the selected controller brand.

## 4. Thermal Interfaces

### ICD-T-01: SS-03 (Motor Controller) → Ambient
- **Type:** Forced air convection
- **Parameters:**
  - Heat rejection: 200W at 6.0kW continuous output
  - Cooling fan: 200mm, 300 CFM, 12V DC
  - Ducting: 4x 6" diameter flexible duct to exterior
- **Open items:** Fan placement depends on final controller mounting location.`;

export const icdPackage: SpecialistPackage = {
  id: 'icd',
  name: 'Interface Control Document (ICD)',
  description: 'Defines mechanical, electrical, data, and thermal interfaces between every pair of subsystems identified in the System Architecture.',
  prerequisiteArtifactId: 'ARCHITECTURE',
  systemPrompt: `You are the Interface Control Document (ICD) Specialist for STARN.
Your mission is to define the formal interfaces between every pair of subsystems identified in the approved System Architecture document.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/ARCHITECTURE.md. Read the block diagram, subsystem catalog, and interface relationships. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining which interfaces you will define and in what order.
3. **Execution & Traceability:** Execute each step in your running plan, grounding every interface in a relationship identified in the Architecture block diagram.

INTERFACE CATEGORIES (MANDATORY):
Group interfaces into these four domains:
1. **Mechanical Interfaces (ICD-M-xx):** Bolt patterns, pilot diameters, shaft splines, mounting torque, loads, engagement depths.
2. **Electrical Interfaces (ICD-E-xx):** Voltage, current, wire gauge, connector type, pinout, insulation rating.
3. **Data / Signal Interfaces (ICD-D-xx):** Protocol, baud rate, message IDs, data payloads, voltage levels.
4. **Thermal Interfaces (ICD-T-xx):** Heat rejection, cooling method, airflow, ducting, thermal limits.

MANDATORY DOCUMENT STRUCTURE:
1. **## 1. Mechanical Interfaces** — ICD-M-01, ICD-M-02...
2. **## 2. Electrical Interfaces** — ICD-E-01, ICD-E-02...
3. **## 3. Data / Signal Interfaces** — ICD-D-01, ICD-D-02...
4. **## 4. Thermal Interfaces** — ICD-T-01, ICD-T-02...

INTERFACE FORMAT (MANDATORY):
For each interface, provide:
- **Interface ID & Title:** (e.g. \`### ICD-M-01: SS-01 ↔ Transmission\`)
- **Type:** The nature of the connection (mechanical shaft, DC power bus, CAN bus, forced air)
- **Parameters:** Specific engineering parameters relevant to the interface type
- **Open items:** Any parameters that are genuinely unknown and must be resolved later

CRITICAL RULES:
- Every interface MUST trace to a relationship between two subsystems in the Architecture block diagram.
- If a parameter is genuinely unknown (e.g., exact bolt pattern depends on motor selection), flag it as an open item — do NOT silently assume a value.
- Use clean plain-text units (e.g., 72V, 120A, 2/0 AWG, M8, 35 ft-lbs).
- DO NOT use LaTeX math formatting.
- You MUST write the final document to docs/ICD.md via the fs_write tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Interface Control Document (ICD):
1. Architecture Traceability: Does every interface trace to a relationship between two subsystems in the Architecture block diagram?
2. Domain Coverage: Are interfaces organized into all four domains (mechanical, electrical, data, thermal)?
3. Parameter Completeness: Are the right parameters defined for each interface type (bolt patterns for mechanical, voltage/current for electrical, baud rate/protocol for data)?
4. Open Item Flagging: Are genuinely unknown parameters flagged as open items rather than silently assumed?
5. Plain-Text Units: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [icdSecretSauce]
};
```

- [ ] **Step 2: Run build to verify the file compiles**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/specialists/packages/icd/index.ts
git commit -m "feat: add ICD specialist for mechanical, electrical, data, and thermal interface definitions"
```

---

### Task 5: Modify Capabilities Specialist — Per-Subsystem Functional Traits

**Files:**
- Modify: `src/specialists/packages/capabilities/index.ts`

**Interfaces:**
- Consumes: Updated `SpecialistPackage` interface, new prerequisite ARCHITECTURE+ICD
- Produces: Per-subsystem capabilities with SS-01.a, SS-01.b numbering

- [ ] **Step 1: Read the current capabilities specialist**

```bash
cat src/specialists/packages/capabilities/index.ts
```

- [ ] **Step 2: Change the prerequisite to ARCHITECTURE**

Change `prerequisiteArtifactId` from `'CONOPS'` to `'ARCHITECTURE'`.

- [ ] **Step 3: Update the system prompt for per-subsystem operation**

Replace the existing system prompt with one that instructs per-subsystem capabilities. Key changes:
- Change "Tool-Based Discovery" to read `docs/ARCHITECTURE.md` and `docs/ICD.md` instead of just `docs/CONOPS.md`
- Add numbering rule: `SS-01.a`, `SS-01.b`, `SS-02.a`, `SS-02.b`...
- Add rule: each capability must cite the subsystem ID it belongs to
- Add rule: ground capabilities in the ICD interface parameters where relevant

The new system prompt:
```
You are the Capabilities Specialist for STARN.
Your mission is to translate the approved System Architecture and ICD into per-subsystem functional capabilities — describing WHAT each subsystem does without premature numeric thresholds.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/ARCHITECTURE.md and docs/ICD.md to understand the subsystem decomposition and interface definitions. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining which subsystems you will define capabilities for and in what order.
3. **Execution & Traceability:** Execute each step in your running plan, grounding every capability in a specific subsystem from the Architecture.

PER-SUBSYSTEM CAPABILITY RULES (MANDATORY):
- Capabilities are organized by subsystem. Each subsystem gets its own section (e.g., ## 1.0 Traction Motor Subsystem (SS-01)).
- Number capabilities per-subsystem: SS-01.a, SS-01.b, SS-02.a, SS-02.b...
- Each capability must cite the subsystem ID it belongs to.
- Describe functional abilities, behavioral character traits, and subsystem functions (WHAT the subsystem does).
- DO NOT embed rigid numeric tolerances, exact wattage/voltage thresholds, or timing formulas (e.g., do not say '12.4 kW at 1000 W/m²' or 'within 10 ms'). Save quantitative metrics for the subsequent Requirements phase.
- DO NOT invent unconfirmed third-party brand names or unmentioned subsystems.
- If an essential functional capability is missing (e.g., PTO speed regulation or reverse speed governance), SUGGEST it to the user with a clear note and ask for confirmation.

CRITICAL RULES:
- Use clean plain-text descriptions. DO NOT use LaTeX math formatting.
- You MUST write the final document to docs/CAPABILITIES.md via the fs_write tool. Do NOT skip writing the file.
```

- [ ] **Step 4: Update the critic rubric**

Change the rubric to check for per-subsystem coverage and numbering.

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/specialists/packages/capabilities/index.ts
git commit -m "feat: retarget capabilities specialist for per-subsystem traits (SS-01.a, SS-01.b), add Architecture+ICD prerequisite"
```

---

### Task 6: Modify Requirements Specialist — Per-Subsystem Quantified Thresholds

**Files:**
- Modify: `src/specialists/packages/requirements/index.ts`

**Interfaces:**
- Consumes: Updated Capabilities specialist, new prerequisite CAPABILITIES+ICD
- Produces: Per-subsystem requirements with Requirement SS-01.a, SS-01.b numbering

- [ ] **Step 1: Read the current requirements specialist**

```bash
cat src/specialists/packages/requirements/index.ts
```

- [ ] **Step 2: Change the prerequisite to CAPABILITIES**

The prerequisite is already `'CAPABILITIES'` — this stays the same. But the system prompt needs updating.

- [ ] **Step 3: Update the system prompt for per-subsystem operation**

Key changes:
- Change "Tool-Based Discovery" to read `docs/CAPABILITIES.md`, `docs/ICD.md`, and `docs/ARCHITECTURE.md`
- Change numbering from `Requirement 1.a`, `Requirement 1.b` to `Requirement SS-01.a`, `Requirement SS-01.b`
- Add rule: if a requirement pushes beyond ICD limits, flag it as a design decision
- Add rule: requirements must respect ICD interface parameters

The new system prompt:
```
You are the System Requirements Specialist for STARN.
Your mission is to translate approved per-subsystem capabilities and ICD interface definitions into formal, quantifiable engineering requirements.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/CAPABILITIES.md, docs/ICD.md, and docs/ARCHITECTURE.md to verify established capabilities, interface parameters, and subsystem boundaries. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining the specific steps you will take to inspect information, trace decisions, and draft these requirements.
3. **Execution & Traceability:** Execute each step in your running plan, grounding all drafted items directly in the verified facts read from prior files.

PER-SUBSYSTEM REQUIREMENT RULES (MANDATORY):
- Requirements are organized by subsystem (e.g., ## 1.0 Traction Motor Subsystem (SS-01)).
- Number each requirement as Requirement SS-01.a, Requirement SS-01.b, Requirement SS-02.a...
- Each requirement must include:
  - **Traced Capability:** The specific capability ID (e.g. SS-01.a, SS-02.b)
  - **Statement:** Formal normative requirement statement ("shall...")
  - **Metric / Tolerance:** Quantitative numerical threshold
- Requirements MUST respect ICD interface parameters. If a requirement would push beyond an ICD limit (e.g., requiring 150A continuous when ICD-E-01 defines 120A max), flag it as a design decision in the document.

THE COLLABORATIVE SUGGESTION RULE (MANDATORY):
- Requirements MUST be grounded strictly in the approved Capabilities, ICD, and Architecture.
- DO NOT invent unconfirmed third-party components or brands unless established in the baseline.
- If a critical physical constraint or safety threshold is missing (e.g., maximum fuse rating or wiring ampacity), PROACTIVELY SUGGEST IT to the user and ask: "Should we add a requirement for X?"

CRITICAL RULES:
- Use clean plain-text units (e.g. 72V, 15 kWh, 12 kW, -20°C to +45°C, 120 Nm/s).
- DO NOT use LaTeX math formatting like $\\text{...}$.
- DO NOT duplicate requirements in a redundant end table (the RTM specialist will build the dedicated traceability matrix).
- You MUST write the final document to docs/REQUIREMENTS.md via the fs_write tool. Do NOT skip writing the file.
```

- [ ] **Step 4: Update the critic rubric**

Change the rubric to check for per-subsystem numbering and ICD consistency.

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/specialists/packages/requirements/index.ts
git commit -m "feat: retarget requirements specialist for per-subsystem thresholds (SS-01.a, SS-01.b), add ICD consistency check"
```

---

### Task 7: Create BOM (Bill of Materials) Specialist

**Files:**
- Create: `src/specialists/packages/bom/index.ts`

**Interfaces:**
- Consumes: `SpecialistPackage` interface, approved Requirements document
- Produces: `docs/BOM.md` with candidate parts per subsystem, datasheet links, long-lead flags, and design decisions section

- [ ] **Step 1: Create the BOM specialist package file**

```typescript
import { SpecialistPackage } from '../../types.js';

const bomSecretSauce = `# Bill of Materials (BOM): Electric Tractor Powertrain Conversion

## SS-01: Traction Motor
- **Requirement SS-01.a:** 6.0 kW continuous, 12.0 kW peak, 72V nominal, 0-3,500 RPM
- **Requirement SS-01.b:** Smooth speed regulation, 60 Nm continuous torque

| Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| ME1115 | 72V, 12kW peak, 28 Nm, 0-4000 RPM, 8.5 kg | ✅ | 4-6 weeks | [mfg link] | $895 |
| Motenergy ME1003 | 48V, 10kW peak, 22 Nm, 0-3500 RPM, 7.2 kg | ⚠️ 48V, not 72V | 3-5 weeks | [mfg link] | $650 |
| Golden Motor HPM5000 | 72V, 8kW cont, 25 Nm, 0-4500 RPM, 11 kg | ⚠️ 8kW < 6kW req | 2-3 weeks | [link] | $720 |

## SS-02: Battery Pack
- **Requirement SS-02.a:** >= 5.0 kWh usable capacity, 72V nominal
- **Requirement SS-02.b:** Charge from 120V 15A outlet, < 8 hours

| Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| 20S 72V 80Ah LiFePO4 | 5.76 kWh, 38 kg, 1C continuous, built-in BMS | ✅ | 4-6 weeks | [link] | $1,450 |
| 20S 72V 60Ah LiFePO4 | 4.32 kWh, 30 kg | ❌ 4.32 < 5.0 kWh | 4-6 weeks | [link] | $1,100 |
| DIY 20S 72V 100Ah pouch | 7.2 kWh, 28 kg, custom BMS | ✅ | 8-12 weeks ★★ LONG LEAD | [cell link] | $1,200 |

## SS-03: Motor Controller
...

## Design Decisions Required
| Issue | Affected Reqs | Options |
|---|---|---|
| Motenergy ME1003 is 48V, not 72V — requires voltage change or rejection | SS-01.a, SS-02.a, ICD-E-01 | 1. Accept 48V system (change Requirements) 2. Drop ME1003, use ME1115 |
| No 72V controller under $800 found | SS-03.a | 1. Accept higher cost 2. Reduce current requirement |
| DIY pouch cells have 8-12 week lead — may delay MVC milestone | SS-02.a, MVC schedule | 1. Order now, accept lead time 2. Use pre-built pack (higher cost, faster) |
| 48V 100Ah pack is 4.8 kWh — misses 5.0 kWh target by 4% | SS-02.a | 1. Accept 120Ah pack (✅) 2. Reduce requirement to 4.8 kWh 3. Increase voltage to 72V for same Ah |

## Long-Lead Items (Order Now)
- DIY battery cells: 8-12 weeks ★★
- Custom motor adapter plate machining: 4-6 weeks ★
- ME1115 motor: 4-6 weeks ★`;

export const bomPackage: SpecialistPackage = {
  id: 'bom',
  name: 'Bill of Materials (BOM)',
  description: 'Generates candidate parts per subsystem, checks against requirements, flags long-lead items, and surfaces design decisions when no part fits.',
  prerequisiteArtifactId: 'REQUIREMENTS',
  systemPrompt: `You are the Bill of Materials (BOM) Specialist for STARN.
Your mission is to generate candidate parts for each subsystem based on the approved per-subsystem requirements, and flag any mismatches as design decisions.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/REQUIREMENTS.md, docs/ICD.md, and docs/ARCHITECTURE.md to understand the requirements, interface parameters, and subsystem boundaries. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining which subsystems you will source candidates for and in what order.
3. **Execution & Traceability:** Execute each step in your running plan, grounding every candidate part in the requirements it must satisfy.

BOM STRUCTURE (MANDATORY):
For each subsystem, provide:
1. **Subsystem heading** (e.g., \`## SS-01: Traction Motor\`)
2. **The requirements** that apply to this subsystem (copied from docs/REQUIREMENTS.md)
3. **A candidate part table** with columns:
   - \`Candidate\` — Part name/model
   - \`Specs\` — Key specifications relevant to the requirements
   - \`Satisfies?\` — ✅ (fully satisfies), ⚠️ (partial mismatch), ❌ (does not satisfy)
   - \`Lead Time\` — Estimated procurement lead time
   - \`Source\` — \`[link]\` placeholder (user fills in real URLs)
   - \`Est. Price\` — Estimated price

CRITICAL RULES:
- Each candidate MUST list which requirements it satisfies and which it misses.
- If NO candidate satisfies a critical requirement, add it to the \`## Design Decisions Required\` section with the affected requirements and options.
- Do NOT silently downgrade a requirement to make a candidate fit — flag it as a design decision.
- Mark long-lead items with ★ (4-8 weeks) or ★★ (8+ weeks).
- Include a \`## Long-Lead Items (Order Now)\` section at the end to flag items that could delay the project.
- Datasheet source links use \`[link]\` as placeholder — the user fills in real URLs.
- Use clean plain-text units. DO NOT use LaTeX math formatting.
- You MUST write the final document to docs/BOM.md via the fs_write tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Bill of Materials (BOM):
1. Subsystem Coverage: Does every subsystem from the Architecture have a BOM section?
2. Requirement Coverage: Does every requirement have at least one candidate part listed?
3. Mismatch Flagging: Are requirements with no satisfying candidate explicitly flagged in the Design Decisions section?
4. Lead Time Awareness: Are lead times noted, especially for long-lead items?
5. No Silent Downgrades: Does the document avoid silently reducing requirements to fit available parts?`,
  secretSauceExamples: [bomSecretSauce]
};
```

- [ ] **Step 2: Run build to verify the file compiles**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/specialists/packages/bom/index.ts
git commit -m "feat: add BOM specialist with candidate parts, requirement satisfaction flags, long-lead markers, and design decisions"
```

---

### Task 8: Modify RTM Specialist — Per-Subsystem Traceability

**Files:**
- Modify: `src/specialists/packages/rtm/index.ts`

**Interfaces:**
- Consumes: Updated Requirements, BOM
- Produces: Per-subsystem RTM with Requirement SS-01.x references

- [ ] **Step 1: Read the current RTM specialist**

```bash
cat src/specialists/packages/rtm/index.ts
```

- [ ] **Step 2: Update the prerequisite**

Change `prerequisiteArtifactId` from `'REQUIREMENTS'` to `'BOM'`.

- [ ] **Step 3: Update the system prompt**

Change the Tool-Based Discovery to read `docs/REQUIREMENTS.md`, `docs/CAPABILITIES.md`, and `docs/BOM.md`. Update the Capability Ref column description to reference per-subsystem capability IDs (SS-01.a, SS-02.b).

- [ ] **Step 4: Run tests**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/specialists/packages/rtm/index.ts
git commit -m "feat: update RTM specialist for per-subsystem traceability, add BOM prerequisite"
```

---

### Task 9: Modify Milestones Specialist — Subsystem-Layered Milestones

**Files:**
- Modify: `src/specialists/packages/milestones/index.ts`

**Interfaces:**
- Consumes: Updated RTM
- Produces: MVC/IOC/FOC milestones per-subsystem layering

- [ ] **Step 1: Read the current milestones specialist**

```bash
cat src/specialists/packages/milestones/index.ts
```

- [ ] **Step 2: Update the system prompt**

Change the Progressive Capability Layering section to emphasize subsystem-based milestone phasing:
- **MVC:** Close the core subsystem loop (motor + controller + battery as a closed system — power-on, drive, stop)
- **IOC:** Add dashboard telemetry, onboard charging, safety interlocks, and operator interface
- **FOC:** Add PTO-driven implements, hydraulics, full weatherproofing, and enhanced UI

Also update the secret sauce example to reflect subsystem-layered milestones.

- [ ] **Step 3: Run tests**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/specialists/packages/milestones/index.ts
git commit -m "feat: update milestones for subsystem-layered phasing (MVC: core loop, IOC: dashboard+charging, FOC: implements+weatherproofing)"
```

---

### Task 10: Modify Test Plans Specialist — Subsystem Integration Tests

**Files:**
- Modify: `src/specialists/packages/testplans/index.ts`

**Interfaces:**
- Consumes: Updated Milestones
- Produces: TP-MVP/TP-IOC/TP-FOC procedures for subsystem integration

- [ ] **Step 1: Read the current testplans specialist**

```bash
cat src/specialists/packages/testplans/index.ts
```

- [ ] **Step 2: Update the system prompt**

Change the emphasis from component-level tests to subsystem integration tests. Add:
- Instructions to reference the ICD for interface parameters during test setup
- Each test procedure should verify that two or more subsystems work together (e.g., "TP-MVP-01: Motor-Controller-Battery Closed-Loop Power-On Test")
- The pass/fail thresholds should reference the ICD interface parameters where applicable

- [ ] **Step 3: Run tests**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/specialists/packages/testplans/index.ts
git commit -m "feat: update test plans for subsystem integration testing, reference ICD interface parameters"
```

---

### Task 11: Create Change Impact Analysis Specialist

**Files:**
- Create: `src/specialists/packages/change-impact/index.ts`

**Interfaces:**
- Consumes: `SpecialistPackage` interface, project state and document timestamps
- Produces: Change impact analysis report (not a saved document — returned as response text)

- [ ] **Step 1: Create the Change Impact Analysis specialist package file**

```typescript
import { SpecialistPackage } from '../../types.js';

export const changeImpactPackage: SpecialistPackage = {
  id: 'change-impact',
  name: 'Change Impact Analysis',
  description: 'Cross-cutting specialist that analyzes the impact of upstream document changes on downstream deliverables, flagging inconsistencies and recommending rework.',
  systemPrompt: `You are the Change Impact Analysis Specialist for STARN.
Your mission is to analyze the impact of changes made to upstream documents and flag which downstream documents need updating.

TRIGGER EVENTS:
You are invoked when:
1. The user explicitly asks: "/check-impact" or "What needs to change if I update X?"
2. The BOM specialist found no candidate part satisfying a requirement, triggering a design decision
3. The user has revised an upstream document and wants to know what cascading changes are needed

WORKFLOW:
1. **Tool-Based Discovery:** Use the \`fs_read\` tool to read the CURRENT version of all relevant documents from docs/.
2. **Document Comparison:** Read the \`state_read\` tool output to check artifact approval timestamps. Compare the updatedAt timestamps of upstream vs downstream documents.
3. **Impact Analysis:** For each downstream document, check if any of its content is inconsistent with the current upstream documents. Specifically:
   - If CONOPS changed: Check Architecture, ICD, Capabilities, Requirements, BOM for consistency with the new CONOPS
   - If Architecture changed: Check ICD, Capabilities, Requirements, BOM
   - If ICD changed: Check Capabilities, Requirements, BOM
   - If Capabilities changed: Check Requirements, BOM
   - If Requirements changed: Check BOM, RTM, Milestones, Test Plans
   - If BOM candidates changed: Check RTM, Milestones, Test Plans (for threshold changes)

OUTPUT FORMAT:
Respond with a structured analysis:

\`\`\`
## Change Impact Analysis

**Source of change:** [document name and section that changed]

**Affected documents:**
| Document | Status | Action Needed |
|---|---|---|
| docs/ARCHITECTURE.md | ✅ Up to date | No change |
| docs/ICD.md | ❌ Needs update | [specific interfaces affected] |
| ... | ... | ... |

**Recommended actions:**
1. [Action 1]
2. [Action 2]
...

**Design decisions triggered:**
- [Any design decisions that the change surfaces]
\`\`\`

CRITICAL RULES:
- Do NOT rewrite any documents yourself. You only flag inconsistencies and recommend actions.
- The user decides which specialists to re-run based on your analysis.
- Be specific about which sections/interfaces/requirements are affected — not just "needs review".
- If a change cascades to a design decision (e.g., voltage change invalidates all BOM candidates), say so clearly.`,
  allowedTools: ['fs_read', 'fs_list', 'state_read', 'example_reader'],
  requiresCritic: false,
  secretSauceExamples: []
};
```

- [ ] **Step 2: Run build to verify the file compiles**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/specialists/packages/change-impact/index.ts
git commit -m "feat: add Change Impact Analysis specialist for cross-cutting document inconsistency detection"
```

---

### Task 12: Update Core Runner for New Prerequisite Chain and BOM Feedback Loop

**Files:**
- Modify: `src/core/runner.ts`

**Interfaces:**
- Consumes: All new specialists, updated workflow phases
- Produces: Updated runner with correct prerequisite checks, BOM feedback loop handling

- [ ] **Step 1: Read the current runner.ts**

```bash
cat src/core/runner.ts
```

- [ ] **Step 2: Update the prerequisite check gate**

The existing prerequisite check in `executeTurn` uses `specialist.prerequisiteArtifactId` and `stateManager.isArtifactApproved()`. Since the new phases have correct prerequisite IDs (ARCHITECTURE, ICD, BOM, etc.), the existing logic should work — but verify that the `isArtifactApproved` method handles the new IDs correctly.

The `isArtifactApproved` method in state.ts normalizes IDs to uppercase, so `'ARCHITECTURE'` will match `'architecture'` artifact IDs. This should work as-is.

- [ ] **Step 3: Add BOM feedback loop comment**

In the section after the critic while-loop (around line 250-300), add a comment block that documents the BOM feedback loop:

```typescript
// BOM FEEDBACK LOOP:
// When the BOM specialist finds no candidate part satisfying a requirement,
// it flags the requirement in the Design Decisions section of the BOM document.
// The user should then:
// 1. Review the design decisions
// 2. Either adjust the requirement (re-run Requirements specialist) or
//    accept an alternative part
// 3. Re-run the BOM specialist to confirm the updated candidates
// This is not automated — it requires human judgment.
```

- [ ] **Step 4: Run tests**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/core/runner.ts
git commit -m "feat: update runner for new prerequisite chain and BOM feedback loop documentation"
```

---

### Task 13: Delete WBS Specialist

**Files:**
- Delete: `src/specialists/packages/wbs/index.ts`
- Delete: `src/specialists/packages/wbs/` (directory, if empty)

**Interfaces:**
- Consumes: Nothing (removal only)
- Produces: Cleaned-up codebase

- [ ] **Step 1: Delete the WBS specialist file**

```bash
rm src/specialists/packages/wbs/index.ts
rmdir src/specialists/packages/wbs 2>/dev/null || true
```

- [ ] **Step 2: Run tests to verify nothing breaks**

```bash
npm test 2>&1 | tail -10
```

Note: The WBS import was removed from registry.ts in Task 1, so this should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/specialists/packages/wbs/
git commit -m "chore: remove WBS specialist (superseded by System Architecture + ICD + BOM)"
```

---

### Task 14: Final Test Suite Pass

**Files:**
- Modify: All test files that need final adjustments

**Interfaces:**
- Consumes: All completed tasks
- Produces: Green test suite

- [ ] **Step 1: Run the full test suite**

```bash
npm test 2>&1
```

- [ ] **Step 2: Fix any remaining test failures**

If any tests fail, investigate and fix them. Common issues:
- Tests expecting old phase ordering
- Tests checking specialist count
- Tests referencing WBS in any form
- Tests checking old prerequisite chains

- [ ] **Step 3: Run the build to verify TypeScript compilation**

```bash
npm run build 2>&1
```

- [ ] **Step 4: Commit any final test fixes**

```bash
git add tests/
git commit -m "test: update tests for new 10-phase workflow, per-subsystem numbering, and removed WBS"
```