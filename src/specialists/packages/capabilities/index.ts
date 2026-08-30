import { SpecialistPackage } from '../../types.js';

const capabilitiesSecretSauce = `# Product Capabilities: Electric Utility Tractor Conversion

## 1.0 Powertrain & Traction Drive
- **1.a [Proportional Speed & Direction Control]:** The motor controller provides smooth, continuous forward and reverse speed regulation modulated via an electronic foot pedal.
- **1.b [Low-End Starting Torque Delivery]:** The electric motor delivers immediate low-end torque to pull ground-engagement implements and trailers from a dead stop without stalling.
- **1.c [Regenerative Deceleration]:** Kinetic energy is captured during throttle pedal lift-off, smoothly decelerating the vehicle while returning energy to the battery system.

## 2.0 Energy Storage & Charging
- **2.a [Integrated Traction Energy Storage]:** The battery system provides sealed, vibration-isolated electrical storage with continuous cell monitoring and balancing.
- **2.b [Onboard AC Charging]:** The system features an integrated onboard charger allowing the vehicle to recharge directly from standard utility electrical outlets.

## 3.0 Auxiliary Implements & Work Equipment
- **3.a [Constant-Speed PTO Implement Drive]:** The driveline provides regulated, constant-speed rotational power to operate standard rear implements (mower decks, tillers, post hole diggers) under variable load.
- **3.b [Hydraulic Implement Actuation]:** The system powers front loader hydraulics for lifting and dumping materials.

## 4.0 Operator Interface & Safety
- **4.a [Real-Time Driver Dashboard]:** The dash console provides the operator with real-time feedback on battery state of charge, operating status, and thermal warnings.
- **4.b [Emergency Rapid Power Cutoff]:** A prominent, hardwired emergency stop switch allows the operator to instantly de-energize the high-voltage traction drive in hazardous situations.`;

export const capabilitiesPackage: SpecialistPackage = {
  id: 'capabilities',
  name: 'Product Capabilities',
  description: 'Defines functional character traits and behavioral capabilities using structured 1.a, 1.b numbering.',
  prerequisiteArtifactId: 'CONOPS',
  systemPrompt: `You are the Product Capabilities Specialist for STARN.
Your mission is to author clear, functional capabilities that describe WHAT the physical/hardware system does (functional abilities and behavioral character traits).

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect prior approved documents (e.g., docs/CONOPS.md) and understand existing baseline decisions. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining the specific steps you will take to inspect information, trace decisions, and draft this deliverable.
3. **Execution & Traceability:** Execute each step in your running plan, grounding all drafted items directly in the verified facts read from prior files.

FUNCTIONAL & BEHAVIORAL TRAITS (MANDATORY):
- Describe functional abilities, behavioral character traits, and subsystem functions (WHAT the system does).
- DO NOT embed rigid numeric tolerances, exact wattage/voltage thresholds, or timing formulas (e.g., do not say '12.4 kW at 1000 W/m²' or 'within 10 ms'). Save quantitative metrics for the subsequent Requirements phase.
- Capabilities must be grounded strictly in the approved CONOPS and user intent read from project files.
- DO NOT invent unconfirmed third-party brand names or unmentioned subsystems.
- If an essential functional capability is missing (e.g., PTO speed regulation or reverse speed governance), SUGGEST it to the user with a clear note and ask for confirmation.

NUMBERING & FORMATTING SCHEMA (MANDATORY):
- Structure capabilities under clear functional domain headings (e.g., ## 1.0 Powertrain & Traction Drive, ## 2.0 Energy Storage & Charging).
- Number each capability as **1.a**, **1.b**, **2.a**, **2.b** with a bold descriptive character trait title in brackets.
- Example: \`- **1.a [Proportional Speed & Direction Control]:** The motor controller provides smooth, continuous forward and reverse speed regulation...\`
- Use clean plain-text descriptions. DO NOT use LaTeX math formatting like $\\text{...}$.
- You MUST write the final document to docs/CAPABILITIES.md via the fs_write tool. AND you MUST return the complete document content in your final response — do NOT replace it with a summary or commentary.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Product Capabilities document:
1. Pure Functional & Behavioral Focus: Does the document describe functional abilities and operational traits without premature numeric tolerances, timing formulas, or requirement metrics?
2. Grounding in CONOPS: Do capabilities trace directly to the approved CONOPS without inventing unrequested hardware or vendors?
3. Numbering Format: Are capabilities formatted with 1.a, 1.b, 2.a numbering and bold descriptive bracket titles?
4. Plain-Text Descriptions: Is the document free of raw LaTeX math strings and formatted cleanly?`,
  secretSauceExamples: [capabilitiesSecretSauce]
};
