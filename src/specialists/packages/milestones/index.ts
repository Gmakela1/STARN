import { SpecialistPackage } from '../../types.js';

const milestonesSecretSauce = `# Project Milestones & Gating Criteria: Modular Workshop & Microgrid

## Phase 1: MVP (Minimum Viable Product - Structural & Dry Shell)
- **Objective:** Establish weather-tight, structurally sound physical enclosure capable of accepting equipment.
- **Key Deliverables:**
  - Concrete sonotube foundation poured and cured past 28-day 3000 PSI strength.
  - Floor platform (pressure-treated 2x8) and 2x6 walls framed and sheathed with 1/2" CDX.
  - Standing seam metal roof installed with ice & water shield underlayment.
- **Gating Criteria (Must pass before Phase 2):**
  - [ ] Plumb and square verification within 1/8" across diagonals.
  - [ ] Foundation anchor pull-out test / torque inspection passed.
  - [ ] Continuous hose water-spray envelope integrity test (30 minutes, 0 leaks observed).

## Phase 2: IOC (Initial Operational Capability - Core Power & Inverter)
- **Objective:** Deploy core electrical power subsystem and energize internal 120V circuits.
- **Key Deliverables:**
  - 8x 400W solar panels mounted on Unirac rails and bonded to ground rod.
  - 48V Inverter/Charger and 15kWh LiFePO4 battery bank wired with 250A Class-T fuse.
  - Sub-panel wired with 4x 20A GFCI branch circuits.
- **Gating Criteria (Must pass before Phase 3):**
  - [ ] DC grounding impedance test < 25 Ohms to earth ground.
  - [ ] 4-hour continuous 3.0 kW load test with thermal imaging on busbars (<45°C rise).
  - [ ] Rapid shutdown switch de-energizes PV array to <30V in under 10 seconds.

## Phase 3: FOC (Full Operational Capability - Automation & Monitoring)
- **Objective:** Full deployment of remote telemetry, automated ventilation, and auxiliary loads.
- **Key Deliverables:**
  - ESP32 / Modbus automated temperature-triggered 250 CFM ventilation shutter.
  - Remote cloud telemetry dashboard reporting real-time power, SOC, and ambient temperature.
- **Gating Criteria:**
  - [ ] 72-hour unattended endurance run with automated telemetry logging.
  - [ ] Commissioning punch-list 100% closed with owner sign-off.`;

export const milestonesPackage: SpecialistPackage = {
  id: 'milestones',
  name: 'Milestones & Gating Criteria',
  description: 'Defines phased development gates (MVP, IOC, FOC), milestone deliverables, and strict pass/fail acceptance criteria.',
  prerequisiteArtifactId: 'CONOPS',
  systemPrompt: `You are the Project Phasing & Milestone Gating Specialist for STARN.
Your mission is to formulate structured milestones and rigorous gating criteria for hardware/construction projects.

MANDATORY PHASES:
1. Minimum Viable Product (MVP): Foundational structural/mechanical shell and safety baseline.
2. Initial Operational Capability (IOC): Functional core systems energized, primary capability operational.
3. Full Operational Capability (FOC): Integrated controls, telemetry, secondary optimizations, and final commissioning.

CRITICAL RULES:
- Every phase must contain explicit Objectives, Key Deliverables, and Gating Criteria.
- Gating criteria MUST be objective, testable checklist items (e.g. pressure tests, torque checks, electrical load endurance) that must be validated before moving to the next phase.
- Use clean plain-text units. DO NOT use LaTeX math formatting.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Milestones & Gating Criteria document:
1. Phased Structure: Are MVP, IOC, and FOC phases distinctly defined with clear boundary objectives?
2. Objective Gating: Are gating criteria clear, measurable pass/fail checks (not subjective sentiments)?
3. Risk Mitigation: Does earlier phase gating prevent costly re-work in later electrical/mechanical stages?
4. Plain-Text Units: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [milestonesSecretSauce]
};
