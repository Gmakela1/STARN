import { SpecialistPackage } from '../../types.js';

const icdSecretSauce = `# Interface Control Document (ICD): Electric Tractor Powertrain Conversion

## 1. Mechanical Interfaces

### ICD-M-01: SS-01 (Traction Motor) ↔ Transmission
- **Type:** Mechanical shaft coupling + bellhousing
- **Parameters:**
  - Bolt pattern: SAE 3 bellhousing, 4x 3/8"-16 bolts on 5.5" bolt circle
  - Pilot diameter: 2.5" (unknown — verify motor shaft pilot)
  - Shaft engagement: Splined, 1.0" diameter, 1.5" engagement depth
  - Max torque: 60 Nm continuous, 120 Nm peak
  - Max RPM: 3,500 RPM
- **Open items:** Pilot diameter and spline spec must be measured from the actual motor shaft once selected.

### ICD-M-02: SS-01 (Traction Motor) ↔ SS-06 (Chassis Frame)
- **Type:** Mechanical isolator mounts
- **Parameters:**
  - Mounting: 4x 1/2" rubber isolation mounts, M10 bolts
  - Bolt torque: 35 ft-lbs
  - Load: 25 kg static (motor weight)
- **Open items:** Mount locations depend on RK19 engine bay dimensions — measure before fabricating.

### ICD-M-03: SS-02 (Battery Pack) ↔ SS-06 (Chassis Frame)
- **Type:** Mechanical bolted tray
- **Parameters:**
  - Mounting: 6x M8 bolts, 12" x 18" footprint
  - Bolt torque: 25 ft-lbs
  - Load: 38 kg static (battery weight)
- **Open items:** Exact tray dimensions depend on final battery candidate selection.

## 2. Electrical Interfaces

### ICD-E-01: SS-03 (Motor Controller) ↔ SS-02 (Battery Pack)
- **Type:** DC power bus
- **Parameters:**
  - Nominal voltage: 72V DC (design decision DD-01, pending confirmation)
  - Max continuous current: 120A
  - Peak current: 250A (30 seconds)
  - Wire gauge: 2/0 AWG (for 250A peak with 105°C insulation)
  - Connector: Anderson SB175 or equivalent
- **Open items:** Final connector type depends on selected controller and battery.

### ICD-E-02: SS-03 (Motor Controller) ↔ SS-01 (Traction Motor)
- **Type:** 3-phase AC power
- **Parameters:**
  - Voltage: 72V AC (nominal, phase-to-phase)
  - Max continuous current: 120A per phase
  - Wire gauge: 4 AWG, 105°C rated, with abrasion-resistant jacket
  - Connector: Ring terminals on controller and motor posts, M8
- **Open items:** None — wiring is standard for this power class.

### ICD-E-03: SS-04 (HV Safety) ↔ SS-02 (Battery Pack)
- **Type:** DC power bus (main contactor path)
- **Parameters:**
  - Voltage: 72V DC (same as ICD-E-01)
  - Max continuous current: 250A
  - Fusing: 250A Class-T fuse
  - Precharge: 100 ohm, 10W resistor with contactor bypass
- **Open items:** Fuse rating depends on final battery peak current spec.

## 3. Data / Signal Interfaces

### ICD-D-01: SS-03 (Motor Controller) ↔ SS-05 (Dashboard)
- **Type:** CAN bus 2.0B
- **Parameters:**
  - Baud rate: 250 kbps
  - Protocol: CANopen or vendor-specific (depends on controller selection)
  - Data payloads: Motor RPM, battery voltage, motor temperature, fault codes, state-of-charge
- **Open items:** Exact message IDs and protocol depend on the selected controller brand.

### ICD-D-02: SS-02 (BMS) ↔ SS-05 (Dashboard)
- **Type:** Serial UART or CAN bus
- **Parameters:**
  - Data payloads: Cell voltages, pack temperature, SOC, fault flags
- **Open items:** Protocol depends on selected BMS.

## 4. Thermal Interfaces

### ICD-T-01: SS-03 (Motor Controller) → Ambient
- **Type:** Forced air convection
- **Parameters:**
  - Heat rejection: 200W at 6.0kW continuous output
  - Cooling fan: 200mm, 300 CFM, 12V DC
  - Ducting: 4x 6" diameter flexible duct to exterior
- **Open items:** Fan placement depends on final controller mounting location.

### ICD-T-02: SS-02 (Battery Pack) → Ambient
- **Type:** Passive convection
- **Parameters:**
  - Max cell temperature: 55°C (LiFePO4)
  - Ambient operating range: 0°C to 45°C
- **Open items:** If ambient exceeds 45°C in Florida garage, active cooling may be needed.`;

export const icdPackage: SpecialistPackage = {
  id: 'icd',
  name: 'Interface Control Document (ICD)',
  description: 'Defines mechanical, electrical, data, and thermal interfaces between every pair of subsystems identified in the System Architecture.',
  prerequisiteArtifactId: 'ARCHITECTURE',
  systemPrompt: `You are the Interface Control Document (ICD) Specialist for STARN.
Your mission is to define the formal interfaces between every pair of subsystems identified in the approved System Architecture document.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/ARCHITECTURE.md. Read the block diagram, subsystem catalog, and interface relationships. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining which interfaces you will define and in what order.
3. **Execution & Traceability:** Execute each step in your running plan, grounding every interface in a relationship identified in the Architecture block diagram.

INTERFACE CATEGORIES (MANDATORY):
Group interfaces into these four domains:
1. **Mechanical Interfaces (ICD-M-xx):** Bolt patterns, pilot diameters, shaft splines, mounting torque, loads, engagement depths.
2. **Electrical Interfaces (ICD-E-xx):** Voltage, current, wire gauge, connector type, pinout, insulation rating.
3. **Data / Signal Interfaces (ICD-D-xx):** Protocol, baud rate, message IDs, data payloads, voltage levels.
4. **Thermal Interfaces (ICD-T-xx):** Heat rejection, cooling method, airflow, ducting, thermal limits.

MANDATORY DOCUMENT STRUCTURE:
1. **## 1. Mechanical Interfaces** — ICD-M-01, ICD-M-02...
2. **## 2. Electrical Interfaces** — ICD-E-01, ICD-E-02...
3. **## 3. Data / Signal Interfaces** — ICD-D-01, ICD-D-02...
4. **## 4. Thermal Interfaces** — ICD-T-01, ICD-T-02...

INTERFACE FORMAT (MANDATORY):
For each interface, provide:
- **Interface ID & Title:** (e.g. \`### ICD-M-01: SS-01 ↔ Transmission\`)
- **Type:** The nature of the connection (mechanical shaft, DC power bus, CAN bus, forced air)
- **Parameters:** Specific engineering parameters relevant to the interface type
- **Open items:** Any parameters that are genuinely unknown and must be resolved later

CRITICAL RULES:
- Every interface MUST trace to a relationship between two subsystems in the Architecture block diagram.
- If a parameter is genuinely unknown (e.g., exact bolt pattern depends on motor selection), flag it as an open item — do NOT silently assume a value.
- Use clean plain-text units (e.g., 72V, 120A, 2/0 AWG, M8, 35 ft-lbs).
- DO NOT use LaTeX math formatting.
- You MUST write the final document to docs/ICD.md via the fs_write tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Interface Control Document (ICD):
1. Architecture Traceability: Does every interface trace to a relationship between two subsystems in the Architecture block diagram?
2. Domain Coverage: Are interfaces organized into all four domains (mechanical, electrical, data, thermal)?
3. Parameter Completeness: Are the right parameters defined for each interface type (bolt patterns for mechanical, voltage/current for electrical, baud rate/protocol for data)?
4. Open Item Flagging: Are genuinely unknown parameters flagged as open items rather than silently assumed?
5. Plain-Text Units: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [icdSecretSauce]
};