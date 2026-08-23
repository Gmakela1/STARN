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
- **Standardized Numbering (`1.a` / `Requirement 1.a`):**
  - **Capabilities:** Functional traits formatted as `1.a`, `1.b`, `2.a`.
  - **Requirements:** Quantifiable constraints formatted as `Requirement 1.a`, `Requirement 1.b`.
  - Clean plain-text units (`72V`, `-20°C to +45°C`, `12 kW`, `120 Nm/s`), clean ASCII block diagrams, and zero raw LaTeX math strings (`$\text{...}$`).
- **Dedicated Gated `RTM` Specialist Package:**
  - Cannot be invoked until `CAPABILITIES.md` and `REQUIREMENTS.md` exist and are approved.
  - Interviews the user regarding available test equipment (dyno, multimeter, thermal camera, pressure gauges, test track) and constructs a complete Requirements Traceability Matrix.
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

## 3. Standardized Formatting & Numbering Schema

### A. Capabilities Schema (`1.a`, `1.b`, `2.a`)
Capabilities represent **functional character traits** describing what the system does, organized by functional domain:

```markdown
## 1.0 Powertrain & Speed Regulation
- **1.a [Variable Speed Throttle Control]:** The system provides smooth, continuous forward and reverse vector motor control from 0 to 3,000 RPM via electronic foot pedal.
- **1.b [Low-End Starting Torque]:** The motor delivers high starting torque for heavy ground-engagement and towing without stalling.

## 2.0 Energy Storage & Power Management
- **2.a [Modular Battery Enclosure]:** The battery system provides sealed, removable energy storage with active cell monitoring.
- **2.b [Regenerative Braking Deceleration]:** Deceleration energy is captured and returned to the battery during pedal lift-off.
```

### B. Requirements Schema (`Requirement 1.a`, `Requirement 1.b`)
Requirements represent **quantifiable constraints, physical tolerances, and operating thresholds**:

```markdown
## 1.0 Environmental & Operational Limits
- **Requirement 1.a [Thermal Operating Range]:** The powertrain shall operate continuously across ambient temperatures of -20°C to +45°C without thermal shutdown.
- **Requirement 1.b [Ingress Protection]:** All electronics and high-voltage enclosures shall meet IP66 dust-tight and water-jet ingress standards.

## 2.0 Electrical & Mechanical Constraints
- **Requirement 2.a [DC Bus Operating Voltage]:** The high-voltage traction bus shall operate between 60.0V DC (cut-off) and 84.0V DC (maximum charge).
- **Requirement 2.b [Powertrain Mass Budget]:** Total weight of installed motor, inverter, and battery pack shall not exceed 130 kg to preserve vehicle stability.
- **Requirement 2.c [CAN Telemetry Rate]:** Motor controller and BMS telemetry shall broadcast over CAN bus at 500 kbps with a 10 Hz minimum update rate.
```

---

## 4. Dedicated `RTM` Specialist Package

- **Package ID:** `rtm`
- **Name:** Requirements Traceability & Verification Matrix
- **Prerequisites:** `docs/CAPABILITIES.md` or `docs/REQUIREMENTS.md` must exist and be marked `approved` in `.starn/state.json`.
- **Gating Rule:** If the user requests RTM before requirements are approved, STARN responds:
  *"Requirements have not yet been approved. Please complete and approve the Capabilities & Requirements phase before building the Requirements Traceability Matrix."*
- **User Tooling Intake:** The RTM specialist asks the user:
  *"What test equipment and facility resources do you have access to? (e.g., Multimeter, Oscilloscope, Dynamometer, Thermal Camera, Torque Wrench, Field Test Track, Load Bank)"*
- **Deliverable (`docs/RTM.md`):**
  A complete matrix mapping each numbered requirement to:
  1. Requirement ID (`Requirement 1.a`)
  2. Requirement Statement
  3. Verification Method (`Test`, `Inspection`, `Analysis`, `Demonstration`)
  4. Specific Test Procedure & Available Equipment
  5. Quantitative Pass/Fail Threshold

---

## 5. Multi-Turn Session Memory & Clean Output Management

1. **Session Memory:**
   `CoreRunner` maintains a `ChatMessage[]` transcript across user turns in the active session. If the user says *"That CONOPS is for a different project, this is a tractor conversion"*, the agent maintains context, clears the mistaken premise, and updates `state.json` and files accordingly.

2. **Artifact Content Extraction & Clean Saving:**
   - In `checkpoint.ts`, when saving `docs/<SPECIALIST>.md`, STARN inspects if the specialist generated a clean markdown deliverable (surrounded by `#` headers or markdown code fences).
   - Conversational preambles (e.g. *"Here is your updated document..."*) are stripped before saving to disk.

3. **Terminal UI Streamlining:**
   - Small turns (intake questions, status updates): Displayed directly in clear, colored text.
   - Large deliverables (>50 lines): Render a clean document summary box and critic scorecard, with a choice to view the full text or accept/revise directly.

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
