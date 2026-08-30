import { SpecialistPackage } from '../../types.js';

const tractorRequirementsSecretSauce = `# System Requirements Specification: Electric Tractor Powertrain Conversion

## 1.0 Physical & Environmental Constraints
- **Requirement 1.a [Thermal Operating Range]:**
  - **Traced Capability:** 4.a [Operator Thermal Feedback] & CONOPS Subtropical Climate
  - **Statement:** The electric powertrain and control electronics shall maintain continuous operation across ambient temperatures of 0°C to +45°C without thermal shutdown.
  - **Metric / Tolerance:** 0°C to +45°C ambient; motor stator temperature <= 110°C.

- **Requirement 1.b [Powertrain Mass Budget]:**
  - **Traced Capability:** 1.a [Chassis Mounting & Alignment]
  - **Statement:** The total installed mass of electric motor, inverter, and battery pack shall not exceed 130.0 kg to preserve OEM axle weight distribution.
  - **Metric / Tolerance:** <= 130.0 kg total added mass (+/- 2.0 kg).

- **Requirement 1.c [Ingress Protection]:**
  - **Traced Capability:** CONOPS Outdoor Turf & Dusty Field Operations
  - **Statement:** All high-voltage enclosures, motor casings, and electronic throttle sensors shall meet IP66 dust-tight and water-jet ingress protection.
  - **Metric / Tolerance:** IP66 certified enclosure sealing.

## 2.0 Electrical & Mechanical Constraints
- **Requirement 2.a [DC Traction Bus Operating Voltage]:**
  - **Traced Capability:** 2.a [Traction Battery Enclosure]
  - **Statement:** The high-voltage traction bus shall operate between 60.0V DC (0% SOC cutoff) and 84.0V DC (100% float charge).
  - **Metric / Tolerance:** Nominal 72.0V DC; operational range 60.0V to 84.0V DC.

- **Requirement 2.b [Starting Torque & Speed Envelope]:**
  - **Traced Capability:** 1.a [Proportional Speed] & 1.b [Low-End Starting Torque]
  - **Statement:** The motor and inverter shall deliver continuous speed regulation from 0 to 3,500 RPM with peak stall torque >= 60.0 Nm.
  - **Metric / Tolerance:** 0 to 3,500 RPM (+/- 25 RPM); stall torque >= 60.0 Nm.

- **Requirement 2.c [Continuous Operating Runtime]:**
  - **Traced Capability:** CONOPS 2-Acre Mowing Routine
  - **Statement:** The battery pack shall deliver >= 90 minutes continuous operating runtime under normal mowing load on a single full charge.
  - **Metric / Tolerance:** >= 90 minutes continuous discharge at nominal load.

## 3.0 Charging & Safety Subsystems
- **Requirement 3.a [Onboard 120V AC Charging]:**
  - **Traced Capability:** 2.b [Onboard AC Charging]
  - **Statement:** The onboard charger shall recharge the traction battery from 20% to 100% SOC from a standard 120V AC 15A outlet in < 8 hours.
  - **Metric / Tolerance:** Input: 120V AC (+/- 10%), 15A max; Charge duration < 8.0 hours.

- **Requirement 3.b [Emergency High-Voltage Cutoff]:**
  - **Traced Capability:** 4.b [Emergency Rapid Power Cutoff]
  - **Statement:** Striking the emergency stop switch shall de-energize the main traction contactor and drop motor torque to 0 within < 20 milliseconds.
  - **Metric / Tolerance:** Contact opening time < 20 ms.`;

const solarRequirementsSecretSauce = `# System Requirements Specification: Off-Grid Solar Power & Work Enclosure

## 1.0 Environmental & Structural Constraints
- **Requirement 1.a [Thermal Operating Range]:**
  - **Traced Capability:** 2.a [Thermostatic Airflow Regulation]
  - **Statement:** The power electronics and battery enclosure shall maintain continuous operation across external ambient temperatures of -20°C to +45°C.
  - **Metric / Tolerance:** Internal ambient maintained between 5°C and 35°C under -20°C to +45°C external extremes.

- **Requirement 1.b [Enclosure Ingress Protection]:**
  - **Traced Capability:** 2.b [Physical Security & Ingress Seal]
  - **Statement:** Exterior electrical enclosures and conduit penetrations shall meet NEMA 3R / IP65 water-spray and dust-tight resistance.
  - **Metric / Tolerance:** NEMA 3R / IP65 certified.

- **Requirement 1.c [Structural Snow & Wind Loading]:**
  - **Traced Capability:** CONOPS Outdoor Severe Weather Resilience
  - **Statement:** The physical frame and roof mounting shall support 30 psf live snow load and 90 mph 3-second gust wind load.
  - **Metric / Tolerance:** 30 psf snow load; 90 mph sustained gust.

## 2.0 Electrical & Power Specifications
- **Requirement 2.a [DC Traction & Inverter Bus]:**
  - **Traced Capability:** 1.b [Energy Storage & Balancing]
  - **Statement:** The DC bus shall operate between 42.0V DC (0% SOC cut-off) and 58.4V DC (100% float charge).
  - **Metric / Tolerance:** Nominal 48.0V DC (42.0V to 58.4V DC range).

- **Requirement 2.b [Continuous AC Power Output]:**
  - **Traced Capability:** 1.c [Power Inversion & Split-Phase AC]
  - **Statement:** The inverter shall supply 5.0 kW continuous split-phase 120/240V AC power with total harmonic distortion < 3.0%.
  - **Metric / Tolerance:** 5.0 kW continuous; THD < 3.0%.`;

export const requirementsPackage: SpecialistPackage = {
  id: 'requirements',
  name: 'System Requirements',
  description: 'Translates product capabilities into formal, quantifiable engineering requirements with explicit capability traceability.',
  prerequisiteArtifactId: 'CAPABILITIES',
  systemPrompt: `You are the System Requirements Specialist for STARN.
Your mission is to translate approved product capabilities and CONOPS decisions into formal, quantifiable engineering requirements.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/CAPABILITIES.md and docs/CONOPS.md to verify established capabilities and operational context. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining the specific steps you will take to inspect information, trace decisions, and draft these requirements.
3. **Execution & Traceability:** Execute each step in your running plan, grounding all drafted items directly in the verified facts read from prior files.

THE COLLABORATIVE SUGGESTION RULE (MANDATORY):
- Requirements MUST be grounded strictly in the approved Capabilities, CONOPS, and user decisions.
- DO NOT invent unconfirmed third-party components or brands unless established in the baseline.
- If a critical physical constraint or safety threshold is missing (e.g., maximum fuse rating or wiring ampacity), PROACTIVELY SUGGEST IT to the user and ask: "Should we add a requirement for X?"

NUMBERING & FORMATTING SCHEMA (MANDATORY):
Structure requirements under clear domain headings (e.g., ## 1.0 Physical & Environmental Constraints, ## 2.0 Electrical & Mechanical Constraints).
Format each requirement as **Requirement 1.a**, **Requirement 1.b**, **Requirement 2.a** with:
- **Requirement X.y [Descriptive Title]:**
  - **Traced Capability:** Explicit Capability ID (e.g. 1.a, 2.b) or CONOPS use case.
  - **Statement:** Formal normative requirement statement ("shall...").
  - **Metric / Tolerance:** Quantitative numerical threshold (temperatures, voltages, weight budgets, tolerances, speeds, durations).

CRITICAL RULES:
- Use clean plain-text units (e.g. 72V, 15 kWh, 12 kW, -20°C to +45°C, 120 Nm/s).
- DO NOT use LaTeX math formatting like $\\text{...}$.
- DO NOT duplicate requirements in a redundant end table (the RTM specialist will build the dedicated traceability matrix in the next phase).
- You MUST write the final document to docs/REQUIREMENTS.md via the fs_write tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the System Requirements document:
1. Upstream Capability Traceability: Does every requirement cite its Traced Capability from the approved Capabilities document?
2. Quantifiable Precision: Are physical parameters, electrical tolerances, and thermal limits quantitatively specified with unambiguous metrics?
3. Numbering Format: Are requirements formatted as Requirement 1.a, Requirement 1.b with bold descriptive titles?
4. Non-Redundant Structure: Is the document formatted as an engineering specification without a redundant duplicated matrix table?
5. Plain-Text Metrics: Is the document free of raw LaTeX math strings and formatted with clean plain-text units?`,
  secretSauceExamples: [tractorRequirementsSecretSauce, solarRequirementsSecretSauce]
};
