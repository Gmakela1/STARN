/** Plain-English friendly subtitles so non-technical makers understand each phase. */
export const PHASE_SUBTITLES: Record<string, string> = {
  conops: 'User Intent & Project Charter',
  architecture: 'Subsystem Layout & Flow',
  icd: 'Wiring, Pinouts & Interfaces',
  capabilities: 'What the Machine Must Do',
  requirements: 'Engineering Performance Specs',
  bom: 'Shopping List & Hardware Specs',
  rtm: 'Traceability & Verification Matrix',
  milestones: 'Phase Gates (MVP, IOC, FOC)',
  'risk-register': 'Safety Hazards & Mitigations',
  'build-sequence': 'High-Level Assembly Order',
  'work-instructions': 'Step-by-Step Hands-On Shop Guides',
  testplans: 'Shop Verification Procedures',
  sow: 'Statement of Work & Contractor Scope'
};
