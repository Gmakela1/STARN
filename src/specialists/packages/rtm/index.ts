import { SpecialistPackage } from '../../types.js';

const rtmSecretSauce = `# Requirements Traceability & Verification Matrix (RTM)

## 1.0 Verification Method Taxonomy
- **Test (T):** Quantitative verification utilizing dedicated measurement equipment, load banks, or dynamometers.
- **Inspection (I):** Visual, dimensional, or physical measurement verifying compliance with mechanical or electrical standards.
- **Analysis (A):** Computational calculation, finite element simulation, or thermal modeling.
- **Demonstration (D):** Qualitative operational verification of a system function without specialized measurement logging.

---

## 2.0 Traceability & Verification Matrix

| Req ID | Requirement Summary | Method | Required Tooling / Setup | Quantitative Pass/Fail Threshold |
| :--- | :--- | :--- | :--- | :--- |
| **Requirement 1.a** | Thermal Operating Range | Test | Walk-in climatic chamber / Thermocouple logger | Continuous operation at -20°C and +45°C for 60 min with 0 thermal faults |
| **Requirement 1.b** | Enclosure Ingress Protection | Test | Water spray nozzle / Dust box | IP65 certified, 0 liquid or dust ingress observed |
| **Requirement 1.c** | Structural Snow Load | Analysis | Structural FEA & lumber deflection calculation | Deflection under 30 psf load < L/240 across roof span |
| **Requirement 2.a** | Operating DC Bus Voltage | Test | Fluke Multimeter & BMS CAN logger | Operating voltage maintained between 42.0V DC and 58.4V DC |
| **Requirement 2.b** | Continuous AC Power Delivery | Test | 5 kW Resistive Load Bank & Power Analyzer | Delivers >= 5.0 kW continuous for 120 min with THD < 3.0% |
| **Requirement 2.c** | Total Equipment Mass Budget | Inspection | Platform scale / Crane load cell | Total weight <= 250.0 kg (+/- 2.0 kg) |`;

export const rtmPackage: SpecialistPackage = {
  id: 'rtm',
  name: 'Requirements Traceability Matrix (RTM)',
  description: 'Maps approved requirements to verification methods, required tooling, and pass/fail thresholds in a 100% tabular matrix.',
  prerequisiteArtifactId: 'REQUIREMENTS',
  systemPrompt: `You are the Requirements Traceability & Verification Specialist for STARN.
Your mission is to author a complete, 100% tabular Requirements Traceability Matrix (RTM) that maps each approved system requirement to an actionable verification method, test equipment, and pass/fail criteria.

COLLABORATIVE USER TOOLING GUIDANCE:
- If you do not yet know what test equipment the user owns or has access to, ask them:
  "What test equipment and facility resources do you have access to? (e.g. Multimeter, Oscilloscope, Load Bank, Dynamometer, Scales, Thermal Camera, Pressure Gauges, Field Test Track)"
- Adapt the tooling column to reflect tools the user actually has or standard practical shop equipment.

FORMATTING REQUIREMENTS (MANDATORY):
- The matrix MUST be formatted as a pure Markdown table with these columns:
  | Req ID | Requirement Summary | Method | Required Tooling / Setup | Quantitative Pass/Fail Threshold |
- Map EVERY requirement from docs/REQUIREMENTS.md (Requirement 1.a, Requirement 1.b, etc.).
- Use clean plain-text metrics. Do not use LaTeX math formatting.
- Write the final document to docs/RTM.md or return complete markdown.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Requirements Traceability Matrix (RTM):
1. Tabular Matrix Structure: Is the document structured as a clean, complete markdown table with Req ID, Summary, Method, Tooling, and Pass/Fail Thresholds?
2. 100% Requirement Coverage: Does the table map every single numbered requirement from the requirements baseline?
3. Objective Thresholds: Are pass/fail criteria measurable, numeric thresholds (not vague qualitative statements)?
4. Plain-Text Formatting: Is the table free of raw LaTeX math strings?`,
  secretSauceExamples: [rtmSecretSauce]
};
