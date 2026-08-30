import { SpecialistPackage } from '../../types.js';

const tractorRequirementsSecretSauce = `# System Requirements Specification: Electric Tractor Powertrain Conversion

## 1.0 Traction Motor Subsystem (SS-01)
- **Requirement SS-01.a [Continuous Power Rating]:**
  - **Traced Capability:** SS-01.a [Proportional Speed & Direction Control]
  - **Statement:** The traction motor shall deliver 6.0 kW continuous power at nominal system voltage.
  - **Metric / Tolerance:** 6.0 kW continuous, 12.0 kW peak (30 seconds).

- **Requirement SS-01.b [Speed Range]:**
  - **Traced Capability:** SS-01.a [Proportional Speed & Direction Control]
  - **Statement:** The motor shall operate from 0 to 3,500 RPM with smooth speed regulation.
  - **Metric / Tolerance:** 0-3,500 RPM, +/- 50 RPM steady-state.

- **Requirement SS-01.c [Thermal Operating Range]:**
  - **Traced Capability:** SS-01.c [Thermal Tolerance]
  - **Statement:** The motor shall maintain continuous operation across ambient temperatures of 0°C to +45°C without thermal derating.
  - **Metric / Tolerance:** 0°C to +45°C ambient; motor stator temperature <= 110°C.

## 2.0 Battery Subsystem (SS-02)
- **Requirement SS-02.a [Energy Capacity]:**
  - **Traced Capability:** SS-02.a [Integrated Traction Energy Storage]
  - **Statement:** The battery pack shall store sufficient energy for 1 hour of continuous mowing.
  - **Metric / Tolerance:** >= 5.0 kWh usable capacity.

- **Requirement SS-02.b [Charge Time]:**
  - **Traced Capability:** SS-02.b [Onboard AC Charging]
  - **Statement:** The battery shall charge from 20% to 100% SOC via 120V 15A outlet.
  - **Metric / Tolerance:** < 8 hours.

## 3.0 Motor Controller Subsystem (SS-03)
- **Requirement SS-03.a [DC Bus Voltage Range]:**
  - **Traced Capability:** SS-03.a [DC-to-AC Power Inversion]
  - **Statement:** The controller shall operate from a DC bus voltage range of 60.0V to 84.0V DC.
  - **Metric / Tolerance:** 60.0V to 84.0V DC, nominal 72.0V.

- **Requirement SS-03.b [Continuous Current Rating]:**
  - **Traced Capability:** SS-03.b [Current Limiting & Thermal Protection]
  - **Statement:** The controller shall supply 120A continuous output current to the traction motor.
  - **Metric / Tolerance:** 120A continuous, 250A peak (30 seconds).

## 4.0 HV Distribution & Safety Subsystem (SS-04)
- **Requirement SS-04.a [Emergency Cutoff Time]:**
  - **Traced Capability:** SS-04.a [Emergency Rapid Power Cutoff]
  - **Statement:** The emergency stop shall de-energize the main contactor and drop motor torque to 0 within 20 milliseconds.
  - **Metric / Tolerance:** Contact opening time < 20 ms.

- **Requirement SS-04.b [Isolation Resistance]:**
  - **Traced Capability:** SS-04.b [Automatic Fault Isolation]
  - **Statement:** The HV bus shall maintain >= 500 kOhm isolation resistance to chassis ground.
  - **Metric / Tolerance:** >= 500 kOhm (0.5 MOhm).

## 5.0 Dashboard Subsystem (SS-05)
- **Requirement SS-05.a [Status Display]:**
  - **Traced Capability:** SS-05.a [Real-Time Status Display]
  - **Statement:** The dashboard shall display battery state-of-charge, motor temperature, and fault codes.
  - **Metric / Tolerance:** SOC +/- 5% accuracy, fault code display within 1 second.`;

const solarRequirementsSecretSauce = `# System Requirements Specification: Off-Grid Solar Power & Work Enclosure

## 1.0 Enclosure Subsystem (SS-01)
- **Requirement SS-01.a [Thermal Operating Range]:**
  - **Traced Capability:** SS-01.a [Thermal Regulation]
  - **Statement:** The power electronics enclosure shall maintain continuous operation across external ambient temperatures of -20°C to +45°C.
  - **Metric / Tolerance:** Internal ambient maintained between 5°C and 35°C under -20°C to +45°C external extremes.

- **Requirement SS-01.b [Enclosure Ingress Protection]:**
  - **Traced Capability:** SS-01.b [Weather Seal]
  - **Statement:** Exterior electrical enclosures and conduit penetrations shall meet NEMA 3R / IP65 water-spray and dust-tight resistance.
  - **Metric / Tolerance:** NEMA 3R / IP65 certified.

- **Requirement SS-01.c [Structural Loading]:**
  - **Traced Capability:** SS-01.c [Structural Integrity]
  - **Statement:** The physical frame and roof mounting shall support 30 psf live snow load and 90 mph 3-second gust wind load.
  - **Metric / Tolerance:** 30 psf snow load; 90 mph sustained gust.

## 2.0 Power Subsystem (SS-02)
- **Requirement SS-02.a [DC Bus Voltage]:**
  - **Traced Capability:** SS-02.a [Energy Storage & Balancing]
  - **Statement:** The DC bus shall operate between 42.0V DC (0% SOC cut-off) and 58.4V DC (100% float charge).
  - **Metric / Tolerance:** Nominal 48.0V DC (42.0V to 58.4V DC range).

- **Requirement SS-02.b [Continuous AC Power Output]:**
  - **Traced Capability:** SS-02.b [Power Inversion]
  - **Statement:** The inverter shall supply 5.0 kW continuous split-phase 120/240V AC power with total harmonic distortion < 3.0%.
  - **Metric / Tolerance:** 5.0 kW continuous; THD < 3.0%.`;

export const requirementsPackage: SpecialistPackage = {
  id: 'requirements',
  name: 'System Requirements',
  description: 'Translates product capabilities into formal, quantifiable engineering requirements with explicit capability traceability.',
  prerequisiteArtifactId: 'CAPABILITIES',
  systemPrompt: `You are the System Requirements Specialist for STARN.
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
- You MUST write the final document to docs/REQUIREMENTS.md via the fs_write tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the System Requirements document:
1. Upstream Capability Traceability: Does every requirement cite its Traced Capability from the approved Capabilities document (SS-01.a, SS-02.b)?
2. Quantifiable Precision: Are physical parameters, electrical tolerances, and thermal limits quantitatively specified with unambiguous metrics?
3. Per-Subsystem Numbering: Are requirements formatted as Requirement SS-01.a, Requirement SS-01.b with bold descriptive titles?
4. ICD Consistency: Are requirements consistent with ICD interface parameters, with design decisions flagged where they exceed ICD limits?
5. Plain-Text Metrics: Is the document free of raw LaTeX math strings and formatted with clean plain-text units?`,
  secretSauceExamples: [tractorRequirementsSecretSauce, solarRequirementsSecretSauce]
};
