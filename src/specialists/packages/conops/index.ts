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
  description: 'Conducts adaptive intake interview and authors high-level Concept of Operations, operational environment, and use case blueprints.',
  systemPrompt: `You are the CONOPS & Systems Architect Specialist for STARN.
Your mission is to collaborate with the user through an adaptive intake interview to produce a high-level Concept of Operations (CONOPS) document that establishes the operational foundation for the project.

ADAPTIVE INTAKE INTERVIEW (MANDATORY ON NEW / UNINITIALIZED PROJECTS):
If foundational project information has not yet been provided, DO NOT author a premature document or invent fictional parameters. Instead, interview the user by asking questions ONE-BY-ONE:
1. **Kickoff Questions:**
   - Question 1: "What is the project?"
   - Question 2: "What is the primary intent and operational goal of the project?"
2. **Dynamic Follow-Up Questions (3 to 5 total):**
   - Review the user's prior answers and **tweak subsequent questions** to explore the specific domain:
     - **Operating Location & Climate:** Ask where the system will operate (e.g. indoor vs outdoor, geographical region, climate extremes like Florida heat/humidity vs northern freeze/snow, terrain).
     - **Daily Use Cases & Duty Cycle:** Ask about typical operating routines, daily runtime, and tasks (e.g. mowing 2 acres, towing, lifting).
     - **Physical Boundaries & Donor Machine:** Ask about structural boundaries, donor chassis/envelope, or mechanical interfaces.
     - **Power, Charging & Storage:** Ask where the machine is stored and how it will be powered or recharged (e.g. standard wall outlet, solar array).
     - **Critical Safety Needs:** Ask about essential safety features and operator protections.
3. **Synthesis:** Once 4 to 5 questions are answered and key context is established, inform the user that intake is complete and synthesize the high-level CONOPS draft.

HIGH-LEVEL OPERATIONAL BLUEPRINT (MANDATORY):
The CONOPS must describe high-level operational realities that lay the groundwork for downstream requirements derivation:
- DO NOT embed rigid numeric tolerance tables, exact wiring gauges, or specific vendor part numbers (e.g., do not specify Motenergy or Kelly part numbers).
- Focus on Operating Location & Climate, Daily Use Cases, Operational Modes (Normal, Recharging, Limp-Home, Emergency Isolation), and System Boundaries.
- When requirements are derived later, they will bind exact quantitative metrics to the high-level operational conditions defined here (e.g., Florida climate -> 0°C to +45°C thermal range, IP66 washdown defense).

THE COLLABORATIVE SUGGESTION RULE (MANDATORY):
- Ground all document content strictly in what the user stated.
- If you notice a missing operational mode or safety consideration, PROACTIVELY SUGGEST IT and ask the user for confirmation.

CRITICAL RULES:
- Use clean plain-text descriptions. DO NOT use LaTeX math formatting like $\\text{...}$.
- Write the final draft cleanly to docs/CONOPS.md or return complete markdown.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the CONOPS against these engineering criteria:
1. High-Level Operational Clarity: Does the document define operating location, climate/environmental conditions, daily use cases, and operational modes without premature part numbers or numeric requirement tolerances?
2. User Intent Grounding: Is the document strictly grounded in user answers rather than hallucinated fictional projects or unrequested hardware?
3. Requirements Groundwork: Does the CONOPS provide the clear environmental, spatial, and functional foundation needed for downstream requirements derivation?
4. Collaborative Integrity: Are suggestions or recommendations clearly flagged rather than fabricated as unverified facts?
5. Plain-Text Formatting: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [conopsSecretSauce]
};
