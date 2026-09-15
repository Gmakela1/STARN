import { SpecialistPackage } from '../../types.js';

const buildSequenceSecretSauce = `# Build Sequence: MVC — Electric Tractor Powertrain Conversion

## Pre-Build Checklist
- [From BOM] ME1115 motor received and verified
- [From BOM] SAE 3 bellhousing adapter received
- [From BOM] 4 AWG welding cable, Anderson SB175 connectors received
- [From Risk Register R-01] Motor shaft pilot measurement tooling ready
- [From Risk Register R-02] Battery pack order confirmed, lead time tracked

## Step-by-Step Procedure

### Step 1: Disconnect and remove diesel engine
- [From Architecture SS-01] Locate and identify all engine mounting points
- Drain fuel tank, disconnect battery negative terminal
- Remove exhaust system, unbolt engine mounts
- Disconnect transmission bellhousing bolts
- Lift engine out with hoist
- **→ VERIFY: TP-MVP-01 (Mechanical Concentricity)**

### Step 2: Measure transmission input shaft
- [From Risk Register R-01] Pilot diameter unknown — measure before ordering adapter
- Measure pilot diameter, bolt pattern, and shaft engagement depth
- Record measurements for adapter plate fabrication
- **→ VERIFY: TP-MVP-02 (Shaft Measurement Verification)**

### Step 3: Mount electric motor to transmission
- [From Architecture SS-01] Use SAE 3 bellhousing adapter
- [From ICD ICD-M-01] Motor ↔ Transmission mechanical interface
- Align motor shaft to transmission input, torque 4x bolts to 45 ft-lbs
- Apply Loctite 271 to bolt threads
- **→ VERIFY: TP-MVP-03 (Mounting Torque Verification)**

### Step 4: Fabricate motor mount brackets
- [From Architecture SS-06] Chassis integration mounts
- [From ICD ICD-M-02] Motor ↔ Frame mechanical interface
- Measure and fabricate 4x rubber isolation mount brackets
- Bolt to frame with M10 bolts, 35 ft-lbs
- **→ VERIFY: TP-MVP-04 (Mount Alignment)**

### Step 5: Route HV power cables
- [From ICD §2] Electrical interfaces
- Route 4 AWG welding cable from battery zone to controller location
- Route through left frame rail in split loom conduit
- Install Anderson SB175 connectors at both ends
- **→ VERIFY: TP-MVP-05 (Cable Continuity and Isolation)**
`;

export const buildSequencePackage: SpecialistPackage = {
  id: 'build-sequence',
  name: 'Build Sequence & Assembly Planning',
  description: 'Produces step-by-step assembly procedures per milestone gate, referencing upstream documents (Architecture, ICD, BOM, Risk Register) and marking verification stopping points.',
  prerequisiteArtifactId: 'MILESTONES',
  prerequisiteArtifactIds: ['RISK_REGISTER'],
  systemPrompt: `You are the Build Sequence & Assembly Planning Specialist for STARN.
Your mission is to produce a detailed, step-by-step build sequence for a specific milestone gate (MVC, IOC, or FOC) by reading all upstream documents and synthesizing them into a linear assembly procedure.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** Use the \`fs_read\` tool to inspect ALL upstream documents: docs/MILESTONES.md, docs/RISK_REGISTER.md, docs/BOM.md, docs/REQUIREMENTS.md, docs/ICD.md, docs/ARCHITECTURE.md, docs/CAPABILITIES.md, docs/CONOPS.md, docs/DECISIONS.md. Also check if prior build sequences exist (e.g., BUILD_SEQUENCE_MVC.md if building IOC).
2. **Gate Selection:** The user will specify which gate to build (e.g., "build the MVC sequence"). Read the Milestones document for that gate's criteria.
3. **Explicit Running Plan:** Formulate and state a brief running plan outlining how you will sequence the steps, reference upstream documents, and mark verification points.
4. **Step-by-Step Procedure:** Author a numbered assembly procedure. Each step MUST:
   - Reference the source document: [From Architecture SS-XX], [From ICD ICD-M-XX], [From BOM], [From Risk Register R-XX]
   - Include a verification stopping point: **→ VERIFY: TP-XXX (Test Name)** — this is a compact signpost. The detailed test procedure lives in the Test Plan, not here.
5. **Write the Final Document:** Write the completed build sequence to docs/build_sequences/BUILD_SEQUENCE_{GATE}.md via \`fs_write\`.

OUTPUT FORMAT (docs/build_sequences/BUILD_SEQUENCE_{GATE}.md):
# Build Sequence: [Gate Name] — [Project Name]

## Pre-Build Checklist
- [From BOM] [part] received and verified
- [From Risk Register] [critical mitigations in place]

## Step-by-Step Procedure

### Step 1: [Action]
- [From Architecture SS-XX] Reference to subsystem
- [From ICD ICD-M-XX] Reference to interface
- [From BOM] Reference to part
- [From Risk Register R-XX] Risk mitigation
- **→ VERIFY: TP-XXX (Test Name)**

### Step 2: [Action]
...

CRITICAL RULES:
- Each step must trace to a source document. If a step cannot be traced, it should not be in the sequence.
- Use \`→ VERIFY: TP-XXX\` markers for stopping points — do NOT include the full test procedure here.
- Reference prior build sequences if they exist (for IOC building on MVC).
- You MUST write the final document to docs/build_sequences/BUILD_SEQUENCE_{GATE}.md via the \`fs_write\` tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Build Sequence:
1. Source Grounding: Are all steps traced to real upstream documents? Penalize steps that cannot be traced.
2. Verification Points: Are \`→ VERIFY: TP-XXX\` markers present at appropriate stopping points?
3. Pre-Build Checklist: Is there a checklist of parts and risk mitigations before the procedure?
4. Gate Selection: Does the sequence match the specified milestone gate (MVC, IOC, or FOC)?
5. Plain-Text: Is the document free of LaTeX or raw JSON?`,
  secretSauceExamples: [buildSequenceSecretSauce]
};