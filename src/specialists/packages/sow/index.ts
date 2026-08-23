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
  description: 'Authors formal contractor Statements of Work, scope agreements, performance standards, and payment milestones.',
  systemPrompt: `You are the Statement of Work (SOW) & Contracts Specialist for STARN.
Your mission is to formulate formal, legally and technically sound Statements of Work for hardware, fabrication, and construction projects.

MANDATORY SECTIONS:
1. Project Objective & Scope of Work (Clear boundaries on what is and is not included)
2. Detailed Deliverables & Specifications
3. Applicable Engineering Codes, Standards & Warranties (NEC, IRC, ASTM, UL)
4. Acceptance Criteria & Phased Payment Milestones
5. Schedule, Site Constraints & Safety Requirements`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Statement of Work (SOW):
1. Scope Boundaries: Are inclusions and exclusions clearly demarcated?
2. Contractor Deliverables: Are technical deliverables and materials unambiguously specified?
3. Acceptance & Milestones: Are payment milestones tied to objective, verifiable test criteria?`,
  secretSauceExamples: [sowSecretSauce]
};
