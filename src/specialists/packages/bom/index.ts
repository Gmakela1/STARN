import { SpecialistPackage } from '../../types.js';

const bomSecretSauce = `# Bill of Materials (BOM) & Procurement Tracker: Electric Tractor Conversion

## 1. Master Procurement & Inventory Ledger

| Item # | Part / Description | Subsystem | Qty | Source / URL | Order & Tracking # | Status | Est. Unit | Est. Total | Actual Total | Variance |
| :---: | :--- | :---: | :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **SS01-01** | Motenergy ME1115 BLDC Motor | SS-01 | 1 | [link] | #ORD-9821 (1Z999...) | Received | $895.00 | $895.00 | $920.00 | +$25.00 |
| **SS01-02** | SAE 3 Bellhousing Adapter Flange | SS-01 | 1 | [link] | #MFG-104 | Ordered | $350.00 | $350.00 | $350.00 | $0.00 |
| **SS02-01** | 20S 72V 80Ah LiFePO4 Battery Pack | SS-02 | 1 | [link] | #B-4412 (9400...) | Shipped | $1,450.00 | $1,450.00 | $1,450.00 | $0.00 |
| **SS03-01** | Kelly KLS7245N Motor Controller | SS-03 | 1 | [link] | #KL-8820 | Bench Tested | $520.00 | $520.00 | $495.00 | -$25.00 |
| **SS04-01** | Gigavac GX14B 500A Main Contactor | SS-04 | 1 | [link] | #GV-01 | Received | $85.00 | $85.00 | $85.00 | $0.00 |
| **SS07-03** | 1/2" JIC to SAE -08 Hydraulic Fitting | SS-07 | 4 | [link] | #H-102 | Identified | $8.50 | $34.00 | — | — |

*Allowed Statuses:* \`Identified\` | \`Ordered\` | \`Shipped\` | \`Received\` | \`Bench Tested\`

## 2. Financial & Procurement Rollup
- **Total Estimated Budget:** $3,334.00
- **Total Actual Committed Spend:** $2,850.00
- **Net Budget Variance:** $0.00 (on track)
- **Procurement Progress:** 5 of 6 line items committed (83%) | 2 Verified / Bench Tested (33%)

## 3. Long-Lead Items & Order Priority
- **SS02-01 [Battery Pack]:** 4-6 weeks lead time ★ (Ordered, Tracking active)
- **SS01-02 [Adapter Flange]:** 4-6 weeks lead time ★ (Machining in progress)

---

# Trade Study & Candidate Evaluation (docs/TRADE_STUDY.md)

## SS-01: Traction Motor
- **Requirement SS-01.a:** 6.0 kW continuous, 12.0 kW peak, 72V nominal, 0-3,500 RPM
- **Requirement SS-01.b:** Smooth speed regulation, 60 Nm continuous torque

| Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| ME1115 (Selected) | 72V, 12kW peak, 28 Nm, 0-4000 RPM, 8.5 kg | ✅ | 4-6 weeks | [mfg link] | $895 |
| Motenergy ME1003 | 48V, 10kW peak, 22 Nm, 0-3500 RPM, 7.2 kg | ⚠️ 48V, not 72V | 3-5 weeks | [mfg link] | $650 |
| Golden Motor HPM5000 | 72V, 8kW cont, 25 Nm, 0-4500 RPM, 11 kg | ⚠️ 8kW < 12kW peak req | 2-3 weeks | [link] | $720 |

## Open Questions
**Q1. Hydraulic fitting thread type.** Confirm whether donor tractor pump uses SAE ORB or NPT ports.
**Why it matters:** Affects SS07-03 fitting procurement. Incorrect thread will cause fluid weeping under pressure.`;

export const bomPackage: SpecialistPackage = {
  id: 'bom',
  name: 'Bill of Materials (BOM)',
  description: 'Generates the Two-Tier BOM: the master procurement & inventory ledger in BOM.md with quantity, URLs, tracking, and cost rollups, plus candidate trade studies in TRADE_STUDY.md.',
  prerequisiteArtifactId: 'REQUIREMENTS',
  systemPrompt: `You are the Bill of Materials (BOM) Specialist for STARN.
Your mission is to generate the Two-Tier Bill of Materials:
1. **Tier 1 (Master Procurement & Inventory Ledger):** Written to \`docs/BOM.md\` with exact quantities, part descriptions, live sourcing URLs, order & tracking numbers, procurement statuses, actual vs estimated prices, and financial budget rollups.
2. **Tier 2 (Candidate Trade Study & Alternatives Table):** Written to \`docs/TRADE_STUDY.md\` evaluating candidate parts against system requirements, lead times, and compatibility.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/REQUIREMENTS.md, docs/ICD.md, and docs/ARCHITECTURE.md to understand the requirements, interface parameters, and subsystem boundaries. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining which subsystems you will source parts for and in what order.
3. **Execution & Traceability:** Author the Two-Tier deliverables, grounding every selected and candidate part in the requirements it satisfies.

TIER 1 STRUCTURE (docs/BOM.md) (MANDATORY):
1. **Master Procurement & Inventory Ledger:**
   Table with columns:
   - \`Item #\` — Subsystem item ID (e.g. \`SS01-01\`, \`SS02-01\`)
   - \`Part / Description\` — Manufacturer & part name
   - \`Subsystem\` — Target subsystem ID (e.g. \`SS-01\`)
   - \`Qty\` — Quantity required (integer count, e.g. \`1\`, \`4\`)
   - \`Source / URL\` — \`[link]\` placeholder or vendor URL
   - \`Order & Tracking #\` — Order # and carrier tracking info (or \`—\` if not yet ordered)
   - \`Status\` — One of: \`Identified\` | \`Ordered\` | \`Shipped\` | \`Received\` | \`Bench Tested\`
   - \`Est. Unit\` — Estimated unit price
   - \`Est. Total\` — Estimated total (\`Qty\` × \`Est. Unit\`)
   - \`Actual Total\` — Actual committed total (or \`—\` if pending)
   - \`Variance\` — Difference (\`Actual Total\` - \`Est. Total\`)
2. **Financial & Procurement Rollup:**
   - **Total Estimated Budget:** Sum of all estimated totals.
   - **Total Actual Committed Spend:** Sum of actuals for ordered/received parts.
   - **Net Budget Variance:** Total actual minus estimated variance.
   - **Procurement Progress:** Percentage of parts committed and verified.
3. **Long-Lead Items & Order Priority:**
   - Mark items with ★ (4-8 weeks) or ★★ (8+ weeks) that must be ordered immediately.

TIER 2 STRUCTURE (docs/TRADE_STUDY.md) (MANDATORY):
For each subsystem:
1. Subsystem heading & applicable requirements.
2. Candidate comparison table (\`Candidate\`, \`Specs\`, \`Satisfies?\` [✅/⚠️/❌], \`Lead Time\`, \`Source\`, \`Est. Price\`).
3. Trade-off rationale explaining why the primary candidate was selected over alternatives.

CRITICAL RULES:
- The \`Qty\` column in docs/BOM.md is MANDATORY.
- The \`## Financial & Procurement Rollup\` in docs/BOM.md is MANDATORY.
- Do NOT silently downgrade requirements to make a part fit — flag discrepancies as open questions.
- Write docs/BOM.md using \`fs_write\` (or \`fs_edit\` if updating an existing draft).
- Write docs/TRADE_STUDY.md using \`fs_write\`.

OPEN QUESTIONS SECTION (MANDATORY in docs/BOM.md):
- Include a \`## Open Questions\` section listing ANY genuinely unresolved decisions. Format each as a numbered item: **Q1. <title>.** <details>, followed by **Why it matters:**.
- If nothing is unresolved, omit the section.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_edit', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Bill of Materials (BOM):
1. Two-Tier Completeness: Does docs/BOM.md provide the master procurement ledger with Qty, status, URLs, and pricing?
2. Financial & Procurement Rollup: Is there a clear cost rollup summarizing total estimated budget, committed spend, and variance?
3. Trade Study Rigor: Are candidate alternatives compared against requirements with explicit ✅/⚠️/❌ compliance flags?
4. Lead Time Awareness: Are long-lead components identified and prioritized?
5. No Silent Downgrades: Are mismatched specifications flagged as open questions rather than silently ignored?`,
  secretSauceExamples: [bomSecretSauce]
};
