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