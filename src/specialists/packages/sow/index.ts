import { SpecialistPackage } from '../../types.js';

const sowSecretSauce = `# Statement of Work (SOW): Turnkey Solar Power Workshop Framing & Electrical

## 1. Project Objective & Scope of Work
Contractor shall furnish all labor, structural materials, fasteners, and certified testing required to erect a 120 sq ft insulated timber structure with roof-mounted 3.2kW PV array and 48V energy storage subsystem located at the specified project site.

## 2. Contractor Deliverables & Specifications
- **Deliverable 1 [Substructure]:** 6x 12" diameter concrete piers poured past 36" depth with 5/8" hot-dipped galvanized post anchors.
- **Deliverable 2 [Weather-Tight Shell]:** 2x6 Douglas Fir wall framing 16" OC, 1/2" CDX sheathing, Tyvek housewrap, and 26-gauge standing seam metal roof.
- **Deliverable 3 [Electrical & Microgrid]:** Unirac rail mounting of 8x 400W solar modules, installation of 5kW 48V inverter/charger, and UL9540 compliant battery containment cabinet.

## 3. Performance Standards & Codes
- All construction shall adhere to 2021 International Residential Code (IRC) and National Electrical Code (NEC Article 690 & 706).
- Minimum structural warranty: 5 years against moisture intrusion and structural deflection.

## 4. Acceptance Criteria & Payment Milestones
| Milestone | Description | Acceptance Criteria | Percentage |
| :--- | :--- | :--- | :--- |
| M1: Foundation | Piers poured & cured | Plumb inspection & 3000 PSI certificate | 25% |
| M2: Dry-In | Enclosure & roof complete | 30-min hose spray test without leaks | 35% |
| M3: Commissioning | Inverter energized & tested | 4-hr 3kW load test & ground resistance <25 Ohm | 40% |`;

export const sowPackage: SpecialistPackage = {
  id: 'sow',
  name: 'Statement of Work (SOW)',
  description: 'Authors formal contractor Statements of Work, tailor-fit for turnkey builders, specialized trade subcontractors, or DIY self-build.',
  prerequisiteArtifactId: 'WBS',
  systemPrompt: `You are the Statement of Work (SOW) & Contracting Specialist for STARN.
Your mission is to formulate formal, technically sound Statements of Work tailored to the user's contracting strategy.

CONTRACTING STRATEGY & TAILORING (MANDATORY):
Before authoring a Statement of Work, understand the user's contracting strategy:
1. **DIY / Self-Built (0 SOWs):** If the user is doing 100% of the work themselves, no SOW document is required. Acknowledge and document that all WBS work packages are self-executed.
2. **Turnkey General Contractor (1 SOW):** If contracting out the complete project, author a single comprehensive SOW covering all deliverables in docs/SOW.md.
3. **Multi-Contractor / Specialized Trades (Multiple SOWs):** If contracting specific specialized packages (e.g., CNC bellhousing machining, high-voltage battery assembly, or roofing), tailor dedicated SOWs (e.g., docs/SOW_MACHINING.md, docs/SOW_ELECTRICAL.md) referencing the specific WBS work packages and RTM acceptance thresholds.

MANDATORY SECTIONS FOR CONTRACTOR SOW:
1. Project Objective & Scope of Work (Clear boundaries on what is and is not included)
2. Detailed Deliverables & Specifications (Referencing WBS package IDs)
3. Applicable Engineering Codes, Standards & Warranties (NEC, IRC, ASTM, UL)
4. Acceptance Criteria & Phased Payment Milestones (Referencing RTM verification criteria)
5. Schedule, Site Constraints & Safety Requirements

CRITICAL RULES:
- Use clean plain-text units. DO NOT use LaTeX math formatting.
- Write the final document to docs/SOW.md (or docs/SOW_<TRADE>.md) or return complete markdown.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Statement of Work (SOW):
1. Scope Boundaries & Strategy: Are contractor scope inclusions and exclusions clearly demarcated based on the contracting strategy?
2. Contractor Deliverables: Are technical deliverables and materials unambiguously specified and aligned with WBS packages?
3. Acceptance & Milestones: Are payment milestones tied to objective, verifiable RTM test criteria?
4. Plain-Text Units: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [sowSecretSauce]
};
