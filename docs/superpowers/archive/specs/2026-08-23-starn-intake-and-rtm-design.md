# STARN Intake Workflow, RTM Specialist & UI Enhancement Specification

**Date:** 2026-08-23  
**Status:** Validated Design  
**Context:** Lessons learned from physical project trial runs (Tractor EV conversion).

---

## 1. Problem Statement & Objectives

During initial testing of STARN on an electric tractor conversion project, four operational gaps were identified:
1. **Unprompted Generation / Premature Drafting:** The agent immediately authored a generic document (e.g., MAPIU-100) on empty projects rather than interviewing the user to understand project intent and domain parameters.
2. **Hallucinated Hardware Specifications:** The requirements specialist invented unapproved vendor part numbers (e.g., Motenergy ME1115, Kelly KLS) without user confirmation.
3. **Missing Multi-Turn Conversation Memory:** When the user corrected errors in chat, turns were treated as isolated queries and prior hallucinated files on disk contaminated context.
4. **Terminal Output Overflow & Packaging Mixup:** Large 500-line documents flooded the terminal on every turn, and conversational commentary was occasionally written directly into project markdown files.

### Objectives for this Release:
- **Dynamic 1-by-1 Intake Interview:** Automatically initiates on empty/new projects. Starts with *1. What is the project?* and *2. What is the intent?*, followed by 3–5 adaptive one-by-one guiding questions before drafting the CONOPS.
- **Strict Grounding & Anti-Hallucination Guardrails:** Requirements must ground strictly to user statements. Hardware recommendations must be presented conversationally or kept vendor-agnostic unless confirmed by the user.
- **Standardized Numbering & Document Formats:**
  - **Capabilities (`1.a`, `1.b`):** Structured bullet format with bold functional character traits.
  - **Requirements (`Requirement 1.a`, `Requirement 1.b`):** Detailed numbered bullets with engineering precision, accompanied by a scannable summary table.
  - **RTM (`docs/RTM.md`):** 100% Markdown Tabular format mapping each requirement to verification method, available tooling, and quantitative thresholds.
  - Clean plain-text units (`72V`, `-20°C to +45°C`, `12 kW`, `120 Nm/s`), clean ASCII block diagrams, and zero raw LaTeX math strings (`$\text{...}$`).
- **Dedicated Gated `RTM` Specialist Package:**
  - Cannot be invoked until `CAPABILITIES.md` and `REQUIREMENTS.md` exist and are approved.
  - Interviews the user regarding available test equipment (dyno, multimeter, thermal camera, pressure gauges, test track) and constructs a complete Requirements Traceability Matrix table.
- **Multi-Turn Session Memory & Discovery Clean-Up:** Full conversational transcript persists across turns during a session.
- **Streamlined Terminal UI:** Clean markdown rendering for conversations, and collapsible preview / scorecard / view-full-draft prompts for large deliverables.

---

## 2. Intake Workflow & State Transitions

### Intake Progression (CONOPS Kickoff)
When STARN detects that no approved `CONOPS.md` exists:

```
[New / Empty Project]
         │
         ▼
[Phase 1: Project Initiation]
Question 1: "What is the project?"
   (User replies: e.g. "Converting a 19HP diesel lawn tractor to an electric battery powertrain")
         │
         ▼
Question 2: "What is the primary intent and operational goal of the project?"
   (User replies: e.g. "Mow 2 acres on a single charge and tow small yard trailers without fumes")
         │
         ▼
[Phase 2: Adaptive 1-by-1 Domain Questions (3 to 5 iterations)]
- Question 3 (e.g., Target speed, torque, or driveline interfaces) -> User answers
- Question 4 (e.g., Battery voltage/capacity target, charging preferences) -> User answers
- Question 5 (e.g., Environmental conditions, temperature extremes, weatherproofing) -> User answers
- Question 6 (Optional/Final: Key safety interlocks, e-stop, deadman switch) -> User answers
         │
         ▼
[Phase 3: CONOPS Synthesis & Drafting]
Agent generates grounded CONOPS draft -> Harsh Critic evaluates -> Checkpoint review.
```

### Intake Tracking in `state.json`
```json
{
  "intake": {
    "completed": false,
    "currentQuestionIndex": 2,
    "answers": {
      "projectName": "Electric Tractor Conversion",
      "projectIntent": "Mow 2 acres on a single charge and tow small yard trailers",
      "driveline": "Direct-drive to OEM transaxle spline",
      "batteryTarget": "48V or 72V LiFePO4, 3-4 kWh",
      "operatingEnvironment": "-10°C to +40°C, dusty outdoor use"
    }
  }
}
```

---

## 3. Standardized Formatting & Document Schemas

### A. Capabilities Schema (`docs/CAPABILITIES.md`)
Formatted as **structured numbered bullets** detailing behavioral and functional character traits:

```markdown
# Product Capabilities: Electric Tractor Powertrain Conversion

## 1.0 Powertrain & Drive Control
- **1.a [Variable Speed Throttle Control]:** The motor controller provides proportional, smooth speed regulation from 0 to 3,000 RPM via electronic foot pedal in forward and reverse.
- **1.b [Low-End Starting Torque]:** The system delivers high starting torque from 0 RPM to pull ground-engagement implements without stalling.

## 2.0 Energy Storage & Power Management
- **2.a [Modular Battery Enclosure]:** The battery system provides sealed, vibration-isolated energy storage with cell balancing and thermal monitoring.
- **2.b [Regenerative Deceleration]:** Kinetic energy is captured during accelerator lift-off, smoothly decelerating the vehicle while returning charge to the battery.
```

### B. Requirements Schema (`docs/REQUIREMENTS.md`)
Formatted as **detailed numbered bullets** for engineering specifics, followed by a **scannable summary table**:

```markdown
# System Requirements Specification: Electric Tractor Powertrain Conversion

## 1.0 Physical & Environmental Constraints
- **Requirement 1.a [Thermal Operating Range]:** The powertrain shall operate continuously across ambient temperatures of -20°C to +45°C without thermal shutdown.
- **Requirement 1.b [Ingress Protection]:** All electronics, motor housings, and battery enclosures shall meet IP66 dust-tight and water-jet ingress standards.

## 2.0 Electrical & Mechanical Constraints
- **Requirement 2.a [DC Bus Operating Voltage]:** The high-voltage traction bus shall operate between 60.0V DC (0% SOC cut-off) and 84.0V DC (100% SOC float).
- **Requirement 2.b [Powertrain Mass Budget]:** Total weight of installed motor, inverter, and battery pack shall not exceed 130.0 kg to maintain OEM axle weight distribution.

---

### Requirements Summary Matrix
| Req ID | Parameter | Nominal Metric | Operating Envelope / Tolerance |
| :--- | :--- | :--- | :--- |
| **Req 1.a** | Ambient Temperature | 20°C | -20°C to +45°C |
| **Req 1.b** | Enclosure Ingress | IP66 | Washdown & dust-tight |
| **Req 2.a** | DC Bus Voltage | 72.0V DC | 60.0V to 84.0V DC |
| **Req 2.b** | Total Conversion Mass | 125.0 kg | Maximum 130.0 kg (±2.0 kg) |
```

### C. Requirements Traceability Matrix Schema (`docs/RTM.md`)
Formatted as a **100% Markdown Tabular Matrix** tailored to available user tooling:

```markdown
# Requirements Traceability & Verification Matrix (RTM)

| Req ID | Requirement Summary | Method | Required Tooling / Setup | Quantitative Pass/Fail Threshold |
| :--- | :--- | :--- | :--- | :--- |
| **Req 1.a** | Thermal Operating Range | Test | Climatic walk-in chamber / Thermal logger | Continuous operation at -20°C & +45°C for 60 min |
| **Req 1.b** | Ingress Protection | Test | Water spray nozzle / Dust box | IP66 certified, 0 liquid penetration observed |
| **Req 2.a** | Traction DC Voltage | Inspection | Fluke Multimeter & CAN logger | Bus voltage between 60.0V and 84.0V DC |
| **Req 2.b** | Powertrain Mass Budget | Inspection | Crane scale / Platform balance | Total installed weight <= 130.0 kg (+/- 2.0 kg) |
```

---

## 4. Dedicated `RTM` Specialist Package

- **Package ID:** `rtm`
- **Name:** Requirements Traceability Matrix (RTM)
- **Prerequisites:** `docs/CAPABILITIES.md` and `docs/REQUIREMENTS.md` must exist and be approved in `.starn/state.json`.
- **Gating Rule:** If invoked before requirements are approved, STARN responds:
  *"Requirements have not yet been approved. Please complete and approve Capabilities and Requirements before building the Requirements Traceability Matrix."*
- **User Tooling Intake:** The RTM specialist asks the user:
  *"What test equipment and facility resources do you have access to? (e.g., Multimeter, Oscilloscope, Dynamometer, Thermal Camera, Torque Wrench, Field Test Track, Load Bank)"*
- **Deliverable:** `docs/RTM.md`

---

## 5. Multi-Turn Session Memory & Clean Output Management

1. **Session Memory:**
   `CoreRunner` maintains a `ChatMessage[]` transcript across user turns in the active session. If the user says *"That CONOPS is for a different project, this is a tractor conversion"*, the agent maintains context, clears the mistaken premise, and updates `state.json` and files accordingly.

2. **Artifact Content Extraction & Clean Saving:**
   - In `checkpoint.ts`, when saving `docs/<SPECIALIST>.md`, STARN inspects if the specialist generated a clean markdown deliverable (surrounded by `#` headers or markdown code fences).
   - Conversational preambles (e.g. *"Here is your updated document..."*) are stripped before saving to disk.

3. **Terminal UI Streamlining:**
   - Small turns (intake questions, status updates): Displayed directly in clear, colored text.
   - Large deliverables (>50 lines): Render a clean document summary box and critic scorecard, with an interactive choice to view the full text or accept/revise directly.

---

## 6. Updated Specialist Matrix

| Package ID | Prerequisite | Gated Tools | Critic Enabled | Output Document |
| :--- | :--- | :--- | :--- | :--- |
| `general` | None | `fs_read`, `fs_list`, `state_read`, `example_reader` | No | None (Chat) |
| `conops` | None (Guides Intake if empty) | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes (Draft stage only) | `docs/CONOPS.md` |
| `capabilities` | Approved `CONOPS.md` | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes | `docs/CAPABILITIES.md` |
| `requirements` | Approved `CAPABILITIES.md` | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes | `docs/REQUIREMENTS.md` |
| `rtm` | Approved `REQUIREMENTS.md` | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes | `docs/RTM.md` |
| `milestones` | Approved `CONOPS.md` | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes | `docs/MILESTONES.md` |
| `wbs` | Approved `REQUIREMENTS.md` | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes | `docs/WBS.md` |
| `sow` | Approved `WBS.md` | `fs_read`, `fs_write`, `fs_list`, `state_read`, `state_update`, `example_reader` | Yes | `docs/SOW.md` |
