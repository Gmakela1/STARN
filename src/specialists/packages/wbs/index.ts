import { SpecialistPackage } from '../../types.js';

const wbsSecretSauce = `# Work Breakdown Structure (WBS): Off-Grid Solar Shed & Microgrid

## 1.0 Site Preparation & Substructure (MVP Component 1)
- **1.1 Site Excavation & Layout**
  - 1.1.1 Survey property boundaries, mark 12x10 ft footprint, and verify 10 ft setbacks.
  - 1.1.2 Excavate topsoil 6 inches depth and install geotextile weed fabric + 4 inches crushed stone.
- **1.2 Concrete Sonotube Piers**
  - 1.2.1 Auger 6x 12-inch diameter holes to 36-inch depth (below regional frost line).
  - 1.2.2 Set cardboard sonotubes, insert rebar cages (2x #4 vertical), and level top elevation (+/- 1/8").
  - 1.2.3 Pour 3000 PSI concrete and embed 5/8" galvanized adjustable post saddles.

## 2.0 Superstructure & Thermal Envelope (MVP Component 2)
- **2.1 Floor Platform**
  - 2.1.1 Install 4x6 pressure-treated skid beams anchored to post saddles.
  - 2.1.2 Frame floor with 2x8 pressure-treated joists at 16" on-center; install hardware cloth rodent barrier.
  - 2.1.3 Glue and screw 3/4" tongue-and-groove marine-grade plywood subfloor.
- **2.2 Wall Framing & Sheathing**
  - 2.2.1 Frame 2x6 stud walls at 16" OC with double top plates and engineered header for 36" steel door.
  - 2.2.2 Fasten 1/2" CDX plywood sheathing with 8d galvanized ring-shank nails (6" edge, 12" field).
  - 2.2.3 Install vapor-permeable housewrap (Tyvek) with all seams taped.
- **2.3 Roof Structure & Weatherproofing**
  - 2.3.1 Cut and install 2x8 rafters at 24" OC with 4:12 pitch and Simpson H2.5A hurricane ties.
  - 2.3.2 Install 5/8" plywood decking + full self-adhering ice & water shield membrane.
  - 2.3.3 Install 26-gauge standing seam metal roofing panels and drip edge flashing.

## 3.0 Electrical & Solar Infrastructure (IOC Component 1)
- **3.1 Photovoltaic Array Mounting**
  - 3.1.1 Fasten Unirac SolarMount rails using stainless steel brackets and butyl sealant flashing.
  - 3.1.2 Mount 8x 400W Tier-1 bifacial panels wired in 2S4P configuration.
  - 3.1.3 Route 10 AWG PV-wire in 3/4" schedule 80 PVC conduit through roof penetration fitting.
- **3.2 Power Conversion & Storage Integration**
  - 3.2.1 Mount 5kW 48V split-phase Inverter/Charger and dual MPPT charge controllers on fire-rated backboard.
  - 3.2.2 Install 15kWh server-rack LiFePO4 battery cabinet with 250A Class-T fuse and disconnect switch.
  - 3.2.3 Install 100A sub-panel, bond ground bus to 2x 8ft copper ground rods spaced 6ft apart.

## 4.0 Mechanical, Environmental & Commissioning (FOC Component 1)
- **4.1 Thermal & Airflow Management**
  - 4.1.1 Install Rockwool R-23 batt insulation in walls and R-30 in ceiling.
  - 4.1.2 Install 12V thermostat-controlled 250 CFM intake louvers and exhaust fan with insect mesh.
- **4.2 System Commissioning & Acceptance**
  - 4.2.1 Perform insulation resistance testing (megger) on AC branch circuits.
  - 4.2.2 Execute 4-hour continuous 3.5 kW load test; verify inverter thermal performance.
  - 4.2.3 Generate as-built wiring schematic, operational checklist, and emergency shutoff placard.`;

export const wbsPackage: SpecialistPackage = {
  id: 'wbs',
  name: 'Work Breakdown Structure (WBS)',
  description: 'Decomposes work into component work packages structured to achieve Milestone 1 (MVP) first, followed by operational milestones.',
  prerequisiteArtifactId: 'MILESTONES',
  systemPrompt: `You are the Work Breakdown Structure (WBS) & Construction Specialist for STARN.
Your mission is to construct a hierarchical, 100% complete Work Breakdown Structure for physical and hardware projects.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/MILESTONES.md and docs/REQUIREMENTS.md to verify component boundaries and gating requirements.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining how you will decompose physical components into work packages to deliver Milestone 1 (MVP) first.
3. **Execution & Traceability:** Execute each step in your running plan, grounding work packages in specific materials, sizes, and fastener specs.

MILESTONE-GROUNDED COMPONENT BREAKDOWN (MANDATORY):
- Structure component fabrication, procurement, machining, and assembly work packages specifically to build and verify the Milestone 1 (MVP) baseline first, followed by incremental packages for subsequent milestones (IOC, FOC).
- Decompose each physical component into:
  1.0 Substructure & Chassis / Foundation Work Packages (MVP)
  2.0 Primary Structural & Mechanical Assembly Packages (MVP)
  3.0 Electrical, High-Voltage & Power Subsystems (IOC)
  4.0 Controls, Instrumentation, Safety & Commissioning (FOC)

CRITICAL RULES:
- Number every tier hierarchically (1.0 -> 1.1 -> 1.1.1).
- Work packages at level 3 (e.g. 1.2.1) MUST include specific construction details: lumber/metal dimensions, fasteners, wire gauges, torque limits, and spatial intervals.
- Use clean plain-text units. DO NOT use LaTeX math formatting.
- Write the final document to docs/WBS.md or return complete markdown.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Work Breakdown Structure against engineering criteria:
1. Milestone Alignment: Are work packages structured to deliver Milestone 1 (MVP) foundational components first?
2. Hierarchical Depth: Are tasks decomposed to actionable work packages (e.g. 1.1.1 level)?
3. Hardware Specifics: Are materials, structural sizes, fastener types, and electrical ratings explicitly stated?
4. Plain-Text Units: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [wbsSecretSauce]
};
