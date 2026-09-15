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