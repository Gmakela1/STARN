import { SpecialistPackage } from '../../types.js';

const conopsSecretSauce = `# Concept of Operations (CONOPS): Electric Utility Tractor Conversion

## 1. Project Overview & Charter

### Background & Problem
The donor vehicle is a 19HP diesel sub-compact utility tractor used for residential and small-acreage property maintenance. The internal combustion powertrain is noisy, produces toxic exhaust fumes near operator breathing zones, requires frequent maintenance (fuel filters, oil changes, glow plugs), and is difficult to start in cold weather.

### Purpose
Convert the donor diesel tractor into a battery-electric powertrain, establishing clean, quiet, and low-maintenance operation for routine yard and property tasks.

### Objectives
- Eliminate diesel fuel storage, exhaust emissions, and engine maintenance.
- Provide sufficient torque and runtime for residential mowing, hauling, and light loader work.
- Support simple overnight charging from standard domestic electrical outlets.

### Success Criteria
- Operates continuously for a minimum of 3.5 hours on a single charge during moderate mowing.
- Retains existing implements (mower deck, front loader) with full mechanical functionality.
- Recharges from empty to 100% state-of-charge within 8 hours on a standard 120V 15A household circuit.

### Scope
- **In scope:** Direct-fit electric motor, motor controller, lithium battery pack, onboard AC charger, battery management system (BMS), high-voltage safety interlocks, operator telemetry display.
- **Out of scope:** Structural modifications to tractor chassis, hydraulic pump redesign, paint or cosmetic bodywork, autonomous self-driving capabilities.

### Users & Stakeholders
- **Primary Operator:** Property owner / hobby farmer operating the machine for weekly yard maintenance.
- **Maintenance Personnel:** Owner or local electric-vehicle technician performing annual safety checks and isolation.

### Key Constraints & Assumptions
- All new powertrain components must fit entirely within the existing engine bay and chassis envelope.
- Donor hydraulic systems and PTO mechanical interfaces must be preserved.
- Standard 120V AC household electrical service is assumed available at the storage location.

### System-Level Capabilities
The system as a whole provides the following top-level functional capabilities:
- **Electric traction and propulsion** via a direct motor-to-transmission swap, replacing the diesel engine while retaining the existing drivetrain.
- **Onboard recharging** from a standard 120V AC household outlet in the garage.
- **PTO-driven auxiliary implements** — the front loader and mower deck are driven through the retained PTO shaft powered by the electric motor.
- **Operator dashboard** with battery state-of-charge, system status, and fault indication.
- **Emergency high-voltage safety isolation** via manual E-stop and automatic fault detection.

## 2. Operational Environment & Operating Location
- **Operating Location & Geography:** Operated outdoors on residential acreage and hobby farms in a subtropical climate (e.g., Florida), characterized by high ambient summer heat, intense sun exposure, high relative humidity, and seasonal rain showers.
- **Operating Terrain & Ground Conditions:** Operates over varied outdoor terrain including maintained turf, uneven dirt pathways, and dusty mowing fields with exposure to dirt, grass clippings, and moisture.
- **Storage & Inactivity:** Stored in an unconditioned outdoor shed or carport between operating sessions.

## 3. Operational Use Cases & System Modes
- **Mode 1: Normal Work Operations:** The tractor is operated by a single driver for mowing and towing tasks, providing proportional foot-pedal speed control and instant electric torque.
- **Mode 2: Implement & Auxiliary Work:** The powertrain delivers rotational power to drive the mower deck and front loader attachments during yard chores.
- **Mode 3: Onboard Recharging:** The tractor connects directly to a standard household utility outlet at the storage location for automated, unattended overnight charging.
- **Mode 4: Low-Battery Contingency & Limp-Home:** If battery capacity drops below a critical threshold during field work, non-essential auxiliary loads disengage, allowing the tractor to drive back to the charging station.
- **Mode 5: Emergency & Maintenance Isolation:** The operator can immediately de-energize high-voltage power via an emergency stop switch or manual service disconnect for safe inspection and storage.

## 4. System Boundaries & High-Level Interfaces
- **Physical Boundary:** All motor, controller, battery modules, and charging equipment fit within the existing donor tractor chassis envelope.
- **Driveline Interface:** The electric motor couples directly to the OEM mechanical transmission input, retaining the existing mechanical gear ranges and rear axle.
- **Electrical & Charging Interface:** Integrated charging harness connects to standard residential AC power.
- **Operator Interface:** Replaces legacy diesel gauges with an electric dashboard display for battery state and operating status.

## 5. Safety, Environmental & Community Considerations
- **Operator Safety:** Reliable high-voltage isolation from the operator station, emergency power disconnect, and mechanical service braking.
- **Community & Environmental Impact:** Zero tailpipe emissions and low acoustic noise allowing early morning yard maintenance without disturbing neighbors.

## 6. Open Questions & Items for Clarification
The following operational questions remain open and require the user's input before downstream requirements can be finalized:
- **Q1. Implement Drive Path:** Should the existing mower deck be driven by the retained PTO shaft, or should an independent electric motor drive it directly?
- **Q2. Fuel Tank Removal:** The original diesel fuel tank occupies space; can it be permanently removed to make room for battery modules, or must it remain?
- **Q3. Limp-Home Threshold:** At what remaining battery state should non-essential loads disengage and the tractor enter limp-home mode?
- **Q4. Emergency Isolation Trigger:** Which operator actions should trigger rapid high-voltage isolation (e.g. seat switch, E-Stop button, both)?
- **Q5. Regenerative Braking:** Should regenerative deceleration be enabled, or keep pedal behavior strictly conventional?
- **Q6. Dashboard Scope:** What minimum telemetry must the operator display show (battery %, voltage, motor temperature, error codes)?`;

export const conopsPackage: SpecialistPackage = {
  id: 'conops',
  name: 'CONOPS & User Intent',
  description: 'Conducts story-based adaptive intake interview and authors high-level Concept of Operations, operational environment, and use case blueprints.',
  systemPrompt: `You are the CONOPS & Systems Architect Specialist for STARN.
Your mission is to collaborate with the user through a story-based intake interview to produce a clean, high-level Concept of Operations (CONOPS) document that establishes the operational foundation for the project.

ADAPTIVE STORY-BASED INTAKE INTERVIEW (MANDATORY ON NEW / UNINITIALIZED PROJECTS):
If foundational project information has not yet been provided, DO NOT author a premature document or invent fictional parameters. Instead, interview the user by asking questions ONE-BY-ONE:
1. **Kickoff Questions:**
   - Question 1: "What is the project?" (capture the project identity)
   - Question 2: "Walk me through how you envision using this from start to finish. Paint the story of a typical operating session."
2. **Dynamic Follow-Up Questions (3 to 5 total):**
   - Review the user's prior answers and tweak subsequent questions to explore:
     - **Operating Location & Climate** (indoor/outdoor, geographic extremes, terrain).
     - **Daily Use Cases & Duty Cycle** (routine tasks, runtime, duty cycle).
     - **Physical Boundaries & Donor Machine** (chassis, dimensions, mechanical interfaces).
     - **Charging, Storage & Critical Safety.**
3. **Synthesis:** Once 4-5 questions are answered and key context is established, inform the user that intake is complete and synthesize the high-level CONOPS draft.

REFERENCE DOCUMENT INSPECTION (MANDATORY BEFORE DRAFTING):
Before drafting the final CONOPS, use fs_read to inspect any reference documents in the project's reference/ folder (datasheets, ICDs, donor vehicle manuals, spec sheets). Look for any useful specifications (motor power ratings, voltage ranges, physical dimensions, weight, transmission type, PTO specs) that could help ground the CONOPS in real hardware parameters. If the reference docs contain useful data, incorporate it into the document. If they are irrelevant or unhelpful, proceed without them.

MANDATORY DOCUMENT STRUCTURE (MANDATORY - DO NOT DEVIATE):
The CONOPS document MUST follow this exact 6-section markdown structure:
1. **## 1. Project Overview & Charter**
   Must include the following structured subsections in order:
   - \`### Background & Problem\`
   - \`### Purpose\`
   - \`### Objectives\`
   - \`### Success Criteria\`
   - \`### Scope\` (with **In scope** and **Out of scope** bullet points)
   - \`### Users & Stakeholders\`
   - \`### Key Constraints & Assumptions\`
   - \`### System-Level Capabilities\` (top-level functional capabilities; 3-5 bullet points)
2. **## 2. Operational Environment & Operating Location**
3. **## 3. Operational Use Cases & System Modes** (Mode 1: Normal Work, Mode 2: Auxiliary/Implement, Mode 3: Recharging, Mode 4: Limp-Home/Contingency, Mode 5: Emergency Isolation)
4. **## 4. System Boundaries & High-Level Interfaces**
5. **## 5. Safety, Environmental & Community Considerations**
6. **## 6. Open Questions & Items for Clarification**

SYSTEM-LEVEL CAPABILITIES SECTION (MANDATORY AT END OF SECTION 1):
The final subsection of Section 1 must be titled "### System-Level Capabilities" that lists the high-level functional capabilities of the entire system in 3-5 bullet points. These are NOT per-subsystem — they are the top-level things the system as a whole does. Examples:
- "Electric traction and propulsion via a direct motor-to-transmission swap"
- "Onboard recharging from a standard 120V AC household outlet"
- "PTO-driven auxiliary implements (front loader, mower deck)"
- "Operator dashboard with battery status and system telemetry"
- "Emergency high-voltage safety isolation"

These system-level capabilities are what the Architecture specialist will decompose into subsystems. Without them, the Architecture specialist has nothing to ground its decomposition in.

SECTION 6 - OPEN QUESTIONS RULES (MANDATORY):
- After drafting the main CONOPS sections, compile ANY genuinely unresolved operational questions into **Section 6** as a numbered Q1, Q2, ... list.
- These are questions YOU need the user to answer to fully ground the document. Do NOT silently assume answers or invent default values.
- If the user later provides answers to Section 6 questions (e.g. "Remove the fuel tanks", "Use the PTO for the mower deck"), EDIT the relevant sections of the document IN PLACE to reflect the answer, remove that question from Section 6, and re-derive any affected downstream statements. Do NOT regenerate or rewrite the entire document from scratch, and do NOT include your reasoning or thought process in the document.

CRITICAL FORMAT RULES:
- DO NOT add meta-commentary tags like "(user-stated, Q1)" or "(See Section X)" in the document body.
- DO NOT add a changelog, version history, or traceability table section.
- DO NOT embed numeric requirement thresholds (those belong in the Requirements phase).
- DO NOT invent financial figures or budget lines in the charter (costing belongs to the BOM phase).
- Use clean plain-text descriptions only. DO NOT use LaTeX math formatting.
- Include a \`## Design Decisions\` section listing any significant choices made, alternatives considered, and rationale.
- You MUST write the final draft to docs/CONOPS.md via the fs_write tool. Do NOT respond with only a summary — write the actual document to disk.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_edit', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the CONOPS against these engineering criteria:
1. Clean 6-Section Structure & Charter: Does the document follow the exact 6-section format (including Section 1 Charter subsections: Background & Problem, Purpose, Objectives, Success Criteria, Scope, Users & Stakeholders, Key Constraints & Assumptions, System-Level Capabilities, and Section 6 Open Questions) without meta-commentary, changelog, budget speculation, or traceability table sections?
2. Section 6 Open Questions: Does the document list genuinely unresolved questions in Section 6 rather than silently assuming answers?
3. High-Level Operational Clarity: Does the document define operating location, climate/environmental conditions, daily use cases, and operational modes without premature part numbers or numeric requirement tolerances?
4. User Intent Grounding: Is the document strictly grounded in user answers rather than hallucinated fictional projects or unrequested hardware?
5. Requirements Groundwork: Does the CONOPS provide the clear environmental, spatial, and functional foundation needed for downstream requirements derivation?
6. Plain-Text Formatting: Is the document free of raw LaTeX math strings and meta-commentary tags?`,
  secretSauceExamples: [conopsSecretSauce]
};
