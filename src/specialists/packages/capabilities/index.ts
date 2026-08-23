import { SpecialistPackage } from '../../types.js';

const capabilitiesSecretSauce = `# Product Capabilities & System Requirements: Solar Frame & Enclosure

## 1. Functional Capabilities
- **CAP-01 [Power Generation]:** The system shall capture solar radiation via an 8-panel monocrystalline array producing nominal 3.2 kW DC peak under 1000 W/m² irradiance.
- **CAP-02 [Energy Storage]:** The battery subsystem shall store 15.3 kWh nominal (48V 300Ah LiFePO4) with active BMS cell balancing (100A continuous discharge rate).
- **CAP-03 [Environmental Enclosure]:** The structure shall maintain internal ambient temperature between 5°C and 35°C under external extremes (-20°C to +40°C) using active thermostatic intake/exhaust (minimum 250 CFM).

## 2. Structural & Mechanical Specifications
- **SPEC-01 [Framing]:** 2x6 Douglas Fir structural lumber spaced 16-inch on-center; hurricane ties (Simpson Strong-Tie H2.5A) on every rafter-to-wall junction.
- **SPEC-02 [Roof Pitch & Dead Load]:** Single-pitch shed roof at 4:12 slope, rated for 30 psf live load + 15 psf panel dead load.
- **SPEC-03 [Foundation Tie-Down]:** Anchored to 6x concrete sonotubes using 5/8-inch galvanized J-bolts embedded 8 inches in 3000 PSI concrete.

## 3. Verification & Acceptance Criteria
| Requirement ID | Verification Method | Acceptance Threshold |
| :--- | :--- | :--- |
| CAP-01 | Test (Fluke clamp + irradiance meter) | >= 2.9 kW at solar noon (clear sky) |
| CAP-02 | Test (Load bank discharge at 48V 50A) | >= 14.5 kWh delivered to 10% SOC cutoff |
| SPEC-01 | Inspection (Field tape measure & torque log) | Framing 16" OC +/- 0.25", ties torqued to spec |`;

export const capabilitiesPackage: SpecialistPackage = {
  id: 'capabilities',
  name: 'Capabilities & System Requirements',
  description: 'Defines formal functional capabilities, structural/electrical specifications, and verification matrices.',
  systemPrompt: `You are the Systems Engineering & Requirements Specialist for STARN.
Your mission is to author precise, numbered capabilities, hardware specifications, and verification matrices for physical projects.

MANDATORY SECTIONS:
1. System Functional Capabilities (CAP-xx: Numbered, measurable behavioral requirements)
2. Structural, Electrical & Physical Specifications (SPEC-xx: Framing, materials, voltages, tolerances)
3. Environmental & Safety Requirements (ENV-xx: Ingress protection, thermal management, fire resistance)
4. Requirements Verification Matrix (RVM table with ID, Requirement, Verification Method [Test/Inspection/Analysis], Acceptance Threshold)

CRITICAL RULES:
- Use formal requirements language ("shall", "must").
- Every requirement must be verifiable and testable. No ambiguous qualitative adjectives ("lightweight", "durable", "efficient") without numeric thresholds.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Capabilities & Requirements document:
1. Measurability: Are requirements numbered and tied to verifiable numeric metrics (tolerances, voltages, weights, dimensions)?
2. Completeness: Are mechanical, electrical, thermal, and structural domains addressed?
3. Verification Matrix: Does every requirement have an explicit test/inspection method and unambiguous pass/fail criteria?`,
  secretSauceExamples: [capabilitiesSecretSauce]
};
