import { SpecialistPackage } from '../../types.js';

const milestonesSecretSauce = `# Project Milestones & Gating Criteria: Electric Tractor Powertrain Conversion

## Milestone 1: MVC (Minimum Viable Capability - Powertrain Mounting & Drive)
- **Objective:** Mount electric motor and controller to donor tractor transmission, wire core traction battery, and verify basic vehicle movement under its own power.
- **Active Capabilities:**
  - 1.a [Motor Mounting & Concentric Alignment]
  - 1.b [Basic Throttle Control & Vehicle Movement]
  - 2.a [Core Traction Battery Pack]
- **Requirements & Acceptance Gates (Must pass before IOC):**
  - **Requirement 1.b [Powertrain Mass Budget]:** Total added conversion weight <= 130.0 kg (Method: Inspect).
  - **Requirement 2.a [DC Bus Operating Voltage]:** Traction bus operational between 60.0V and 84.0V DC with >= 500 kΩ chassis isolation (Method: Test).
  - **Requirement 2.b [Basic Drive Movement]:** Motor powers ON/OFF from key switch and drives vehicle forward and reverse at 0–1,500 RPM, stopping safely on service brakes (Method: Demo).
- **Evolution / Upgrade Path:** Speed envelope is restricted to 1,500 RPM open-loop for baseline move testing; full 3,500 RPM FOC closed-loop control, 120V charging, and implement PTO governing are unlocked in IOC and FOC.

---

## Milestone 2: IOC (Initial Operational Capability - Telemetry, Safety & Charging)
- **Objective:** Install driver dashboard with essential telemetry, integrate 120V AC onboard charging, and deploy primary safety interlocks for daily work.
- **Active Capabilities:**
  - 1.c [Regenerative Braking Deceleration]
  - 2.b [Integrated 120V AC Onboard Charger]
  - 3.a [Dashboard Telemetry Display]
  - 3.b [Emergency E-Stop Safety Interlock]
- **Requirements & Acceptance Gates (Must pass before FOC):**
  - **Requirement 1.a [Thermal Operating Range]:** Continuous operation across 0°C to +40°C ambient without thermal derating (Method: Test).
  - **Requirement 2.c [Continuous Operating Runtime]:** Delivers >= 90 minutes continuous mowing/towing on single charge (Method: Test).
  - **Requirement 3.a [Onboard 120V Charging]:** Charges full battery pack from standard 120V AC 15A wall outlet in < 8 hours (Method: Test).
  - **Requirement 3.b [Emergency Shutdown]:** Hardwired E-Stop cuts main contactor and motor torque in < 20 ms (Method: Test).
- **Evolution / Upgrade Path:** Dashboard displays core numeric voltage/SOC; upgraded to full graphical color UI, thermal data logging, and implement controls in FOC.

---

## Milestone 3: FOC (Full Operational Capability - Auxiliary Implements, Enhanced UI & Weatherproofing)
- **Objective:** Deploy auxiliary PTO and hydraulic implement power, enhanced graphical telemetry UI, and full Florida climate weatherproofing (IP66).
- **Active Capabilities:**
  - 1.d [Constant-Speed 540 RPM PTO Implement Drive]
  - 2.c [Auxiliary 12V DC-DC Converter & Hydraulic Drive]
  - 3.c [Sunlight-Readable Custom Graphical Display UI]
  - 4.a [Full Weatherproofing & Moisture Defense]
- **Requirements & Acceptance Gates:**
  - **Requirement 1.c [Ingress Protection]:** IP66 certified washdown and dust-tight resistance (Method: Test).
  - **Requirement 1.a [Full Thermal Operating Range]:** Continuous operation across full -10°C to +45°C ambient envelope (Method: Test).
  - **Requirement 2.d [PTO Speed Regulation]:** 540 RPM PTO held to within +/- 2.0% (+/- 10 RPM) under implement load steps (Method: Test).
  - **Requirement 3.c [Graphical Telemetry & Logging]:** Real-time power kW, cell delta mV, motor RPM, and thermal data logging (Method: Demo).
  - **Requirement 1.b [Axle Load Balance]:** Static axle weight distribution calculated within +/- 5% of OEM design (Method: Analysis).
- **Evolution / Upgrade Path:** Full realization of all CONOPS capabilities and 100% of RTM requirement rows verified and closed.`;

export const milestonesPackage: SpecialistPackage = {
  id: 'milestones',
  name: 'Project Milestones & Gating',
  description: 'Formulates progressive capability milestones (MVC -> IOC -> FOC) with consolidated requirements and standard verification methods (Inspect, Test, Demo, Analysis).',
  prerequisiteArtifactId: 'RTM',
  systemPrompt: `You are the Project Phasing & Milestone Gating Specialist for STARN.
Your mission is to formulate progressive capability milestones (MVC -> IOC -> FOC) by bucketing approved Capabilities, Requirements, and RTM verification gates into evolving developmental phases.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/RTM.md, docs/REQUIREMENTS.md, and docs/CAPABILITIES.md to verify all requirement IDs, verification methods, and pass/fail thresholds.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining how you will layer capabilities and requirements into MVC, IOC, and FOC stages.
3. **Execution & Traceability:** Execute each step in your running plan, linking milestone gating requirements directly to RTM items.

PROGRESSIVE CAPABILITY LAYERING (MANDATORY):
Milestones MUST be structured as an evolving capability ladder where each phase increases system capability and operational complexity:
1. **Milestone 1: MVC (Minimum Viable Capability):**
   - Focus: Core physical mounting, power-on, and basic movement under own power (e.g. motor turns on/off, vehicle moves forward/reverse).
2. **Milestone 2: IOC (Initial Operational Capability):**
   - Focus: Operational baseline (dashboard, essential sensors/telemetry, integrated charging, and primary safety interlocks for daily work).
3. **Milestone 3: FOC (Full Operational Capability):**
   - Focus: Complete feature set (auxiliary implements, PTO, hydraulics, enhanced graphical displays/logging, and full weatherproofing).

CONSOLIDATED MILESTONE STRUCTURE (MANDATORY):
To avoid duplication, DO NOT create separate "Key Deliverables" and "Gating Criteria" lists. Consolidate into:
- **Objective:** Clear operational statement of what the machine can do in this phase.
- **Active Capabilities:** Explicit list of Capability IDs (e.g. 1.a, 1.b) active in this phase.
- **Requirements & Acceptance Gates (Must pass before next phase):**
  - Bulleted list of each Requirement ID (e.g. Requirement 1.a, Requirement 2.a), the applicable phase threshold, and the verification method in parentheses.
  - **Verification Method Rule:** The method MUST ONLY be chosen from the 4 standard methods: **Inspect, Test, Demo, Analysis** (do not describe detailed test procedures or tools here; that belongs in Test Plans).
- **Evolution / Upgrade Path:** Explicitly describe any minimum baseline criteria in this phase that will be upgraded or expanded in subsequent milestones.

CRITICAL RULES:
- DO NOT refer to phases as generic numbers (e.g., Phase 1, Phase 2). Use **MVC, IOC, FOC**.
- Use clean plain-text units. DO NOT use LaTeX math formatting.
- Write the final document to docs/MILESTONES.md or return complete markdown.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Milestones & Gating Criteria document:
1. Progressive Capability Layering: Are MVC, IOC, and FOC structured as an expanding ladder of capabilities (from basic power/movement -> essential safety/monitoring -> full implements & UI)?
2. Consolidated Structure: Is the document consolidated (without repetitive separate deliverables & gating lists), featuring a unified "Requirements & Acceptance Gates" section?
3. Standard 4 Verification Methods: Are verification methods strictly chosen from Inspect, Test, Demo, Analysis?
4. Evolution / Upgrade Path: Does each phase clearly explain what minimum criteria exist and how they will be upgraded in future milestones?
5. Plain-Text Units: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [milestonesSecretSauce]
};
