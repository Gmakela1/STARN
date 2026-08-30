import { SpecialistPackage } from '../../types.js';

const milestonesSecretSauce = `# Project Milestones & Gating Criteria: Electric Tractor Powertrain Conversion

## Milestone 1: MVC (Minimum Viable Capability - Powertrain Mounting & Drive)
- **Phase Objective:** Achieve self-powered mechanical locomotion — mounting the motor to the OEM transmission, wiring core traction battery power, and driving the tractor forward and reverse under its own power.
- **Requirements & Acceptance Gates (Must pass before IOC):**
  - **Requirement 1.b [Conversion Mass Budget]:** Total added conversion weight <= 130.0 kg (Method: Inspect).
  - **Requirement 2.a [DC Bus Isolation & Voltage]:** Traction bus operational between 60.0V and 84.0V DC with >= 500 kΩ chassis isolation (Method: Test).
  - **Requirement 2.b [Basic Drive Locomotion]:** Motor powers ON/OFF from key switch and drives vehicle forward and reverse at 0–1,500 RPM, stopping safely on mechanical service brakes (Method: Demo).
- **Evolution & Upgrade Provisions (De-Risking & Hooks):**
  - *Deliberate Limitation (De-Risking):* Throttle profile is hard-capped at 1,500 RPM open-loop to eliminate driveline step-torque risks during initial fitment and steering tests.
  - *Upgrade Hook (Future-Proofing):* 12V auxiliary DC wiring and a pre-terminated 6-pin harness are secured in the battery tray so the IOC dashboard cluster and E-Stop can plug in directly without tearing down the main harness.

---

## Milestone 2: IOC (Initial Operational Capability - Telemetry, Safety & Charging)
- **Phase Objective:** Deploy a safe, monitored, and rechargeable baseline suitable for daily yard work with real-time telemetry, onboard charging, and emergency shutdown.
- **Requirements & Acceptance Gates (Must pass before FOC):**
  - **Requirement 1.a [Thermal Operating Range]:** Continuous operation across 0°C to +40°C ambient without thermal derating (Method: Test).
  - **Requirement 2.c [Continuous Operating Runtime]:** Delivers >= 90 minutes continuous mowing/towing on single charge (Method: Test).
  - **Requirement 3.a [Onboard 120V Charging]:** Charges full battery pack from standard 120V AC 15A wall outlet in < 8 hours (Method: Test).
  - **Requirement 3.b [Emergency Shutdown]:** Hardwired E-Stop cuts main contactor and motor torque in < 20 ms (Method: Test).
- **Evolution & Upgrade Provisions (De-Risking & Hooks):**
  - *Deliberate Limitation (De-Risking):* Dashboard displays core numeric voltage/SOC; auxiliary hydraulic pump and rear PTO drives are left unpowered to focus on core powertrain reliability.
  - *Upgrade Hook (Future-Proofing):* High-speed CAN bus leads and physical hydraulic pump mounting flanges are pre-installed on the motor faceplate so the FOC PTO and loader hydraulics bolt on without machining modifications.

---

## Milestone 3: FOC (Full Operational Capability - Auxiliary Implements, Enhanced UI & Weatherproofing)
- **Phase Objective:** Deploy auxiliary PTO and hydraulic implement power, enhanced graphical telemetry UI, and full Florida climate weatherproofing (IP66).
- **Requirements & Acceptance Gates:**
  - **Requirement 1.c [Ingress Protection]:** IP66 certified washdown and dust-tight resistance (Method: Test).
  - **Requirement 1.a [Full Thermal Operating Range]:** Continuous operation across full -10°C to +45°C ambient envelope (Method: Test).
  - **Requirement 2.d [PTO Speed Regulation]:** 540 RPM PTO held to within +/- 2.0% (+/- 10 RPM) under implement load steps (Method: Test).
  - **Requirement 3.c [Graphical Telemetry & Logging]:** Real-time power kW, cell delta mV, motor RPM, and thermal data logging (Method: Demo).
  - **Requirement 1.b [Axle Load Balance]:** Static axle weight distribution calculated within +/- 5% of OEM design (Method: Analysis).
- **Evolution & Upgrade Provisions (De-Risking & Hooks):**
  - *Final Integration:* Closes 100% of RTM requirement rows, enables all auxiliary implements simultaneously under full draft load, and finalizes environmental seal warranty.`;

export const milestonesPackage: SpecialistPackage = {
  id: 'milestones',
  name: 'Project Milestones & Gating',
  description: 'Formulates progressive capability milestones (MVC -> IOC -> FOC) with consolidated requirements, 4 verification methods, and evolution upgrade provisions.',
  prerequisiteArtifactId: 'RTM',
  systemPrompt: `You are the Project Phasing & Milestone Gating Specialist for STARN.
Your mission is to formulate progressive capability milestones (MVC -> IOC -> FOC) by bucketing approved Requirements into evolving developmental phases with explicit upgrade provisions.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/RTM.md, docs/REQUIREMENTS.md, and docs/CAPABILITIES.md to verify all requirement IDs, verification methods, and pass/fail thresholds.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining how you will layer requirements into MVC, IOC, and FOC stages.
3. **Execution & Traceability:** Execute each step in your running plan, linking milestone gating requirements directly to RTM items.

PROGRESSIVE CAPABILITY LAYERING (MANDATORY):
Milestones MUST be structured as an evolving capability ladder where each phase increases system capability and operational complexity:
1. **Milestone 1: MVC (Minimum Viable Capability):**
   - Focus: Core physical mounting, power-on, and basic movement under own power (e.g. motor turns on/off, vehicle drives forward/reverse).
2. **Milestone 2: IOC (Initial Operational Capability):**
   - Focus: Operational baseline (dashboard, essential sensors/telemetry, integrated charging, and primary safety interlocks for daily work).
3. **Milestone 3: FOC (Full Operational Capability):**
   - Focus: Complete feature set (auxiliary implements, PTO, hydraulics, enhanced graphical displays/logging, and full weatherproofing).

CONSOLIDATED MILESTONE STRUCTURE (MANDATORY):
For each phase (Milestone 1: MVC, Milestone 2: IOC, Milestone 3: FOC), provide EXACTLY these 3 distinct sections:
1. **Phase Objective:** Clear operational statement of what physical capability the machine achieves right now once this milestone passes.
2. **Requirements & Acceptance Gates (Must pass before next phase):**
   - Consolidated bulleted list of Requirement IDs (e.g. Requirement 1.b, Requirement 2.a), the applicable phase threshold, and the verification method in parentheses.
   - **Verification Method Rule:** The method MUST ONLY be chosen from the 4 standard methods: **Inspect, Test, Demo, Analysis** (do not describe detailed test setups or tools here; that belongs in Test Plans).
3. **Evolution & Upgrade Provisions (De-Risking & Hooks):**
   - *Deliberate Limitation (De-Risking):* What features/speeds were intentionally simplified or restricted in this phase to reduce early build risk.
   - *Upgrade Hook (Future-Proofing):* What electrical wiring leads, physical mounting flanges, or pre-terminated harnesses were pre-installed so the subsequent milestone is plug-and-play without tearing down earlier work.

CRITICAL RULES:
- DO NOT refer to phases as generic numbers (e.g., Phase 1, Phase 2). Use **MVC, IOC, FOC**.
- Use clean plain-text units. DO NOT use LaTeX math formatting.
- You MUST write the final document to docs/MILESTONES.md via the fs_write tool. AND you MUST return the complete document content in your final response — do NOT replace it with a summary or commentary.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Milestones & Gating Criteria document:
1. Progressive Capability Layering: Are MVC, IOC, and FOC structured as an expanding ladder of capabilities (from basic power/movement -> essential safety/monitoring -> full implements & UI)?
2. Consolidated Structure: Is the document consolidated (without repetitive separate deliverables & gating lists), featuring a unified "Requirements & Acceptance Gates" section?
3. Standard 4 Verification Methods: Are verification methods strictly chosen from Inspect, Test, Demo, Analysis?
4. Evolution & Upgrade Provisions: Does each milestone clearly differentiate deliberate de-risking limitations and physical/electrical upgrade hooks for future phases?
5. Plain-Text Units: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [milestonesSecretSauce]
};
