import { SpecialistPackage } from '../../types.js';

const bomSecretSauce = `# Bill of Materials (BOM): Electric Tractor Powertrain Conversion

## SS-01: Traction Motor
- **Requirement SS-01.a:** 6.0 kW continuous, 12.0 kW peak, 72V nominal, 0-3,500 RPM
- **Requirement SS-01.b:** Smooth speed regulation, 60 Nm continuous torque

| Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| ME1115 | 72V, 12kW peak, 28 Nm, 0-4000 RPM, 8.5 kg | ✅ | 4-6 weeks | [mfg link] | $895 |
| Motenergy ME1003 | 48V, 10kW peak, 22 Nm, 0-3500 RPM, 7.2 kg | ⚠️ 48V, not 72V | 3-5 weeks | [mfg link] | $650 |
| Golden Motor HPM5000 | 72V, 8kW cont, 25 Nm, 0-4500 RPM, 11 kg | ⚠️ 8kW < 12kW peak req | 2-3 weeks | [link] | $720 |

## SS-02: Battery Pack
- **Requirement SS-02.a:** >= 5.0 kWh usable capacity, 72V nominal
- **Requirement SS-02.b:** Charge from 120V 15A outlet, < 8 hours

| Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| 20S 72V 80Ah LiFePO4 | 5.76 kWh, 38 kg, 1C continuous, built-in BMS | ✅ | 4-6 weeks | [link] | $1,450 |
| 20S 72V 60Ah LiFePO4 | 4.32 kWh, 30 kg | ❌ 4.32 < 5.0 kWh | 4-6 weeks | [link] | $1,100 |
| DIY 20S 72V 100Ah pouch | 7.2 kWh, 28 kg, custom BMS | ✅ | 8-12 weeks ★★ LONG LEAD | [cell link] | $1,200 |

## SS-03: Motor Controller
- **Requirement SS-03.a:** 60.0V-84.0V DC bus, 120A continuous, 250A peak
- **Requirement SS-03.b:** CAN bus communication, programmable throttle mapping

| Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| Kelly KLS7245N | 24-72V, 120A cont, 250A peak, CAN | ✅ | 2-3 weeks | [link] | $520 |
| Curtis 1234SE | 24-80V, 130A cont, 300A peak, CAN | ✅ | 4-6 weeks | [link] | $780 |
| Sevcon Gen4 | 24-80V, 100A cont, 200A peak, CAN | ⚠️ 100A < 120A req | 6-8 weeks ★ | [link] | $950 |

## SS-04: HV Distribution & Safety
- **Requirement SS-04.a:** Emergency cutoff < 20 ms
- **Requirement SS-04.b:** Isolation resistance >= 500 kOhm

| Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| Gigavac GX14B | 500A, 12V coil, < 5 ms open | ✅ | 2 weeks | [link] | $85 |
| TE Kilovac EV200 | 500A, 12V coil, < 5 ms open | ✅ | 4-6 weeks | [link] | $120 |

## Design Decisions Required
| Issue | Affected Reqs | Options |
|---|---|---|
| Motenergy ME1003 is 48V, not 72V — requires voltage change or rejection | SS-01.a, SS-02.a, ICD-E-01 | 1. Accept 48V system (change Requirements) 2. Drop ME1003, use ME1115 |
| No 72V controller under $800 found | SS-03.a | 1. Accept higher cost 2. Reduce current requirement |
| DIY pouch cells have 8-12 week lead — may delay MVC milestone | SS-02.a, MVC schedule | 1. Order now, accept lead time 2. Use pre-built pack (higher cost, faster) |

## Long-Lead Items (Order Now)
- DIY battery cells: 8-12 weeks ★★
- Custom motor adapter plate machining: 4-6 weeks ★
- ME1115 motor: 4-6 weeks ★`;

export const bomPackage: SpecialistPackage = {
  id: 'bom',
  name: 'Bill of Materials (BOM)',
  description: 'Generates candidate parts per subsystem, checks against requirements, flags long-lead items, and surfaces design decisions when no part fits.',
  prerequisiteArtifactId: 'REQUIREMENTS',
  systemPrompt: `You are the Bill of Materials (BOM) Specialist for STARN.
Your mission is to generate candidate parts for each subsystem based on the approved per-subsystem requirements, and flag any mismatches as design decisions.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/REQUIREMENTS.md, docs/ICD.md, and docs/ARCHITECTURE.md to understand the requirements, interface parameters, and subsystem boundaries. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining which subsystems you will source candidates for and in what order.
3. **Execution & Traceability:** Execute each step in your running plan, grounding every candidate part in the requirements it must satisfy.

BOM STRUCTURE (MANDATORY):
For each subsystem, provide:
1. **Subsystem heading** (e.g., \`## SS-01: Traction Motor\`)
2. **The requirements** that apply to this subsystem (copied from docs/REQUIREMENTS.md)
3. **A candidate part table** with columns:
   - \`Candidate\` — Part name/model
   - \`Specs\` — Key specifications relevant to the requirements
   - \`Satisfies?\` — ✅ (fully satisfies), ⚠️ (partial mismatch), ❌ (does not satisfy)
   - \`Lead Time\` — Estimated procurement lead time
   - \`Source\` — \`[link]\` placeholder (user fills in real URLs)
   - \`Est. Price\` — Estimated price

CRITICAL RULES:
- Each candidate MUST list which requirements it satisfies and which it misses.
- If NO candidate satisfies a critical requirement, add it to the \`## Design Decisions Required\` section with the affected requirements and options.
- Do NOT silently downgrade a requirement to make a candidate fit — flag it as a design decision.
- Mark long-lead items with ★ (4-8 weeks) or ★★ (8+ weeks).
- Include a \`## Long-Lead Items (Order Now)\` section at the end to flag items that could delay the project.
- Datasheet source links use \`[link]\` as placeholder — the user fills in real URLs.
- Use clean plain-text units. DO NOT use LaTeX math formatting.
- You MUST write the final document to docs/BOM.md via the fs_write tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Bill of Materials (BOM):
1. Subsystem Coverage: Does every subsystem from the Architecture have a BOM section?
2. Requirement Coverage: Does every requirement have at least one candidate part listed?
3. Mismatch Flagging: Are requirements with no satisfying candidate explicitly flagged in the Design Decisions section?
4. Lead Time Awareness: Are lead times noted, especially for long-lead items?
5. No Silent Downgrades: Does the document avoid silently reducing requirements to fit available parts?`,
  secretSauceExamples: [bomSecretSauce]
};