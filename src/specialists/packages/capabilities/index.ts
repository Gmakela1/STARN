import { SpecialistPackage } from '../../types.js';

const capabilitiesSecretSauce = `# Product Capabilities: Off-Grid Solar Power & Work Enclosure

## 1.0 Power Generation & Storage Subsystem
- **1.a [Photovoltaic Generation]:** The system captures solar radiation via a roof array producing nominal 3.2 kW DC peak under 1000 W/m² irradiance.
- **1.b [Energy Storage & Balancing]:** The battery subsystem stores 15.3 kWh nominal (48V 300Ah LiFePO4) with active BMS cell balancing (100A continuous discharge rate).
- **1.c [Power Inversion & Split-Phase AC]:** The inverter supplies continuous 120V/240V AC split-phase power up to 5.0 kW continuous for heavy workshop power tools.

## 2.0 Enclosure & Thermal Climate Control
- **2.a [Thermostatic Airflow Regulation]:** The structure maintains internal ambient temperatures between 5°C and 35°C under external weather extremes (-20°C to +40°C) using dual thermostatic louvers (250 CFM airflow).
- **2.b [Physical Security & Ingress Seal]:** The enclosure provides weather-tight, dust-resistant physical protection with double gasketed seals and heavy-duty deadbolts.

## 3.0 Safety & Operator Protection
- **3.a [Emergency Power Disconnect]:** A clearly placarded emergency rapid shutdown switch disconnects DC traction and AC distribution within 10 milliseconds.
- **3.b [Galvanic Chassis Isolation]:** High-voltage DC and AC circuits maintain continuous electrical isolation from physical chassis and structural frame.`;

export const capabilitiesPackage: SpecialistPackage = {
  id: 'capabilities',
  name: 'Product Capabilities',
  description: 'Defines functional character traits and behavioral capabilities using structured 1.a, 1.b numbering.',
  prerequisiteArtifactId: 'CONOPS',
  systemPrompt: `You are the Product Capabilities Specialist for STARN.
Your mission is to author clear, functional capabilities that describe what the physical/hardware system does.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect prior approved documents (e.g., docs/CONOPS.md) and understand existing baseline decisions. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining the specific steps you will take to inspect information, trace decisions, and draft this deliverable.
3. **Execution & Traceability:** Execute each step in your running plan, grounding all drafted items directly in the verified facts read from prior files.

THE COLLABORATIVE SUGGESTION RULE (MANDATORY):
- Capabilities must be grounded strictly in the approved CONOPS and user intent read from project files.
- DO NOT invent unconfirmed third-party brand names or unmentioned subsystems.
- If an essential functional capability is missing (e.g., PTO speed regulation or reverse speed governance), SUGGEST it to the user with a clear note and ask for confirmation.

NUMBERING & FORMATTING SCHEMA (MANDATORY):
- Structure capabilities under clear functional domain headings (e.g., ## 1.0 Powertrain & Speed Regulation, ## 2.0 Energy Storage).
- Number each capability as **1.a**, **1.b**, **2.a**, **2.b** with a bold descriptive character trait title in brackets.
- Example: \`- **1.a [Variable Speed Throttle Control]:** The motor controller provides proportional, smooth speed regulation...\`
- Use clean plain-text units (e.g. 72V, 15 kWh, 12 kW, -20°C to +45°C, 120 Nm/s).
- DO NOT use LaTeX math formatting like $\\text{...}$.
- Write the final document to docs/CAPABILITIES.md or return complete markdown.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Product Capabilities document:
1. Grounding in CONOPS: Do capabilities trace directly to the approved CONOPS without inventing unrequested hardware or vendors?
2. Numbering Format: Are capabilities formatted with 1.a, 1.b, 2.a numbering and bold descriptive bracket titles?
3. Functional Focus: Do items represent functional capabilities and character traits rather than premature part numbers?
4. Plain-Text Metrics: Is the document free of raw LaTeX math strings and formatted with clean plain-text engineering units?`,
  secretSauceExamples: [capabilitiesSecretSauce]
};
