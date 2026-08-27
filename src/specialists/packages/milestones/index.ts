import { SpecialistPackage } from '../../types.js';

const milestonesSecretSauce = `# Project Milestones & Gating Criteria: Electric Tractor Powertrain Conversion

## Phase 1: MVP / MVC (Minimum Viable Capability - Powertrain Mounting & Drive)
- **Phase Objective:** Mount electric motor and controller to donor tractor transmission, wire core traction battery, and verify basic vehicle movement under its own power.
- **Relevant Active Capabilities:**
  - 1.a [Motor Mounting & Concentric Alignment]
  - 1.b [Basic Throttle Control & Vehicle Movement]
  - 2.a [Core Traction Battery Pack]
- **Relevant RTM Requirements & Baseline Thresholds:**
  - Requirement 1.b [Powertrain Mass Budget]: Installed motor + pack <= 130 kg (Inspection).
  - Requirement 2.a [DC Bus Operating Voltage]: Traction bus operational between 60.0V and 84.0V DC (Test).
  - Requirement 2.b [Starting & Low-End Speed]: Motor delivers rotational speed 0 to 1,500 RPM open-loop in forward and reverse (Test).
- **Evolution / Upgrade Path:** Speed envelope is limited to 1,500 RPM for initial baseline testing; full 3,500 RPM FOC vector control and PTO governing unlocked in IOC/FOC.
- **Key Deliverables:**
  - Machined bellhousing adapter plate and 4140 chromoly splined coupler installed.
  - Electric motor secured to chassis rails; controller mounted with heatsink.
  - High-voltage traction battery pack secured with 250A Class-T fuse and manual disconnect.
  - Electronic foot throttle wired to controller 0-5V input.
- **Gating Criteria (Must pass before Phase 2):**
  - [ ] Bellhousing runout inspection <= 0.05 mm concentricity verified (Inspection).
  - [ ] High-voltage isolation check >= 500 kOhm to chassis ground (Test).
  - [ ] Motor powers ON/OFF reliably from key switch (Demonstration).
  - [ ] Tractor drives forward and reverse under its own power and stops on mechanical service brakes (Demonstration).

## Phase 2: IOC (Initial Operational Capability - Core Monitoring, Safety & Charging)
- **Phase Objective:** Install driver dashboard with essential telemetry, integrate 120V AC onboard charging, and deploy primary safety interlocks for daily work.
- **Relevant Active Capabilities:**
  - 1.c [Regenerative Braking Deceleration]
  - 2.b [Integrated 120V AC Onboard Charger]
  - 3.a [Dashboard Telemetry Display]
  - 3.b [Emergency E-Stop Safety Interlock]
- **Relevant RTM Requirements & Upgraded Thresholds:**
  - Requirement 1.a [Thermal Operating Range]: Continuous operation across 0°C to +40°C ambient (Test).
  - Requirement 2.c [Continuous Operating Runtime]: Delivers >= 90 minutes continuous mowing/towing on single charge (Test).
  - Requirement 3.a [Onboard 120V Charging]: Charges full battery pack from 120V AC 15A outlet in < 8 hours (Test).
  - Requirement 3.b [Emergency Shutdown]: Hardwired E-Stop cuts motor torque in < 20 ms (Test).
- **Evolution / Upgrade Path:** Dashboard displays essential SOC/Voltage gauges; advanced graphical UI, data logging, and implement controls upgrade in FOC.
- **Key Deliverables:**
  - Functional dash cluster installed with battery SOC %, DC voltage, and motor temperature warning LED.
  - 120V AC onboard charger and exterior charging inlet wired to battery pack.
  - Red emergency mushroom E-Stop button installed on dash console.
  - Sealed battery lid and drip-proof wiring harnesses installed.
- **Gating Criteria (Must pass before Phase 3):**
  - [ ] E-Stop de-energizes main traction contactor in < 20 ms under active throttle (Test).
  - [ ] 120V AC charge cycle charges battery to 100% SOC with automatic float cutoff (Test).
  - [ ] 90-minute continuous yard mowing/towing endurance test completed without thermal fault (Test).

## Phase 3: FOC (Full Operational Capability - Auxiliary Implements, Enhanced UI & Weatherproofing)
- **Phase Objective:** Deploy auxiliary PTO and hydraulic implement power, enhanced graphical telemetry UI, and full Florida climate weatherproofing (IP66).
- **Relevant Active Capabilities:**
  - 1.d [Constant-Speed 540 RPM PTO Implement Drive]
  - 2.c [Auxiliary 12V DC-DC Converter & Hydraulic Drive]
  - 3.c [Sunlight-Readable Custom Graphical Display UI]
  - 4.a [Full Weatherproofing & Moisture Defense]
- **Relevant RTM Requirements & Full Thresholds:**
  - Requirement 1.c [Ingress Protection]: IP66 washdown and dust-tight certification (Test).
  - Requirement 1.a [Full Thermal Range]: Full continuous duty across -10°C to +45°C ambient (Test).
  - Requirement 2.d [PTO Speed Regulation]: 540 RPM PTO held to within +/- 2.0% under implement load steps (Test).
  - Requirement 3.c [Graphical Telemetry]: Real-time power kW, cell delta mV, motor RPM, and thermal logging (Demonstration).
- **Key Deliverables:**
  - Rear PTO motor / drive engagement wired with dedicated 540 RPM governor mode.
  - Front loader hydraulic pump motor drive wired and tested under bucket lift loads.
  - Sunlight-readable color LCD dashboard displaying real-time power, battery cell voltages, and thermal telemetry.
  - Conformal coating applied to all control electronics; IP66 enclosure seals finalized.
- **Gating Criteria:**
  - [ ] Rear PTO drives mower deck under heavy grass load maintaining 540 RPM +/- 10 RPM (Test).
  - [ ] Front loader lifts rated 500 lb load without hydraulic pressure drop (Test).
  - [ ] 2-hour continuous field workload test in high ambient Florida heat (>35°C) with 0 thermal alarms (Test).
  - [ ] 100% of RTM requirement rows verified and closed with sign-off (Inspection).`;

export const milestonesPackage: SpecialistPackage = {
  id: 'milestones',
  name: 'Project Milestones & Gating',
  description: 'Formulates progressive capability milestones (MVP -> IOC -> FOC) with explicit RTM requirements, evolution paths, and gating criteria.',
  prerequisiteArtifactId: 'RTM',
  systemPrompt: `You are the Project Phasing & Milestone Gating Specialist for STARN.
Your mission is to formulate progressive capability milestones (MVP -> IOC -> FOC) by bucketing approved Capabilities, Requirements, and RTM verification gates into evolving developmental phases.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/RTM.md, docs/REQUIREMENTS.md, and docs/CAPABILITIES.md to verify all requirement IDs, verification methods, and pass/fail thresholds.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining how you will layer capabilities and requirements into MVP, IOC, and FOC stages.
3. **Execution & Traceability:** Execute each step in your running plan, linking milestone gating checklist items directly to RTM tests.

PROGRESSIVE CAPABILITY LAYERING (MANDATORY):
Milestones MUST be structured as an evolving capability ladder where each phase increases system capability and operational complexity:
1. **Phase 1: MVP / MVC (Minimum Viable Capability):**
   - Focus: Core physical mounting, power-on, and basic movement under own power (e.g. motor turns on/off, vehicle drives forward/reverse).
2. **Phase 2: IOC (Initial Operational Capability):**
   - Focus: Operational baseline (dashboard, essential sensors/telemetry, integrated charging, and primary safety interlocks for daily work).
3. **Phase 3: FOC (Full Operational Capability):**
   - Focus: Complete feature set (auxiliary implements, PTO, hydraulics, enhanced graphical displays/logging, and full weatherproofing).

MANDATORY SECTIONS PER MILESTONE:
For each phase (MVP, IOC, FOC), provide:
- **Phase Objective:** Clear operational statement of what the machine can do in this phase.
- **Relevant Active Capabilities:** Explicit list of Capability IDs (e.g. 1.a, 1.b) active in this phase.
- **Relevant RTM Requirements & Phase Thresholds:** Explicit list of Requirement IDs (e.g. Requirement 1.a) and the exact baseline or upgraded numerical threshold applicable to this phase.
- **Evolution / Upgrade Path:** Explicitly describe any minimum criteria in this phase that will be upgraded or expanded in subsequent milestones.
- **Key Deliverables:** Specific physical components and assemblies installed.
- **Gating Criteria (Checklist):** Objective, measurable pass/fail test items verified with RTM methods before moving to the next phase.

CRITICAL RULES:
- DO NOT treat milestones as static construction checklists or calendar dates. They must represent progressive capabilities.
- Use clean plain-text units. DO NOT use LaTeX math formatting.
- Write the final document to docs/MILESTONES.md or return complete markdown.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Milestones & Gating Criteria document:
1. Progressive Capability Layering: Are MVP/MVC, IOC, and FOC structured as an expanding ladder of capabilities (from basic power/movement -> essential safety/monitoring -> full implements & UI)?
2. RTM & Requirements Mapping: Are exact Capability IDs and Requirement IDs explicitly mapped to each milestone with clear phase thresholds?
3. Evolution / Upgrade Path: Does each phase clearly explain what minimum criteria exist and how they will be upgraded in future milestones?
4. Objective Gating: Are gating criteria measurable pass/fail verification checks tied to RTM methods?
5. Plain-Text Units: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [milestonesSecretSauce]
};
