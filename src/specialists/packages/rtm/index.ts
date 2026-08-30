import { SpecialistPackage } from '../../types.js';

const tractorRtmSecretSauce = `# Requirements Traceability & Verification Matrix (RTM): Electric Tractor

## 1.0 Verification Method Taxonomy
- **Inspect (I):** Visual, dimensional, or physical measurement verifying compliance with mechanical or electrical baselines.
- **Test (T):** Quantitative verification utilizing measurement instruments, meters, or load logging.
- **Demo (D):** Qualitative operational verification of a system function without specialized measurement logging.
- **Analysis (A):** Computational calculation, finite element simulation, or mass-balance modeling.

---

## 2.0 Traceability & Verification Matrix

| Capability Ref | Req ID | Requirement Statement | Method | Pass / Fail Acceptance Threshold |
| :--- | :--- | :--- | :--- | :--- |
| **Cap 4.a** | **Req 1.a** | Powertrain thermal operating range | Test | Continuous operation at 0°C to +45°C ambient with motor stator <= 110°C |
| **Cap 1.a** | **Req 1.b** | Total added conversion mass budget | Inspect | Total added motor + pack mass <= 130.0 kg (+/- 2.0 kg) |
| **CONOPS Outdoor** | **Req 1.c** | Enclosure ingress protection | Test | IP66 certified, 0 liquid or dust ingress observed |
| **Cap 2.a** | **Req 2.a** | DC traction bus operating voltage | Test | High-voltage bus operational between 60.0V and 84.0V DC |
| **Cap 1.a, 1.b** | **Req 2.b** | Continuous speed & stall torque envelope | Test | 0 to 3,500 RPM regulation with peak stall torque >= 60.0 Nm |
| **CONOPS 2-Acre** | **Req 2.c** | Continuous mowing operating runtime | Test | Delivers >= 90 minutes continuous mowing runtime on single full charge |
| **Cap 2.b** | **Req 3.a** | Onboard 120V AC battery charging | Test | Charges from 20% to 100% SOC from 120V AC 15A wall outlet in < 8.0 hours |
| **Cap 4.b** | **Req 3.b** | Emergency E-Stop power cutoff | Test | Contactor de-energizes and motor torque drops to 0 in < 20 ms |`;

const solarRtmSecretSauce = `# Requirements Traceability & Verification Matrix (RTM): Off-Grid Solar Enclosure

## 1.0 Verification Method Taxonomy
- **Inspect (I):** Physical or dimensional measurement verifying structural compliance.
- **Test (T):** Quantitative verification using instruments, power analyzers, or load banks.
- **Demo (D):** Operational verification of a system function.
- **Analysis (A):** Structural FEA, mass-balance, or thermal modeling calculations.

---

## 2.0 Traceability & Verification Matrix

| Capability Ref | Req ID | Requirement Statement | Method | Pass / Fail Acceptance Threshold |
| :--- | :--- | :--- | :--- | :--- |
| **Cap 2.a** | **Req 1.a** | Enclosure thermal operating range | Test | Internal ambient maintained 5°C to 35°C under -20°C to +45°C external extremes |
| **Cap 2.b** | **Req 1.b** | Exterior enclosure ingress protection | Test | NEMA 3R / IP65 certified, 0 water ingress observed |
| **CONOPS Weather** | **Req 1.c** | Structural roof snow & wind loading | Analysis | Deflection under 30 psf live load < L/240 across rafter span |
| **Cap 1.b** | **Req 2.a** | DC operating voltage envelope | Test | Operating voltage maintained between 42.0V DC and 58.4V DC |
| **Cap 1.c** | **Req 2.b** | Continuous AC power output & THD | Test | Delivers >= 5.0 kW continuous for 120 min with THD < 3.0% |`;

export const rtmPackage: SpecialistPackage = {
  id: 'rtm',
  name: 'Requirements Traceability Matrix (RTM)',
  description: 'Maps approved requirements to upstream capabilities and standard verification methods (Inspect, Test, Demo, Analysis) in a 100% tabular matrix.',
  prerequisiteArtifactId: 'REQUIREMENTS',
  systemPrompt: `You are the Requirements Traceability & Verification Specialist for STARN.
Your mission is to author a complete, 100% tabular Requirements Traceability Matrix (RTM) that maps each approved system requirement back to its upstream Capability and forward to an actionable verification method and acceptance threshold.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/REQUIREMENTS.md and docs/CAPABILITIES.md to verify all requirement statements, IDs, and capability references. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining how you will map 100% of the requirements into the matrix table.
3. **Execution & Traceability:** Execute each step in your running plan, populating the matrix with exact IDs and standard verification methods.

FORMATTING REQUIREMENTS (MANDATORY):
- The matrix MUST be formatted as a pure Markdown table with EXACTLY these columns:
  | Capability Ref | Req ID | Requirement Statement | Method | Pass / Fail Acceptance Threshold |
- **Capability Ref Column:** Must cite the upstream Capability ID (e.g. Cap 1.a, Cap 2.b) or CONOPS use case that originated the requirement.
- **Method Column:** MUST ONLY be chosen from the standard 4 verification methods: **Inspect, Test, Demo, Analysis**. (Do not detail specific shop tools or step-by-step procedures here; that belongs in Test Plans).
- Map 100% of the numbered requirements from docs/REQUIREMENTS.md.
- Use clean plain-text metrics. Do not use LaTeX math formatting.
- You MUST write the final document to docs/RTM.md via the fs_write tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Requirements Traceability Matrix (RTM):
1. 100% Upstream Traceability: Does every row cite its upstream Capability Ref (e.g. Cap 1.a) from the approved Capabilities baseline?
2. Standard 4 Verification Methods: Are verification methods strictly chosen from Inspect, Test, Demo, Analysis?
3. 100% Requirement Coverage: Does the table map every single numbered requirement from docs/REQUIREMENTS.md?
4. Objective Acceptance Thresholds: Are pass/fail criteria measurable, numeric thresholds (not vague qualitative statements)?
5. Plain-Text Formatting: Is the table free of raw LaTeX math strings?`,
  secretSauceExamples: [tractorRtmSecretSauce, solarRtmSecretSauce]
};
