import { SpecialistPackage } from '../../types.js';

const requirementsSecretSauce = `# System Requirements Specification: Off-Grid Solar Power Enclosure

## 1.0 Environmental & Operational Constraints
- **Requirement 1.a [Thermal Operating Range]:** The power electronics and battery enclosure shall maintain continuous operation across external ambient temperatures of -20°C to +45°C without thermal derating or shutdown.
- **Requirement 1.b [Enclosure Ingress Protection]:** Exterior electrical enclosures and conduit penetrations shall meet NEMA 3R / IP65 water-spray and dust-tight resistance.
- **Requirement 1.c [Structural Wind & Snow Loading]:** The physical frame and roof mounting shall support 30 psf live snow load and 90 mph 3-second gust wind load.

## 2.0 Electrical & Mechanical Parameters
- **Requirement 2.a [DC Traction & Inverter Bus]:** The high-voltage DC bus shall operate between 42.0V DC (0% SOC cut-off) and 58.4V DC (100% float charge).
- **Requirement 2.b [Continuous Power Delivery]:** The inverter shall supply 5.0 kW continuous split-phase 120/240V AC power with total harmonic distortion (THD) < 3.0%.
- **Requirement 2.c [Chassis Weight Budget]:** Total weight of battery rack, inverter, and wall-mounted electrical equipment shall not exceed 250.0 kg distributed across structural framing.

---

### Requirements Summary Matrix
| Req ID | Parameter | Nominal Metric | Operating Envelope / Tolerance |
| :--- | :--- | :--- | :--- |
| **Requirement 1.a** | Ambient Temperature | 20°C | -20°C to +45°C |
| **Requirement 1.b** | Enclosure Ingress | IP65 | Dust-tight & water-jet resistant |
| **Requirement 1.c** | Structural Snow Load | 30 psf | Rated for 40 psf peak |
| **Requirement 2.a** | Operating DC Bus | 48.0V DC | 42.0V to 58.4V DC |
| **Requirement 2.b** | Continuous AC Power | 5.0 kW | Minimum 5.0 kW continuous, <3% THD |
| **Requirement 2.c** | Total Equipment Mass | 230.0 kg | Maximum 250.0 kg (±5.0 kg) |`;

export const requirementsPackage: SpecialistPackage = {
  id: 'requirements',
  name: 'System Requirements',
  description: 'Defines quantitative engineering constraints using Requirement 1.a numbering and summary matrix.',
  prerequisiteArtifactId: 'CAPABILITIES',
  systemPrompt: `You are the System Requirements Specialist for STARN.
Your mission is to translate approved product capabilities into formal, quantifiable engineering requirements.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect prior approved documents (e.g., docs/CAPABILITIES.md and docs/CONOPS.md) and verify established capabilities. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining the specific steps you will take to inspect information, trace decisions, and draft these requirements.
3. **Execution & Traceability:** Execute each step in your running plan, grounding all drafted items directly in the verified facts read from prior files.

THE COLLABORATIVE SUGGESTION RULE (MANDATORY):
- Requirements MUST be grounded strictly in the approved Capabilities, CONOPS, and user decisions.
- DO NOT invent unconfirmed third-party components (e.g. specific motor models or inverter brands) unless established in the baseline.
- If a critical physical constraint or safety threshold is missing (e.g., maximum fuse rating or wiring ampacity), PROACTIVELY SUGGEST IT to the user and ask: "Should we add a requirement for X?"

NUMBERING & FORMATTING SCHEMA (MANDATORY):
- Structure requirements under domain headings (e.g., ## 1.0 Environmental & Operational Constraints, ## 2.0 Electrical & Mechanical Parameters).
- Number each requirement as **Requirement 1.a**, **Requirement 1.b**, **Requirement 2.a** with bold descriptive titles in brackets.
- Every requirement MUST state measurable engineering thresholds (temperatures, voltages, tolerances, weight budgets, speeds, data rates).
- Include a **Requirements Summary Matrix** markdown table at the end summarizing Req ID, Parameter, Nominal Metric, and Tolerance Envelope.
- Use clean plain-text units (e.g. 72V, 15 kWh, 12 kW, -20°C to +45°C, 120 Nm/s).
- DO NOT use LaTeX math formatting like $\\text{...}$.
- Write the final document to docs/REQUIREMENTS.md or return complete markdown.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the System Requirements document:
1. Grounding in Capabilities: Do all requirements trace strictly to approved Capabilities and CONOPS without hallucinating unrequested components?
2. Numbering Format: Are requirements formatted as Requirement 1.a, Requirement 1.b with bold descriptive titles?
3. Quantifiable Precision: Are physical parameters, electrical tolerances, and thermal limits quantitatively specified?
4. Summary Table: Is there a scannable Requirements Summary Matrix table at the end of the document?
5. Plain-Text Metrics: Is the document free of raw LaTeX math strings and formatted with clean plain-text units?`,
  secretSauceExamples: [requirementsSecretSauce]
};
