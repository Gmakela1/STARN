import { SpecialistPackage } from '../../types.js';

const buildSequenceSecretSauce = `# Build Sequence: MVC — Electric Tractor Powertrain Conversion

## 1. Pre-Build Parts & Risk Mitigation Checklist
- [ ] [From BOM SS01-01] ME1115 motor received, verified, and bench tested
- [ ] [From BOM SS01-02] SAE 3 bellhousing adapter plate received
- [ ] [From BOM SS02-01] 20S 72V 80Ah battery pack received and voltage confirmed
- [ ] [From Risk Register R-01] Transmission input shaft pilot measuring tooling ready
- [ ] [From Risk Register R-02] Emergency disconnect E-Stop switch verified open-circuit

## 2. Master Action Table

| Action # | Action Description | Target Subsystem | Prerequisite Actions | Work Instruction Document | Status | Non-Conformance |
| :---: | :--- | :---: | :---: | :--- | :---: | :---: |
| **ACTION-01** | Disconnect & Remove Diesel Engine | SS-01 | None | \`docs/work_instructions/ACTION-01-REMOVE-DIESEL-ENGINE-WORK-INSTRUCTION.md\` | READY | NONE |
| **ACTION-02** | Measure Transmission Input Shaft Pilot | SS-01 | ACTION-01 | \`docs/work_instructions/ACTION-02-SHAFT-PILOT-MEASURE-WORK-INSTRUCTION.md\` | PENDING | NONE |
| **ACTION-03** | Mount Electric Motor & Bellhousing Adapter | SS-01 | ACTION-02 | \`docs/work_instructions/ACTION-03-MOUNT-ELECTRIC-MOTOR-WORK-INSTRUCTION.md\` | PENDING | NONE |
| **ACTION-04** | Fabricate Motor & Battery Chassis Mounts | SS-06 | ACTION-01 | \`docs/work_instructions/ACTION-04-FABRICATE-MOUNTS-WORK-INSTRUCTION.md\` | PENDING | NONE |
| **ACTION-05** | Install Battery Pack & HV Distribution | SS-02, SS-04 | ACTION-04 | \`docs/work_instructions/ACTION-05-INSTALL-BATTERY-HV-WORK-INSTRUCTION.md\` | PENDING | NONE |
| **ACTION-06** | Wire Motor Controller & 12V Logic Harness | SS-03, SS-05 | ACTION-03, ACTION-05 | \`docs/work_instructions/ACTION-06-WIRE-CONTROLLER-HARNESS-WORK-INSTRUCTION.md\` | PENDING | NONE |

## 3. Step-by-Step Procedure Summary

### Step 1: Disconnect and remove diesel engine (ACTION-01)
- [From Architecture SS-01] Locate and identify all engine mounting points
- Drain fluids, disconnect legacy 12V battery, disconnect bellhousing bolts, hoist engine out
- Work Instruction: \`docs/work_instructions/ACTION-01-REMOVE-DIESEL-ENGINE-WORK-INSTRUCTION.md\`
- **→ VERIFY: TP-MECH-01 (Engine Bay Clear & Concentricity Inspection)**

### Step 2: Measure transmission input shaft pilot (ACTION-02)
- [From Risk Register R-01] Pilot diameter unknown — verify before torquing adapter
- Measure pilot diameter, bolt pattern, and shaft engagement depth
- Work Instruction: \`docs/work_instructions/ACTION-02-SHAFT-PILOT-MEASURE-WORK-INSTRUCTION.md\`
- **→ VERIFY: TP-MECH-02 (Shaft Pilot Verification)**

### Step 3: Mount electric motor to transmission (ACTION-03)
- [From Architecture SS-01] Use SAE 3 bellhousing adapter plate
- [From ICD ICD-M-01] Motor ↔ Transmission mechanical interface
- Align motor shaft to transmission input, torque bolts in star pattern to 45 ft-lbs with Loctite 271
- Work Instruction: \`docs/work_instructions/ACTION-03-MOUNT-ELECTRIC-MOTOR-WORK-INSTRUCTION.md\`
- **→ VERIFY: TP-MECH-03 (Mounting Torque & Runout Verification)**
`;

export const buildSequencePackage: SpecialistPackage = {
  id: 'build-sequence',
  name: 'Build Sequence & Assembly Planning',
  description: 'Produces the macro assembly schedule and Master Action Table linking to Work Instructions in docs/work_instructions/, referencing upstream documents and marking verification stopping points.',
  prerequisiteArtifactId: 'MILESTONES',
  prerequisiteArtifactIds: ['RISK_REGISTER'],
  systemPrompt: `You are the Build Sequence & Assembly Planning Specialist for STARN.
Your mission is to produce the macro build sequence for a specific milestone gate (MVC, IOC, or FOC) by reading all upstream documents and synthesizing them into a linear assembly schedule with a Master Action Table that links directly to detailed Work Instructions.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** Use the \`fs_read\` tool to inspect ALL upstream documents: docs/MILESTONES.md, docs/RISK_REGISTER.md, docs/BOM.md, docs/REQUIREMENTS.md, docs/ICD.md, docs/ARCHITECTURE.md, docs/CAPABILITIES.md, docs/CONOPS.md, docs/DECISIONS.md. Also check if prior build sequences exist (e.g., BUILD_SEQUENCE_MVC.md if building IOC).
2. **Gate Selection:** The user will specify which gate to build (e.g., "build the MVC sequence"). Read the Milestones document for that gate's criteria.
3. **Explicit Running Plan:** Formulate and state a brief running plan outlining how you will sequence the actions, establish prerequisites, and link to Work Instructions.
4. **Author the Master Action Table & Step-by-Step Procedure Summary:**
   - Pre-build parts receipt checklist from BOM and critical mitigations from Risk Register.
   - **Master Action Table:**
     - \`Action #\` (e.g. \`ACTION-01\`, \`ACTION-02\`)
     - \`Action Description\` (clear operational action)
     - \`Target Subsystem\` (e.g. \`SS-01\`, \`SS-06\`)
     - \`Prerequisite Actions\` (e.g. \`None\`, \`ACTION-01\`)
     - \`Work Instruction Document\` (explicit relative path: \`docs/work_instructions/ACTION-<NUM>-<SLUG>-WORK-INSTRUCTION.md\`)
     - \`Status\` (\`READY\` | \`PENDING\` | \`IN-PROGRESS\` | \`COMPLETED\` | \`BLOCKED\`)
     - \`Non-Conformance\` (\`NONE\` | \`OPEN (<defect>)\` | \`RESOLVED\`)
   - **Step-by-Step Procedure:** summary tracing each action to [From Architecture], [From ICD], [From BOM], and [From Risk Register] with stopping signposts: **→ VERIFY: TP-XXX (Test Name)**.
5. **Write the Final Document:** Write the completed build sequence to docs/build_sequences/BUILD_SEQUENCE_{GATE}.md via \`fs_write\`.

CRITICAL RULES:
- The \`## Master Action Table\` is MANDATORY and MUST include the \`Work Instruction Document\` column pointing to \`docs/work_instructions/ACTION-<NUM>-<SLUG>-WORK-INSTRUCTION.md\`.
- Each action must trace to real upstream requirements and components.
- Use \`→ VERIFY: TP-XXX\` markers for stopping points.
- You MUST write the final document to docs/build_sequences/BUILD_SEQUENCE_{GATE}.md via the \`fs_write\` tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_edit', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Build Sequence:
1. Master Action Table: Does the document feature a Master Action Table with Action #, Target Subsystem, Prerequisite Actions, and links to docs/work_instructions/?
2. Source Grounding: Are all actions traced to real upstream documents (Architecture, ICD, BOM, Risk Register)?
3. Verification Points: Are \`→ VERIFY: TP-XXX\` markers present at appropriate stopping points?
4. Pre-Build Checklist: Is there a pre-build parts receipt checklist derived from BOM?
5. Gate Alignment: Does the sequence cleanly address the target milestone gate (MVC, IOC, or FOC)?`,
  secretSauceExamples: [buildSequenceSecretSauce]
};
