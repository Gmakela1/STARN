import { SpecialistPackage } from '../../types.js';

const bomSecretSauce = `# Bill of Materials (BOM) & Procurement Tracker: Electric Tractor Conversion

Stage: 1 — Pre-Sourcing (Grocery List)

## 1. Master Procurement & Inventory Ledger

| Item # | Part / Description | Subsystem | Qty | Source / URL | Order & Tracking # | Status | Est. Unit | Est. Total | Actual Total | Variance |
| :---: | :--- | :---: | :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **SS01-01** | Traction motor — fixed by user decision (user-supplied PN: ME1115) | SS-01 | 1 | user-supplied datasheet | — | Identified | non-procurement estimate | — | — | Not established — no approved budget target |
| **SS01-02** | SAE 3 bellhousing adapter flange — class: machined adapter plate | SS-01 | 1 | class-level sourcing; vendor TBD | — | Candidate — unverified | non-procurement estimate | — | — | Not established — no approved budget target |
| **SS02-01** | Battery pack — 72V nominal, capacity per baseline spec; class: LiFePO4 pack | SS-02 | 1 | class-level sourcing; vendor TBD | — | Candidate — unverified | non-procurement estimate | — | — | Not established — no approved budget target |
| **SS03-01** | Motor controller — provisional candidate per DD-R13 (Kelly KLS-class, user-supplied PN) | SS-03 | 1 | user-supplied manual | — | Provisional candidate | non-procurement estimate | — | — | Not established — no approved budget target |
| **SS04-01** | Main contactor — class: DC contactor rated ≥ approved bus current | SS-04 | 1 | class-level sourcing; vendor TBD | — | Blocked — pending reconciliation (Q1) | non-procurement estimate | — | — | Not established — no approved budget target |
| **SS07-03** | Hydraulic fitting — class: 1/2" JIC to SAE -08 | SS-07 | 4 | class-level sourcing; vendor TBD | — | Blocked — pending reconciliation (Q2) | non-procurement estimate | — | — | Not established — no approved budget target |

*Allowed Statuses:* \`Candidate — unverified\` | \`Provisional candidate\` | \`Identified\` | \`Blocked\` | \`Ordered\` | \`Shipped\` | \`Received\` | \`Bench Tested\` | \`Consumed\`
*Every non-final row carries a verification action — the concrete next step that retires its Candidate/Blocked status. No row may show Ordered, Shipped, Received, or Bench Tested before a real purchase; no fabricated order numbers, tracking numbers, or received dates.*

## 2. Financial & Procurement Rollup
- **Total Estimated Budget:** Not established — no approved budget target (0% procurement).
- **Total Actual Committed Spend:** $0.00 — nothing ordered yet.
- **Net Budget Variance:** Not computable — no committed spend and no approved budget to compare against.
- **Procurement Progress:** 0 line items committed (0%).

## 3. Sourcing Note
Live web-search verification was unavailable during this run. All rows remain Candidate — unverified with class-level sourcing; every price above is a non-procurement estimate. Stage-2 promotion (verified URLs, part numbers, market prices) is deferred until sourcing is available.

## 4. Long-Lead Items & Order Priority (preliminary)
- **SS02-01 [Battery Pack]:** expected 4-6 week class lead — confirm at Stage-2 sourcing.

---

# Trade Study & Candidate Evaluation (docs/TRADE_STUDY.md)

## SS-01: Traction Motor
- **Requirement SS-01.a:** 6.0 kW continuous, 12.0 kW peak, 72V nominal, 0-3,500 RPM
- **Requirement SS-01.b:** Smooth speed regulation, 60 Nm continuous torque

| Candidate (generic class) | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| 72V BLDC motor, ≥12kW peak, ≥60 Nm cont (user-supplied PN ME1115) | 72V, 12kW peak per user datasheet | ✅ | TBD — verify at sourcing | user-supplied datasheet | non-procurement estimate |
| 48V-class BLDC motor, ~10kW peak | 48V, 10kW peak | ⚠️ 48V, not 72V | TBD | class-level | non-procurement estimate |
| 72V PM motor, ~8kW continuous | 72V, 8kW cont | ⚠️ 8kW < 12kW peak req | TBD | class-level | non-procurement estimate |

## Open Questions
**Q1. Bus-current reconciliation.** A user answer conflicts with the approved upstream current limit. The approved figure REMAINS THE APPROVED BASIS PENDING FORMAL REVISION — it must not be declared unapproved, and no replacement bound may be invented. Dependent rows are Blocked — pending reconciliation (Q1).
**Why it matters:** Wire gauge, contactor, and fuse ratings all depend on this figure; nothing current-dependent can be promoted until it is reconciled.`;

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
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/REQUIREMENTS.md, docs/ICD.md, and docs/ARCHITECTURE.md to understand the system requirements, electrical interfaces, and subsystem boundaries. Do not guess what was written.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining which subsystems you will source parts for and in what order.

DISCIPLINE: GROCERY LIST FIRST, SOURCING SECOND (MANDATORY):
Follow this two-stage discipline strictly so all engineering requirements are covered before shopping:

- **Stage 1: Generate the Detailed Grocery List in docs/BOM.md (MANDATORY):**
  1. Complete Framework Ledger: Before performing web searches, compile the exhaustive master grocery list into \`docs/BOM.md\` covering all subsystems.
  2. Every required component (motors, controllers, battery pack, contactors, precharge, wiring, fittings, brackets, fasteners, gauges) must have an \`Item #\`, required technical specifications, exact required integer \`Qty\`, an estimated baseline unit cost, and a truthful pre-sourcing status from the Allowed Statuses (see Tier 1 structure).
  3. Do NOT mark a component \`Identified\` merely because it is required: \`Identified\` is reserved for parts FIXED by an explicit user decision or the approved baseline specification. Gated or provisional parts (e.g. a controller whose selection is gated by a design decision such as DD-R13) are \`Provisional candidate\`. Everything still awaiting sourcing is \`Candidate — unverified\` with class-level sourcing.
  4. Every non-final row carries a verification action — the concrete next step that will retire its Candidate/Blocked status.
  5. Start the document with a \`Stage: 1 — Pre-Sourcing (Grocery List)\` marker line directly under the main heading so downstream review knows this is a pre-sourcing draft.

- **Stage 2: Web Sourcing & Trade Study in docs/TRADE_STUDY.md (MANDATORY):**
  1. Systematic Sourcing: For each subsystem and critical item on the grocery list, use the \`web_search\` and \`web_fetch\` tools to find real, currently manufactured parts that meet the required specifications.
  2. Trade Study Comparison: In \`docs/TRADE_STUDY.md\`, compare candidate components against the requirements with explicit compliance marks (\`✅\`/\`⚠️\`/\`❌\`), lead times, pricing, and live vendor/datasheet links.
  3. Promote Winning Selections: Update \`docs/BOM.md\` with the selected manufacturer, exact part number, live sourcing URL, verified market price, and long-lead order flags (★ or ★★). Recalibrate the \`## Financial & Procurement Rollup\`. Only promote when sourcing actually succeeded — see SOURCING-FAILURE FALLBACK. Update the stage marker to \`Stage: 2 — Sourced (Procurement Ledger)\`.

BASELINE-CONFLICT PROTOCOL (MANDATORY):
If a user answer conflicts with a limit that is already approved upstream (a DD or ICD figure in the approved baseline):
1. Restate the approved figure as STILL BINDING in the deliverable — e.g. "120 A / 8.6 kW remains the approved basis pending formal revision". NEVER assert that an approved baseline figure is unapproved, superseded, or "not approved for procurement".
2. NEVER invent a replacement bound on the user's behalf — a user request to reconsider is not an approved revision.
3. Mark every row that depends on the contested figure \`Blocked — pending reconciliation (Q#)\`, referencing the Open Question that tracks the conflict.
4. Record the conflict itself as an Open Question, stating both the approved figure and the requested change without resolving it yourself.

SOURCING-FAILURE FALLBACK (MANDATORY):
If \`web_search\` is unavailable or fails, do NOT fake verification and do NOT block the whole deliverable:
1. Skip Stage-2 promotion entirely; leave every affected row as \`Candidate — unverified\` with class-level sourcing (describe the generic part class instead of a vendor part number).
2. Label all prices \`non-procurement estimate\`; never present them as verified market prices.
3. Add a sourcing note that discloses the outage (e.g. "Live web-search verification was unavailable during this run").
4. IMAGE-ONLY REFERENCE PDFS: if a reference/ PDF yields zero extractable text via \`fs_read\`, it is image-only. Before declaring any spec from it unknown, read it with \`doc_transcribe\` (vision OCR) and use the transcribed figures as the sourcing basis.

TIER 1 STRUCTURE (docs/BOM.md) (MANDATORY):
1. **Master Procurement & Inventory Ledger:**
   Table with columns:
   - \`Item #\` — Subsystem item ID (e.g. \`SS01-01\`, \`SS02-01\`)
   - \`Part / Description\` — Manufacturer & part name
   - \`Subsystem\` — Target subsystem ID (e.g. \`SS-01\`)
   - \`Qty\` — Quantity required (integer count, e.g. \`1\`, \`4\`)
   - \`Source / URL\` — \`[link]\` placeholder or vendor URL
   - \`Order & Tracking #\` — Order # and carrier tracking info (or \`—\` if not yet ordered)
   - \`Status\` — One of: \`Candidate — unverified\` | \`Provisional candidate\` | \`Identified\` | \`Blocked\` | \`Ordered\` | \`Shipped\` | \`Received\` | \`Bench Tested\` | \`Consumed\`. \`Identified\` only for parts fixed by user decision or baseline spec; gated/provisional parts are \`Provisional candidate\`; every non-final row carries a verification action.
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
- Use \`web_search\` and \`web_fetch\` to find genuine components, realistic prices, and verified lead times.
- Do NOT silently downgrade requirements to make a part fit — flag discrepancies as open questions.
- NEVER fabricate order numbers, tracking numbers, prices, or Received/Shipped statuses — every status must reflect reality.
- Write docs/BOM.md using \`fs_write\` (or \`fs_edit\` if updating an existing draft).
- Write docs/TRADE_STUDY.md using \`fs_write\`.

OPEN QUESTIONS SECTION (MANDATORY in docs/BOM.md):
- Include a \`## Open Questions\` section listing ANY genuinely unresolved decisions. Format each as a numbered item: **Q1. <title>.** <details>, followed by **Why it matters:**.
- If nothing is unresolved, omit the section.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_edit', 'fs_list', 'state_read', 'state_update', 'example_reader', 'web_search', 'web_fetch', 'doc_transcribe'],
  requiresCritic: true,
  criticRubric: `Evaluate the Bill of Materials (BOM):
1. Two-Tier Completeness: Does docs/BOM.md provide the master procurement ledger with Qty, truthful statuses (Candidate — unverified / Provisional candidate / Identified / Blocked pre-sourcing; Ordered/Shipped/Received only when actually purchased), and a verification action on every non-final row?
2. Financial & Procurement Rollup: Is there a clear cost rollup summarizing total estimated budget, committed spend, and variance — OR, at 0% procurement, an explicit statement of why variance is not yet computable (no approved budget target / nothing ordered)?
3. Trade Study Rigor: Are candidate alternatives generic part classes (unless user-sourced or baseline-established — named third-party brands without that grounding fail) compared against requirements with explicit ✅/⚠️/❌ compliance flags for every alternative?
4. Lead Time Awareness: Are long-lead components identified and prioritized (class-level lead estimates are acceptable pre-sourcing)?
5. No Silent Downgrades: Are mismatched specifications flagged as open questions rather than silently ignored, and does the artifact keep approved baseline figures binding (baseline-conflict protocol) instead of declaring them unapproved?`,
  secretSauceExamples: [bomSecretSauce]
};
