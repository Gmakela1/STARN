import { SpecialistPackage } from '../../types.js';

const capabilitiesSecretSauce = `# Product Capabilities: Electric Tractor Powertrain Conversion

## 1.0 Traction Motor Subsystem (SS-01)
- **SS-01.a [Proportional Speed & Direction Control]:** The traction motor subsystem provides smooth, continuous forward and reverse speed regulation modulated via an electronic foot pedal.
- **SS-01.b [Low-End Starting Torque Delivery]:** The motor delivers immediate low-end torque to pull ground-engagement implements and trailers from a dead stop without stalling.

## 2.0 Battery Subsystem (SS-02)
- **SS-02.a [Integrated Traction Energy Storage]:** The battery subsystem provides sealed, vibration-isolated electrical storage with continuous cell monitoring and balancing.
- **SS-02.b [Onboard AC Charging]:** The battery subsystem accepts charge from the integrated onboard charger.

## 3.0 Motor Controller Subsystem (SS-03)
- **SS-03.a [DC-to-AC Power Inversion]:** The controller converts DC battery power to variable-frequency AC for the traction motor.
- **SS-03.b [Current Limiting & Thermal Protection]:** The controller limits output current to protect the motor and battery during overload conditions.

## 4.0 HV Distribution & Safety Subsystem (SS-04)
- **SS-04.a [Emergency Rapid Power Cutoff]:** A prominent, hardwired emergency stop switch allows the operator to instantly de-energize the high-voltage traction drive.
- **SS-04.b [Automatic Fault Isolation]:** The system automatically opens the HV path on short circuit or detected fault.

## 5.0 Dashboard / Operator Interface Subsystem (SS-05)
- **SS-05.a [Real-Time Status Display]:** The dash console provides the operator with real-time feedback on battery state of charge, operating status, and thermal warnings.

## 6.0 Chassis Integration Subsystem (SS-06)
- **SS-06.a [Component Mounting & Packaging]:** The chassis provides structurally integrated mounting points for all powertrain components within the retained frame envelope.

## 7.0 PTO / Hydraulic Interface Subsystem (SS-07)
- **SS-07.a [Constant-Speed PTO Implement Drive]:** The PTO subsystem provides regulated, constant-speed rotational power to operate standard rear implements under variable load.`;

export const capabilitiesPackage: SpecialistPackage = {
  id: 'capabilities',
  name: 'Product Capabilities',
  description: 'Defines functional character traits and behavioral capabilities using structured 1.a, 1.b numbering.',
  prerequisiteArtifactId: 'ARCHITECTURE',
  systemPrompt: `You are the Product Capabilities Specialist for STARN.
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
- You MUST write the final document to docs/CAPABILITIES.md via the fs_write tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Product Capabilities document:
1. Per-Subsystem Coverage: Does the document define capabilities for every subsystem from the Architecture document?
2. Subsystem ID Tracing: Are capabilities numbered with subsystem IDs (SS-01.a, SS-01.b) rather than generic numbers?
3. Pure Functional & Behavioral Focus: Are capabilities purely functional/behavioral without premature numeric tolerances?
4. ICD Interface References: Do capabilities reference ICD interfaces where relevant?
5. Plain-Text Descriptions: Is the document free of raw LaTeX math strings and formatted cleanly?`,
  secretSauceExamples: [capabilitiesSecretSauce]
};
