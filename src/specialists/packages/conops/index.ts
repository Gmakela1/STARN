import { SpecialistPackage } from '../../types.js';

const conopsSecretSauce = `# Concept of Operations (CONOPS): Off-Grid Deployable Power Hub

## 1. Executive Summary & User Intent
The system provides autonomous, off-grid electrical power (minimum 3.5 kW continuous output, 48V DC bus, 120/240V AC split-phase) for remote field operations, research stations, or outdoor workshops. Primary user intent is zero-maintenance continuous operation under harsh meteorological conditions with rapid 1-day deployment.

## 2. Operational Environment & Physical Constraints
- **Geographic & Climate Range:** Ambient temperatures -20°C to +45°C, maximum sustained wind load 90 mph (3-second gust 110 mph), snow load 40 psf.
- **Footprint & Spatial Boundaries:** Maximum footprint 10 ft x 12 ft (120 sq ft) to comply with non-permitted auxiliary structure zoning.
- **Physical Envelope:** Height clearance 9.5 ft max. R-19 insulated envelope with positive-pressure HEPA ventilation to prevent dust ingress.

## 3. System Operational Modes
- **Mode 1: Normal Generation & Storage (Autonomous):** PV array feeds MPPT charge controllers; battery bank maintains 50%–95% SOC; inverter supplies scheduled loads.
- **Mode 2: Low-Solar / Winter Contingency:** Automated load shedding of non-critical auxiliary thermal loops; generator auto-start trigger at <20% SOC.
- **Mode 3: Maintenance & Isolation Mode:** Manual DC isolation disconnects, dual-pole AC bypass breaker engaged, zero-voltage verification points accessible.

## 4. Key Interfaces & Stakeholder Roles
- **Physical Interface:** Concrete pier foundation (6x 12-inch sonotube piers past frost line at 36 inches depth).
- **Electrical Interface:** Exterior NEMA 3R cam-lock quick-connect distribution panel.
- **Operator Profile:** Solo technician with standard mechanical hand tools and multimeter.`;

export const conopsPackage: SpecialistPackage = {
  id: 'conops',
  name: 'CONOPS & User Intent',
  description: 'Guides initial project discovery interview and drafts Concept of Operations, physical environment boundaries, operational modes, and user intent.',
  systemPrompt: `You are the CONOPS & Systems Architect Specialist for STARN.
Your mission is to produce a high-rigor Concept of Operations (CONOPS) document for physical/hardware projects.

INTAKE & DISCOVERY GUIDELINE (MANDATORY):
- If the project is in early discovery and does not yet have basic parameters defined, DO NOT invent a fictional project or draft a premature document.
- Follow the structured intake interview: ask guided questions one by one (starting with: 1. What is the project? 2. What is the core intent and goal?) and wait for the user's answers before synthesizing the draft.
- Ground all details strictly in the user's answers.

MANDATORY DOCUMENT SECTIONS:
1. Executive Summary & User Intent (What problem does it solve? Who uses it?)
2. Operational Environment & Physical Constraints (Dimensions, weather, thermal range, physical constraints)
3. System Operational Modes (Normal, degraded, emergency/maintenance)
4. System Boundaries & Interfaces (Physical mounting, electrical/power I/O, user controls)
5. Safety, Hazard Mitigation & Regulatory Standards

CRITICAL RULES:
- Use clean plain-text units (e.g. 72V, 15 kWh, 12 kW, -20°C to +45°C, 120 Nm/s).
- DO NOT use LaTeX math formatting ($\text{...}$).
- Write the final draft cleanly to docs/CONOPS.md or return complete markdown.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the CONOPS against these engineering criteria:
1. Physical Environment: Are environmental constraints (thermal range, wind/snow loads, spatial footprint) quantitatively specified?
2. Operational Modes: Are normal, contingency, and maintenance modes clearly defined?
3. User Intent Grounding: Is the document strictly grounded in user-provided intent rather than hallucinated fictional projects?
4. Plain-Text Units: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [conopsSecretSauce]
};
