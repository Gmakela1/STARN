import { SpecialistPackage } from '../../types.js';

const workInstructionsSecretSauce = `# Work Instruction: ACTION-03 — Mount Electric Motor & Bellhousing Adapter
**Milestone Gate:** MVC / Powertrain Integration  
**Target Subsystem:** SS-01 (Traction Motor) | **Interface:** ICD-M-01  
**Status:** READY

---

## 1. Prerequisites & Required Resources

### Prerequisite Actions
- [x] **ACTION-01:** Remove Diesel Engine & Drain Fluids — \`COMPLETED\`
- [x] **ACTION-02:** Transmission Input Shaft Pilot Measurement — \`COMPLETED\` (Measured Pilot: 82.48 mm)

### Parts from BOM
- **1x** Motenergy ME1115 BLDC Motor (BOM Item #SS01-01)
- **1x** SAE 3 Bellhousing Adapter Flange (BOM Item #SS01-02)
- **4x** M10-1.5 x 40mm Grade 10.9 Zinc Hex Cap Screws (BOM Item #SS01-04)
- **4x** 10mm High-Collar Split Lock Washers (BOM Item #SS01-05)

### Required Tools & Equipment
- 17mm 6-point shallow & deep sockets with 3/8" drive ratchet
- Calibrated 3/8" drive torque wrench (calibrated within 20–100 ft-lbs range)
- Loctite 271 (High-strength red threadlocker)
- Non-chlorinated brake cleaner & lint-free shop rags
- 0.001" dial test indicator with magnetic articulated base

### Safety Equipment / PPE
- ANSI Z87.1 approved safety glasses with side shields
- Nitrile mechanic gloves (heavy-duty 6 mil)
- Steel-toe work boots

---

## 2. Step-by-Step Action Checklist

- [ ] **Step 1:** Spray transmission bellhousing mating face and pilot register with brake cleaner. Wipe thoroughly clean using a lint-free shop rag until zero grease remains.
- [ ] **Step 2:** Slide SAE 3 adapter plate onto transmission pilot flange. Verify adapter seats 100% flush against transmission case with zero rocking or binding.
- [ ] **Step 3:** Mount dial indicator magnetic base to transmission case with tip against adapter pilot bore. Rotate transmission input shaft 360 degrees. Verify Total Indicated Runout (TIR) <= 0.05 mm.
- [ ] **Step 4:** Inspect M10-1.5 bolts for clean threads. Apply exactly 3 drops of Loctite 271 to the engagement threads of each bolt.
- [ ] **Step 5:** Thread all 4 bolts finger-tight. Using the calibrated torque wrench, torque bolts in a cross-star pattern to 45 ft-lbs (61 Nm).
- [ ] **Step 6: [GATED TEST PLAN EXECUTION: TP-MECH-01 — Driveline Concentricity & Shaft Free-Rotation]**
  - Verify all Prerequisites in \`docs/TEST_PLANS.md#TP-MECH-01\` are satisfied.
  - Slide motor shaft splines into transmission coupler.
  - Hand-rotate motor rotor 360 degrees. Verify smooth rotation with zero axial binding or audible metallic scraping.
- [ ] **Step 7: [RECORD EVIDENCE]**
  - Apply yellow inspection lacquer torque-stripe across each torqued bolt head.
  - Capture clear photo of torqued assembly with inspection stripes visible.
  - Save to \`artifacts/ACTION-03-MOUNT-MOTOR-WI-1-TORQUE-STRIPE.jpg\`.

---

## 3. Verification & Evidence Artifacts

- **Torque & Installation Media:** \`artifacts/ACTION-03-MOUNT-MOTOR-WI-1-TORQUE-STRIPE.jpg\`
- **Dial Indicator Runout Reading:** TIR: \`[ 0.03 mm ]\` (Specification limit: <= 0.05 mm)
- **Sign-off:** Lead Builder — Date: \`YYYY-MM-DD\`

---

## 4. Hardware Non-Conformance / Bug Log
*(If an issue, dimensional mismatch, or component defect occurs during this action, document here)*

- **Flag Status:** NONE
- **Defect Description:** None
- **Defect Evidence / Media:** None
- **AI Recommendation / Resolution:** None
`;

export const workInstructionsPackage: SpecialistPackage = {
  id: 'work-instructions',
  name: 'Work Instructions & Shop Floor Procedures',
  description: 'Authors surgical, per-action shop floor work instructions with exact tools, torque values, checklists, flat artifact photo slots, inline test gates, and hardware non-conformance logs.',
  prerequisiteArtifactId: 'BUILD_SEQUENCE',
  systemPrompt: `You are the Work Instructions & Shop Floor Procedures Specialist for STARN.
Your mission is to produce detailed, unambiguous, step-by-step physical work instructions for a specific action item from the Master Action Table in docs/build_sequences/BUILD_SEQUENCE_{GATE}.md.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** Use \`fs_read\` to inspect:
   - docs/build_sequences/ (to identify the target Action #, prerequisites, and target subsystem)
   - docs/ICD.md (for exact interface dimensions, torque limits, pinouts, pressures)
   - docs/BOM.md (for part numbers, descriptions, and quantities)
   - docs/TEST_PLANS.md (to link inline test plan gates)
   - docs/RISK_REGISTER.md (for safety precautions and critical mitigations)
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining the action steps, tool requirements, inline test plan gates, and evidence capture points.
3. **Execution & Documentation:** Author the complete work instruction document and write it to:
   \`docs/work_instructions/ACTION-<NUM>-<SLUG>-WORK-INSTRUCTION.md\`
   (If this is a secondary rework or corrective instruction for an existing action, use \`-WORK-INSTRUCTION-2.md\`, \`-WORK-INSTRUCTION-3.md\`).

WORK INSTRUCTION DOCUMENT STRUCTURE (MANDATORY):
For the action, provide:
1. **Header:** Title with Action # and Description, Milestone Gate, Target Subsystem, Interface ID, and Status (\`READY\` | \`IN-PROGRESS\` | \`COMPLETED\` | \`BLOCKED\`).
2. **Section 1: Prerequisites & Required Resources:**
   - Prerequisite Actions that must be marked COMPLETED before beginning.
   - Parts from BOM with exact **quantities**, descriptions, and BOM item IDs.
   - Required Tools & Equipment with exact drive sizes (e.g. 17mm socket), calibrated torque ranges, and chemical grades (e.g. Loctite 271).
   - Safety Equipment / PPE (eye protection, gloves, footwear, thermal/HV barriers).
3. **Section 2: Step-by-Step Action Checklist:**
   - Granular, sequential physical steps (\`- [ ] **Step 1:** ...\`).
   - Explicit torque values, sequence patterns (star pattern), or measurement checks.
   - **Gated Test Plan Execution Steps:** When a physical milestone requires testing, insert an explicit inline gate:
     \`- [ ] **Step X: [GATED TEST PLAN EXECUTION: TP-XXX — Test Name]**\`
   - **Evidence Recording Step:** Instruct taking photo/data and saving to the flat artifacts repository.
4. **Section 3: Verification & Evidence Artifacts:**
   - Path to photo/media in flat \`artifacts/\` folder using standardized naming:
     \`artifacts/ACTION-<NUM>-<SLUG>-WI-<VERSION>-<DESCRIPTOR>.<ext>\`
   - Data recording slots for measured values (runout, torque, pressure, resistance).
   - Sign-off line for builder and date.
5. **Section 4: Hardware Non-Conformance / Bug Log:**
   - \`Flag Status:\` (\`NONE\` | \`OPEN_NON_CONFORMANCE\` | \`RESOLVED\`)
   - \`Defect Description:\` Specific field defect, mismatch, or damage encountered.
   - \`Defect Evidence / Media:\` Path to defect photo in \`artifacts/\`.
   - \`AI Recommendation / Resolution:\` Space for corrective analysis.

CRITICAL RULES:
- Output file path MUST be \`docs/work_instructions/ACTION-<NUM>-<SLUG>-WORK-INSTRUCTION.md\`.
- All photos/media MUST reference the single flat \`artifacts/\` repository.
- Avoid vague hand-waving (e.g. "tighten bolts as needed"). State exact torque values, socket sizes, and lubricants.
- You MUST write the document via \`fs_write\` (or \`fs_edit\` if updating).`,
  allowedTools: ['fs_read', 'fs_write', 'fs_edit', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Work Instruction:
1. Granular Action Checklist: Are steps sequential, unambiguous, and physical, specifying exact tool sizes, chemicals, and torque specs?
2. Prerequisites & BOM Quantities: Are prerequisite actions and required BOM parts listed with explicit integer quantities?
3. Flat Evidence Repository: Does the evidence section reference the flat artifacts/ folder with standard ACTION- naming?
4. Gated Test Plan Execution: Are test plans properly signposted as inline prerequisite gates?
5. Non-Conformance Structure: Does the document feature a complete Hardware Non-Conformance / Bug Log section?`,
  secretSauceExamples: [workInstructionsSecretSauce]
};
