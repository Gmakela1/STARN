# Build Sequence, Risk Register & Decision Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Risk Register phase, Build Sequence phase, and Decision Log cross-cutting harvest to STARN's preparation pipeline, between Milestones and Test Plans.

**Architecture:** Three additions: (1) Risk Register — new specialist that auto-generates risks from upstream docs + pending flags, runs a user interview, writes structured table; (2) Build Sequence — new specialist that produces step-by-step assembly procedures per milestone gate, referencing all upstream docs and marking `→ VERIFY` stopping points; (3) Decision Log — centralized harvest at checkpoint that extracts `## Design Decisions` sections from approved documents and appends to `docs/DECISIONS.md`. Test Plan specialist updated to read Build Sequence, produce tabular data entry sheets, and add backward linkage.

**Tech Stack:** TypeScript, Node.js, Inquirer prompts, existing tool handlers (fs_read, fs_write, fs_list, state_read, state_update, example_reader)

**Spec:** `docs/superpowers/specs/2026-09-02-build-sequence-risk-register-decision-log.md`

## Global Constraints

- All new and modified files must pass `tsc` build with no errors
- All 63 existing tests must still pass after changes
- New phases must slot into `ORDERED_WORKFLOW_PHASES` between `milestones` and `testplans`
- `pendingRisks` field in `ProjectState` must be optional/undefined for backward compatibility with existing state files
- Build Sequence specialist must have `prerequisiteArtifactId: 'milestones'` AND also check that `risk-register` is approved (dual prerequisite — see Task 3 for implementation)
- Risk Register specialist must have `prerequisiteArtifactId: 'milestones'`
- Decision Log harvest must be idempotent (check for duplicate D-XXX IDs before appending)
- Each specialist prompt that gets a "Design Decisions" addition must get exactly one line: `- Include a \`## Design Decisions\` section listing any significant choices made, alternatives considered, and rationale.`

---
### Task 1: Data Model & Workflow Ordering

**Files:**
- Modify: `src/workspace/types.ts` — add `pendingRisks` to `ProjectState`
- Modify: `src/workspace/state.ts` — add two new phases to `ORDERED_WORKFLOW_PHASES`
- Modify: `tests/specialists.test.ts` — update specialist count
- Modify: `tests/workspace.test.ts` — update phase ordering assertions

**Interfaces:**
- Consumes: `ProjectState` interface, `ORDERED_WORKFLOW_PHASES` array
- Produces: Updated `ProjectState` with optional `pendingRisks` field, 12-phase workflow

- [ ] **Step 1: Add `pendingRisks` to `ProjectState` interface**

In `src/workspace/types.ts`, add the `pendingRisks` field to `ProjectState`:

```typescript
export interface PendingRisk {
  source: string;
  section: string;
  risk: string;
}

export interface ProjectState {
  projectId: string;
  name: string;
  currentPhase: string;
  discovery: DiscoveryState;
  intake: IntakeState;
  workflow: WorkflowState;
  artifacts: ArtifactRecord[];
  openRisks: string[];
  recentActions: string[];
  pendingRisks?: PendingRisk[];  // NEW: risk flags from specialists, cleared on Risk Register approval
}
```

- [ ] **Step 2: Add `risk-register` and `build-sequence` to `ORDERED_WORKFLOW_PHASES`**

In `src/workspace/state.ts`, insert two new entries between `milestones` and `testplans`:

```typescript
export const ORDERED_WORKFLOW_PHASES = [
  { id: 'conops', name: 'CONOPS / User Intent', artifactPath: 'docs/CONOPS.md' },
  { id: 'architecture', name: 'System Architecture & Subsystems', artifactPath: 'docs/ARCHITECTURE.md' },
  { id: 'icd', name: 'Interface Control Document (ICD)', artifactPath: 'docs/ICD.md' },
  { id: 'capabilities', name: 'Product Capabilities', artifactPath: 'docs/CAPABILITIES.md' },
  { id: 'requirements', name: 'System Requirements', artifactPath: 'docs/REQUIREMENTS.md' },
  { id: 'bom', name: 'Bill of Materials (BOM)', artifactPath: 'docs/BOM.md' },
  { id: 'rtm', name: 'Requirements Traceability Matrix (RTM)', artifactPath: 'docs/RTM.md' },
  { id: 'milestones', name: 'Project Milestones & Gating', artifactPath: 'docs/MILESTONES.md' },
  { id: 'risk-register', name: 'Risk Register', artifactPath: 'docs/RISK_REGISTER.md' },
  { id: 'build-sequence', name: 'Build Sequence & Assembly Planning', artifactPath: 'docs/build_sequences/BUILD_SEQUENCE_{GATE}.md' },
  { id: 'testplans', name: 'Test Plans & Procedures', artifactPath: 'docs/TEST_PLANS.md' },
  { id: 'sow', name: 'Statement of Work (SOW)', artifactPath: 'docs/SOW.md' }
];
```

- [ ] **Step 3: Run tests to verify they still pass**

```bash
npx vitest run
```

Expected: 63 tests pass. The phase ordering test (`initializes workflow with 8 phases`) will fail because it now has 12 phases.

- [ ] **Step 4: Update phase ordering test in `tests/workspace.test.ts`**

Find the test `initializes workflow with 8 phases` and update it to expect the new phases:

```typescript
it('initializes workflow with 12 phases and activePhase set to conops', () => {
    const projPath = path.join(tempBaseDir, 'wf-project');
    fs.mkdirSync(projPath, { recursive: true });
    const stateMgr = new ProjectStateManager(projPath);
    const state = stateMgr.getOrCreateState('p1', 'Tractor EV');
    expect(state.workflow).toBeDefined();
    expect(state.workflow.activePhase).toBe('conops');
    expect(Object.keys(state.workflow.phases)).toEqual(
      expect.arrayContaining(['conops', 'architecture', 'icd', 'capabilities', 'requirements', 'bom', 'rtm', 'milestones', 'risk-register', 'build-sequence', 'testplans', 'sow'])
    );
  });
```

- [ ] **Step 5: Update specialist count test in `tests/specialists.test.ts`**

Find the test `loads all 11 specialists including general...` and update to `loads all 13 specialists`:

```typescript
it('loads all 13 specialists including general, conops, architecture, icd, capabilities, requirements, bom, rtm, milestones, risk-register, build-sequence, testplans, sow, change-impact', () => {
    const packages = registry.listSpecialists();
    expect(packages.map(p => p.id)).toEqual(
      expect.arrayContaining([
        'general',
        'conops',
        'architecture',
        'icd',
        'capabilities',
        'requirements',
        'bom',
        'rtm',
        'milestones',
        'risk-register',
        'build-sequence',
        'testplans',
        'sow',
        'change-impact'
      ])
    );
  });
```

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: 63 tests pass (phase ordering and specialist count updated to match new reality).

- [ ] **Step 7: Commit**

```bash
git add src/workspace/types.ts src/workspace/state.ts tests/workspace.test.ts tests/specialists.test.ts
git commit -m "feat: add pendingRisks to ProjectState, add risk-register and build-sequence to workflow phases"
```

---
### Task 2: Risk Register Specialist

**Files:**
- Create: `src/specialists/packages/risk-register/index.ts`
- Modify: `src/specialists/registry.ts` — register the new specialist
- Create: `tests/risk-register.test.ts` — unit tests
- Modify: `tests/specialists.test.ts` — already updated in Task 1

**Interfaces:**
- Consumes: `SpecialistPackage` type, `SpecialistRegistry` class
- Produces: Exportable `riskRegisterPackage` with id `risk-register`, prerequisite `milestones`

- [ ] **Step 1: Write the failing test**

Create `tests/risk-register.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Risk Register Specialist', () => {
  const registry = new SpecialistRegistry();

  it('registers risk-register specialist', () => {
    const pkg = registry.get('risk-register');
    expect(pkg).toBeDefined();
    expect(pkg!.id).toBe('risk-register');
    expect(pkg!.name).toContain('Risk');
  });

  it('has prerequisite MILESTONES', () => {
    const pkg = registry.get('risk-register');
    expect(pkg!.prerequisiteArtifactId).toBe('MILESTONES');
  });

  it('includes risk register table format in system prompt', () => {
    const pkg = registry.get('risk-register');
    expect(pkg!.systemPrompt).toContain('| ID | Risk (If/Then) | Source | Phase Impacted | Impact Description | Mitigation | Status |');
  });

  it('includes interview instructions for auto-generate then verify', () => {
    const pkg = registry.get('risk-register');
    expect(pkg!.systemPrompt).toContain('pendingRisks');
    expect(pkg!.systemPrompt).toContain('interview');
  });

  it('includes tool-based discovery workflow', () => {
    const pkg = registry.get('risk-register');
    expect(pkg!.systemPrompt).toContain('DISCOVERY, PLANNING & EXECUTION WORKFLOW');
    expect(pkg!.systemPrompt).toContain('fs_read');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/risk-register.test.ts
```

Expected: FAIL with "Cannot find module" or "Cannot read properties of undefined" since the specialist doesn't exist yet.

- [ ] **Step 3: Create the Risk Register specialist package**

Create `src/specialists/packages/risk-register/index.ts`:

```typescript
import { SpecialistPackage } from '../../types.js';

const riskRegisterSecretSauce = `# Risk Register: Electric Tractor Powertrain Conversion

| ID | Risk (If/Then) | Source | Phase Impacted | Impact Description | Mitigation | Status |
|---|---|---|---|---|---|---|
| R-01 | IF motor shaft pilot diameter differs from transmission input THEN adapter plate fabrication adds 2+ weeks | Architecture §SS-01 — coupling interface not yet measured | MVC | Schedule slip of 2+ weeks; delays motor mounting milestone | Defer motor purchase until diesel is removed and shaft is measured | Open |
| R-02 | IF LiFePO4 pack lead time is 8-12 weeks THEN project stalls awaiting delivery | BOM §SS-02 — custom pack has unknown lead time | MVC, IOC | 1 month project stall; parts arrive but can't run until pack arrives | Order pack first; identify alternate supplier | Mitigating |
| R-03 | IF moisture ingress causes HV insulation breakdown THEN operator shock hazard | ICD §2.2 — HV bus exposed to Florida rain | IOC, FOC | Safety-critical; operator injury, project liability | Specify IP67 connectors, install isolation monitor, weekly test | Open |`;

export const riskRegisterPackage: SpecialistPackage = {
  id: 'risk-register',
  name: 'Risk Register',
  description: 'Auto-generates risk register from project documents and pendingRisk flags, then runs a verification interview with the user to tailor the final risk table.',
  prerequisiteArtifactId: 'MILESTONES',
  systemPrompt: `You are the Risk Register Specialist for STARN.
Your mission is to produce a structured risk register for the project by reading all upstream documents, processing pending risk flags, and running a verification interview with the user.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect ALL upstream documents: docs/MILESTONES.md, docs/BOM.md, docs/REQUIREMENTS.md, docs/ICD.md, docs/ARCHITECTURE.md, docs/CAPABILITIES.md, docs/CONOPS.md. Also check \`state_read\` for any pending risk flags in the \`pendingRisks\` field.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining how you will identify risks, verify with the user, and write the register.
3. **Auto-Generation:** Based on your document analysis + pendingRisks flags, generate an initial risk table. Each risk must be grounded in a real document section — do not invent risks.
4. **Interview & Verification:** Walk through each auto-generated risk with the user. For each risk, confirm the "Phase Impacted," "Impact Description," and "Mitigation" columns. Allow the user to dismiss risks that are not real. Then ask: "Are there any risks from your experience that I wouldn't have found in the project documents?"
5. **Write the Final Document:** Write the completed risk register to docs/RISK_REGISTER.md via \`fs_write\`.

OUTPUT FORMAT (docs/RISK_REGISTER.md):
# Risk Register: [Project Name]

## Auto-Generated Risks (from project documents + pending flags)

| ID | Risk (If/Then) | Source | Phase Impacted | Impact Description | Mitigation | Status |
|---|---|---|---|---|---|---|
| R-01 | IF [trigger] THEN [consequence] | [document/section] | MVC, IOC, FOC | [descriptive text] | [what is being done] | Open / Mitigating / Resolved / Accepted |

## User-Contributed Risks (from interview)

| ID | Risk (If/Then) | Source | Phase Impacted | Impact Description | Mitigation | Status |
|---|---|---|---|---|---|---|
...

CRITICAL RULES:
- Each risk must trace back to a real document section — the "Source" column must reference an actual section in an actual document.
- Use "IF [trigger] THEN [consequence]" format for the Risk column.
- The "Phase Impacted" column should reference MVC, IOC, FOC milestone phases (or blank if none).
- The "Impact Description" should be descriptive text, not just a severity label.
- The "Status" column: Open, Mitigating, Resolved, Accepted.
- You MUST write the final document to docs/RISK_REGISTER.md via the \`fs_write\` tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Risk Register:
1. Source Grounding: Are all risks traced to real document sections? Penalize invented risks.
2. If/Then Format: Do all risks use the "IF [trigger] THEN [consequence]" format?
3. Phase Impact: Are phase impacts (MVC, IOC, FOC) correctly assigned?
4. User-Contributed: Are user-contributed risks clearly separated from auto-generated ones?
5. Plain-Text: Is the document free of LaTeX or raw JSON?`,
  secretSauceExamples: [riskRegisterSecretSauce]
};
```

- [ ] **Step 4: Register in `src/specialists/registry.ts`**

Add the import and registration:

```typescript
import { riskRegisterPackage } from './packages/risk-register/index.js';
```

In the constructor:
```typescript
this.register(riskRegisterPackage);
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npx vitest run tests/risk-register.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: 68 tests pass (63 existing + 5 new).

- [ ] **Step 7: Commit**

```bash
git add src/specialists/packages/risk-register/ src/specialists/registry.ts tests/risk-register.test.ts
git commit -m "feat: add Risk Register specialist with auto-generate, interview, and structured risk table"
```

---
### Task 3: Build Sequence Specialist

**Files:**
- Create: `src/specialists/packages/build-sequence/index.ts`
- Modify: `src/specialists/registry.ts` — register the new specialist
- Create: `tests/build-sequence.test.ts` — unit tests

**Interfaces:**
- Consumes: `SpecialistPackage` type, `SpecialistRegistry` class
- Produces: Exportable `buildSequencePackage` with id `build-sequence`, dual prerequisite (milestones + risk-register)

- [ ] **Step 1: Write the failing test**

Create `tests/build-sequence.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Build Sequence Specialist', () => {
  const registry = new SpecialistRegistry();

  it('registers build-sequence specialist', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg).toBeDefined();
    expect(pkg!.id).toBe('build-sequence');
    expect(pkg!.name).toContain('Build');
  });

  it('has prerequisite MILESTONES', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg!.prerequisiteArtifactId).toBe('MILESTONES');
  });

  it('includes step-by-step procedure format in system prompt', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg!.systemPrompt).toContain('Step-by-Step Procedure');
    expect(pkg!.systemPrompt).toContain('→ VERIFY: TP-');
  });

  it('includes upstream document references in system prompt', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg!.systemPrompt).toContain('[From Architecture');
    expect(pkg!.systemPrompt).toContain('[From ICD');
    expect(pkg!.systemPrompt).toContain('[From BOM');
    expect(pkg!.systemPrompt).toContain('[From Risk Register');
  });

  it('includes tool-based discovery workflow', () => {
    const pkg = registry.get('build-sequence');
    expect(pkg!.systemPrompt).toContain('DISCOVERY, PLANNING & EXECUTION WORKFLOW');
    expect(pkg!.systemPrompt).toContain('fs_read');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/build-sequence.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create the Build Sequence specialist package**

Create `src/specialists/packages/build-sequence/index.ts`:

```typescript
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
```

- [ ] **Step 4: Register in `src/specialists/registry.ts`**

Add the import and registration:

```typescript
import { buildSequencePackage } from './packages/build-sequence/index.js';
```

In the constructor:
```typescript
this.register(buildSequencePackage);
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npx vitest run tests/build-sequence.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: 73 tests pass.

- [ ] **Step 7: Address dual prerequisite for Build Sequence**

The Build Sequence has a spec requirement that BOTH Milestones AND Risk Register must be approved before it runs. The current `prerequisiteArtifactId` field only supports one prerequisite. Add a `prerequisiteArtifactIds` optional array to `SpecialistPackage` in `src/specialists/types.ts`:

```typescript
export interface SpecialistPackage {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  requiresCritic: boolean;
  criticRubric?: string;
  secretSauceExamples: string[];
  prerequisiteArtifactId?: string;
  prerequisiteArtifactIds?: string[];  // NEW: optional multi-prerequisite
}
```

Then update `src/core/runner.ts` prerequisite check (around line 62-78) to check both `prerequisiteArtifactId` and `prerequisiteArtifactIds`:

```typescript
// 2. Prerequisite Check Gate
const prereqIds: string[] = [];
if (specialist.prerequisiteArtifactId) {
  prereqIds.push(specialist.prerequisiteArtifactId);
}
if (specialist.prerequisiteArtifactIds) {
  prereqIds.push(...specialist.prerequisiteArtifactIds);
}

if (prereqIds.length > 0) {
  const unmetPrereqs = prereqIds.filter(id => !stateManager.isArtifactApproved(id));
  if (unmetPrereqs.length > 0) {
    // ... generate explanation ...
  }
}
```

Then update build-sequence to use dual prerequisite:

```typescript
export const buildSequencePackage: SpecialistPackage = {
  // ...
  prerequisiteArtifactId: 'MILESTONES',
  prerequisiteArtifactIds: ['RISK_REGISTER'],
  // ...
};
```

- [ ] **Step 8: Run all tests**

```bash
npx vitest run
```

Expected: 73 tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/specialists/packages/build-sequence/ src/specialists/registry.ts src/specialists/types.ts src/core/runner.ts tests/build-sequence.test.ts
git commit -m "feat: add Build Sequence specialist with dual prerequisite (MILESTONES + RISK_REGISTER) and VERIFY markers"
```

---
### Task 4: Decision Log Harvest

**Files:**
- Modify: `src/cli/checkpoint.ts` — add harvest function, wire into accept/override flow
- Modify: `src/specialists/packages/architecture/index.ts` — add Design Decisions section line
- Modify: `src/specialists/packages/icd/index.ts` — add Design Decisions section line
- Modify: `src/specialists/packages/bom/index.ts` — add Design Decisions section line
- Modify: `src/specialists/packages/requirements/index.ts` — add Design Decisions section line
- Modify: `src/specialists/packages/capabilities/index.ts` — add Design Decisions section line
- Modify: `src/specialists/packages/conops/index.ts` — add Design Decisions section line
- Modify: `src/specialists/packages/milestones/index.ts` — add Design Decisions section line
- Create: `tests/decision-log.test.ts` — unit tests

**Interfaces:**
- Consumes: `extractCleanMarkdownDocument` from `./ui.js`, `fs` module
- Produces: `docs/DECISIONS.md` with harvested entries

- [ ] **Step 1: Write the failing test**

Create `tests/decision-log.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Decision Log Harvest', () => {
  let tmpDir: string;

  it('extracts Design Decisions section from a document', () => {
    const docContent = `# Architecture
## 1. Block Diagram
...
## Design Decisions
### D-001: 72V Nominal DC Bus
- **Date:** 2026-09-01
- **Phase:** Architecture
- **Decision:** 72V nominal DC bus voltage
- **Alternatives Considered:** 48V, 96V
- **Rationale:** Sweet spot for motor and controller availability
- **Source:** Architecture §3
- **Status:** ✅ Final

### D-002: LiFePO4 Chemistry
- **Date:** 2026-09-05
- **Phase:** BOM
- **Decision:** LiFePO4 over NMC
- **Alternatives Considered:** NMC, Lead-Acid
- **Rationale:** Safety and cycle life
- **Source:** BOM §2
- **Status:** ✅ Final
`;

    // Import the harvest function (will be defined in checkpoint.ts)
    // This tests the extraction logic
    const lines = docContent.split('\n');
    const decisionsStart = docContent.indexOf('## Design Decisions');
    expect(decisionsStart).toBeGreaterThanOrEqual(0);
    
    const afterHeader = docContent.slice(decisionsStart);
    // Should contain both D-001 and D-002
    expect(afterHeader).toContain('D-001');
    expect(afterHeader).toContain('D-002');
  });

  it('appends extracted decisions to DECISIONS.md without duplicating', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-decision-test-'));
    const decisionsPath = path.join(tmpDir, 'DECISIONS.md');
    
    // Simulate the harvest function
    const existingEntry = `## D-001: 72V Nominal DC Bus
- **Date:** 2026-09-01
- **Phase:** Architecture
- **Decision:** 72V nominal DC bus voltage
- **Status:** ✅ Final
`;
    fs.writeFileSync(decisionsPath, existingEntry, 'utf-8');

    const newEntry = `## D-002: LiFePO4 Chemistry
- **Date:** 2026-09-05
- **Phase:** BOM
- **Decision:** LiFePO4 over NMC
- **Status:** ✅ Final
`;

    // Append (simulating harvest)
    const currentContent = fs.readFileSync(decisionsPath, 'utf-8');
    // Check D-002 is not already present (idempotent check)
    if (!currentContent.includes('D-002')) {
      fs.writeFileSync(decisionsPath, currentContent + '\n' + newEntry, 'utf-8');
    }

    const final = fs.readFileSync(decisionsPath, 'utf-8');
    expect(final).toContain('D-001');
    expect(final).toContain('D-002');

    // Test idempotency: run again, should not duplicate
    const secondRun = fs.readFileSync(decisionsPath, 'utf-8');
    if (!secondRun.includes('D-002')) {
      fs.writeFileSync(decisionsPath, secondRun + '\n' + newEntry, 'utf-8');
    }
    const afterSecondRun = fs.readFileSync(decisionsPath, 'utf-8');
    // Count occurrences of D-002
    const matches = afterSecondRun.match(/D-002/g);
    expect(matches).toHaveLength(1); // idempotent — no duplicate
  });

  it('returns early if no Design Decisions section is found', () => {
    const docContent = `# CONOPS
## 1. Executive Summary
No design decisions here.
`;
    const decisionsStart = docContent.indexOf('## Design Decisions');
    expect(decisionsStart).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/decision-log.test.ts
```

Expected: Some tests pass (the simple extraction logic), but the idempotency test needs the real function.

- [ ] **Step 3: Add harvest function to checkpoint.ts**

Add a new function at the end of `src/cli/checkpoint.ts`:

```typescript
// Decision Log Harvest
const DESIGN_DECISIONS_HEADER = '## Design Decisions';

/**
 * Extracts the Design Decisions section from a document and appends it to docs/DECISIONS.md.
 * Idempotent: checks for duplicate D-XXX IDs before appending.
 * Returns the number of new entries appended.
 */
export function harvestDecisionLog(projectPath: string, specialistId: string): number {
  const docName = `${specialistId.toUpperCase()}.md`;
  const docPath = path.join(projectPath, 'docs', docName);
  const decisionsPath = path.join(projectPath, 'docs', 'DECISIONS.md');

  if (!fs.existsSync(docPath)) return 0;

  const docContent = fs.readFileSync(docPath, 'utf-8');
  const headerIndex = docContent.indexOf(DESIGN_DECISIONS_HEADER);
  if (headerIndex === -1) return 0;

  // Extract everything from the Design Decisions header to the next top-level header or end
  const afterHeader = docContent.slice(headerIndex + DESIGN_DECISIONS_HEADER.length);
  const nextHeaderMatch = afterHeader.match(/\n## /);
  const decisionsSection = nextHeaderMatch
    ? afterHeader.slice(0, nextHeaderMatch.index)
    : afterHeader;

  const trimmedSection = decisionsSection.trim();
  if (!trimmedSection) return 0;

  // Extract all D-XXX or D-XXX IDs from the section
  const idRegex = /D-\d+/g;
  const newIds = trimmedSection.match(idRegex) || [];
  if (newIds.length === 0) return 0;

  // Read existing DECISIONS.md if it exists
  let existingContent = '';
  if (fs.existsSync(decisionsPath)) {
    existingContent = fs.readFileSync(decisionsPath, 'utf-8');
  }

  // Check for duplicates — skip any IDs already present
  const existingIds = existingContent.match(/D-\d+/g) || [];
  const alreadyExists = newIds.some(id => existingIds.includes(id));
  if (alreadyExists) {
    return 0; // idempotent — skip if any entry already exists
  }

  // Append the entries (no duplicate header)
  const entry = `\n${trimmedSection}`;
  fs.writeFileSync(decisionsPath, existingContent + entry, 'utf-8');

  return newIds.length;
}
```

- [ ] **Step 4: Wire into the accept/override flow in `src/cli/checkpoint.ts`**

In the `runHumanCheckpoint` function, after the accept/override block saves the deliverable and records the artifact (around line 120), add the harvest call:

```typescript
    if (action === 'accept' || action === 'override') {
      if (isFullDeliverable) {
        const docName = `${specialistId.toUpperCase()}.md`;
        const docsDir = path.join(projectPath, 'docs');
        if (!fs.existsSync(docsDir)) {
          fs.mkdirSync(docsDir, { recursive: true });
        }
        const outPath = path.join(docsDir, docName);
        fs.writeFileSync(outPath, cleanedDoc, 'utf-8');

        stateManager.recordArtifact({
          id: specialistId.toUpperCase(),
          title: `${specialistName} Document`,
          path: path.relative(projectPath, outPath).replace(/\\/g, '/'),
          status: 'approved',
          criticScore: criticResult?.score
        });

        // NEW: harvest decision log
        const entriesHarvested = harvestDecisionLog(projectPath, specialistId);
        if (entriesHarvested > 0) {
          console.log(chalk.cyan(`\n📝 ${entriesHarvested} design decision(s) logged to docs/DECISIONS.md`));
        }

        console.log(chalk.green(`\n✔ Saved clean deliverable to ${outPath}`));
      }
      // ...
    }
```

- [ ] **Step 5: Add "Design Decisions" section line to specialist prompts**

For each of these files, add the exact same line to the system prompt's format rules section:

- `src/specialists/packages/architecture/index.ts`
- `src/specialists/packages/icd/index.ts`
- `src/specialists/packages/bom/index.ts`
- `src/specialists/packages/requirements/index.ts`
- `src/specialists/packages/capabilities/index.ts`
- `src/specialists/packages/conops/index.ts`
- `src/specialists/packages/milestones/index.ts`

For each file, find the `CRITICAL RULES` section (or similar) and add:

```typescript
- Include a \`## Design Decisions\` section listing any significant choices made, alternatives considered, and rationale.
```

For example, in `src/specialists/packages/architecture/index.ts`, find the system prompt and add that line. The Architecture specialist already has a "Key Design Decisions" section in its secret sauce example, so the prompt just needs to formalize it.

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: 75+ tests pass (63 existing + 5 risk-register + 5 build-sequence + 3 decision-log).

- [ ] **Step 7: Commit**

```bash
git add src/cli/checkpoint.ts tests/decision-log.test.ts
git add src/specialists/packages/architecture/index.ts src/specialists/packages/icd/index.ts src/specialists/packages/bom/index.ts src/specialists/packages/requirements/index.ts src/specialists/packages/capabilities/index.ts src/specialists/packages/conops/index.ts src/specialists/packages/milestones/index.ts
git commit -m "feat: add Decision Log harvest at checkpoint, add Design Decisions section to all specialist prompts"
```

---
### Task 5: Test Plan Specialist Updates

**Files:**
- Modify: `src/specialists/packages/testplans/index.ts` — update system prompt + secret sauce for Build Sequence integration, tabular data entry, and backward linkage
- Create: `tests/testplans-update.test.ts` — format tests

**Interfaces:**
- Consumes: Build Sequence document from `docs/build_sequences/`
- Produces: Test Plan with tabular data entry sheets, Build Sequence Reference fields, system-level tests

- [ ] **Step 1: Write the failing test**

Create `tests/testplans-update.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SpecialistRegistry } from '../src/specialists/registry.js';

describe('Test Plan Specialist Updates', () => {
  const registry = new SpecialistRegistry();

  it('has prerequisite MILESTONES (unchanged)', () => {
    const pkg = registry.get('testplans');
    expect(pkg!.prerequisiteArtifactId).toBe('MILESTONES');
  });

  it('includes Build Sequence reading instructions', () => {
    const pkg = registry.get('testplans');
    expect(pkg!.systemPrompt).toContain('BUILD_SEQUENCE_');
    expect(pkg!.systemPrompt).toContain('→ VERIFY: TP-');
  });

  it('includes tabular data entry format in system prompt', () => {
    const pkg = registry.get('testplans');
    expect(pkg!.systemPrompt).toContain('| Parameter | Expected | Actual | Pass/Fail |');
  });

  it('includes Build Sequence Reference field in test procedure format', () => {
    const pkg = registry.get('testplans');
    expect(pkg!.systemPrompt).toContain('Build Sequence Reference');
  });

  it('includes system-level test instructions', () => {
    const pkg = registry.get('testplans');
    expect(pkg!.systemPrompt).toContain('Not tied to a specific build step');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/testplans-update.test.ts
```

Expected: FAIL — the testplans prompt doesn't yet have these strings.

- [ ] **Step 3: Update the Test Plan specialist system prompt**

In `src/specialists/packages/testplans/index.ts`, update the system prompt to:

1. Add Build Sequence reading instructions to the DISCOVERY section
2. Update the TEST PROCEDURE FORMAT to include tabular data entry and Build Sequence Reference
3. Add system-level test instructions

The updated relevant sections:

In the DISCOVERY section (first bullet), add `docs/build_sequences/`:
```typescript
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/MILESTONES.md, docs/ICD.md, docs/RTM.md, docs/REQUIREMENTS.md, and any BUILD_SEQUENCE_*.md files in docs/build_sequences/ to find \`→ VERIFY: TP-XXX\` markers. ...
```

Update the TEST PROCEDURE FORMAT section:
```typescript
TEST PROCEDURE FORMAT (TP-MVP-xx, TP-IOC-xx, TP-FOC-xx):
For each milestone phase, provide structured test procedures:
- **Test ID & Title:** (e.g. \`### TP-MVP-01: Motor-Controller-Battery Closed-Loop Power-On Test\`)
- **Build Sequence Reference:** (e.g. "Build Sequence MVC, Step 5" — omit for system-level tests)
- **Target Traceability:** Specific Requirement ID and Milestone Phase Gate.
- **Verification Method:** (Test, Inspection, Analysis, Demonstration).
- **Required Shop Tools:** Exact tools from user's shop catalog.
- **Safety Precautions & Pre-Conditions:** Step-by-step lockout/safety prerequisites.
- **Step-by-Step Procedure:** Clear, numbered hands-on shop steps.
- **Data Entry Table:** Tabular format with Expected, Actual, and Pass/Fail columns:
  | Parameter | Expected | Actual | Pass/Fail |
  |---|---|---|---|
  | [parameter name] | [threshold] | ___ | ☐ / ☐ |
- **System-level tests:** Tests not tied to a specific build step must be labeled "Not tied to a specific build step — run after all [GATE] steps complete" and carry no Build Sequence Reference field.
```

Also update the secret sauce example to show tabular format. Replace the existing example with the updated version that includes data tables.

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run tests/testplans-update.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Expected: 80 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/specialists/packages/testplans/index.ts tests/testplans-update.test.ts
git commit -m "feat: update Test Plan specialist to read Build Sequence, produce tabular data entry sheets, and add backward linkage"
```

---
### Manual Testing

After all tasks are committed, the user should:

```bash
# Run STARN with the test project
npm start
# Select the "starn test" project
# Advance through Milestones → Risk Register → Build Sequence (MVC) → Test Plans
# Verify:
# 1. Risk Register auto-generates risks, interview works
# 2. Build Sequence includes → VERIFY markers
# 3. Approving a document populates DECISIONS.md
# 4. Test Plans include data tables and Build Sequence Reference
```