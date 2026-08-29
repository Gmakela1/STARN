import { SpecialistPackage } from '../../types.js';

const conopsSecretSauce = `# Concept of Operations (CONOPS): Electric Utility Tractor Conversion

## 1. Executive Summary & User Intent
The system converts a 19HP diesel sub-compact utility tractor into a battery-electric powertrain. The primary user intent is to achieve clean, quiet, and low-maintenance operation for routine residential and small-acreage property tasks (such as mowing grass, towing small utility trailers, and moving soil) without diesel exhaust fumes or engine maintenance.

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
- **Community & Environmental Impact:** Zero tailpipe emissions and low acoustic noise allowing early morning yard maintenance without disturbing neighbors.`;

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

MANDATORY DOCUMENT STRUCTURE (MANDATORY - DO NOT DEVIATE):
The CONOPS document MUST follow this exact 5-section markdown structure:
1. **## 1. Executive Summary & User Intent**
2. **## 2. Operational Environment & Operating Location**
3. **## 3. Operational Use Cases & System Modes** (Mode 1: Normal Work, Mode 2: Auxiliary/Implement, Mode 3: Recharging, Mode 4: Limp-Home/Contingency, Mode 5: Emergency Isolation)
4. **## 4. System Boundaries & High-Level Interfaces**
5. **## 5. Safety, Environmental & Community Considerations**

CRITICAL FORMAT RULES:
- DO NOT add meta-commentary tags like "(user-stated, Q1)" or "(See Section X)" in the document body.
- DO NOT add a changelog, version history, or traceability table section.
- DO NOT embed numeric requirement thresholds (those belong in the Requirements phase).
- Use clean plain-text descriptions only. DO NOT use LaTeX math formatting.
- Write the final draft cleanly to docs/CONOPS.md or return complete markdown.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the CONOPS against these engineering criteria:
1. Clean 5-Section Structure: Does the document follow the exact 5-section format without meta-commentary, changelog, or traceability table sections?
2. High-Level Operational Clarity: Does the document define operating location, climate/environmental conditions, daily use cases, and operational modes without premature part numbers or numeric requirement tolerances?
3. User Intent Grounding: Is the document strictly grounded in user answers rather than hallucinated fictional projects or unrequested hardware?
4. Requirements Groundwork: Does the CONOPS provide the clear environmental, spatial, and functional foundation needed for downstream requirements derivation?
5. Plain-Text Formatting: Is the document free of raw LaTeX math strings and meta-commentary tags?`,
  secretSauceExamples: [conopsSecretSauce]
};
