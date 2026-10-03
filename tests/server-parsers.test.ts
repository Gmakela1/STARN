import { describe, it, expect } from 'vitest';
import { parseBomDocument, updateBomRow } from '../src/server/parsers/bom-parser.js';
import { parseWorkInstruction, toggleWorkInstructionStep } from '../src/server/parsers/actions-parser.js';
import { aggregateProjectIssues } from '../src/server/parsers/issues-parser.js';

const BOM_MD = `# Bill of Materials

## 1. Master Procurement Ledger

| Item # | Part / Description | Subsystem | Qty | Source / URL | Order & Tracking # | Status | Est. Unit | Est. Total | Actual Total | Variance |
| :---: | :--- | :---: | :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **SS01-01** | Motenergy ME1115 BLDC Motor | SS-01 | 1 | [link](https://example.com/me1115) | #ORD-9821 (1Z999...) | Received | $895.00 | $895.00 | $920.00 | +$25.00 |
| **SS01-02** | SAE 3 Bellhousing Adapter Flange | SS-01 | 1 | [link](https://example.com/sae3) | #MFG-104 | Ordered | $350.00 | $350.00 | $350.00 | $0.00 |
| **SS07-03** | 1/2" JIC to SAE -08 Hydraulic Fitting | SS-07 | 4 | [link](https://example.com/jic) | — | Identified | $8.50 | $34.00 | — | — |

## 2. Financial Rollup

- **Total Estimated Budget:** $1,279.00
- **Total Actual Committed Spend:** $1,270.00
- **Net Budget Variance:** +$25.00

## 3. Notes

Keep long-lead items prioritized.
`;

const WI_MD = `# Work Instruction: ACTION-03 — Mount Electric Motor & Bellhousing Adapter
**Milestone Gate:** MVC / Powertrain Integration  
**Target Subsystem:** SS-01 (Traction Motor) | **Interface:** ICD-M-01  
**Status:** IN-PROGRESS

## 1. Prerequisites & Required Resources

### Prerequisite Actions
- [x] **ACTION-01:** Remove Diesel Engine — \`COMPLETED\`

## 2. Step-by-Step Action Checklist

- [x] **Step 1:** Clean bellhousing mating face with brake cleaner.
- [ ] **Step 2:** Torque 4x M10 bolts in star pattern to 45 ft-lbs (61 Nm).
- [ ] **Step 3: [GATED TEST PLAN EXECUTION: TP-MECH-01 — Driveline Concentricity]**
  - Verify runout <= 0.05 mm.

## 3. Verification & Evidence Artifacts

- **Torque Media:** \`artifacts/ACTION-03-MOUNT-MOTOR-WI-1-TORQUE-STRIPE.jpg\`

## 4. Hardware Non-Conformance / Bug Log

- **Flag Status:** OPEN_NON_CONFORMANCE
- **Defect Description:** Top two M12 bolt holes offset by 3.5mm from adapter plate rim.
- **Defect Evidence / Media:** artifacts/ACTION-03-MOUNT-MOTOR-WI-1-DEFECT-BOLT.jpg
- **AI Recommendation / Resolution:** None
`;

describe('bom-parser', () => {
  it('parses BOM items with quantities, status, and prices', () => {
    const { items } = parseBomDocument(BOM_MD);
    expect(items).toHaveLength(3);

    const motor = items[0];
    expect(motor.id).toBe('SS01-01');
    expect(motor.description).toBe('Motenergy ME1115 BLDC Motor');
    expect(motor.subsystem).toBe('SS-01');
    expect(motor.qty).toBe(1);
    expect(motor.status).toBe('Received');
    expect(motor.estTotal).toBe(895);
    expect(motor.actualTotal).toBe(920);

    const fitting = items[2];
    expect(fitting.qty).toBe(4);
    expect(fitting.status).toBe('Identified');
    expect(fitting.actualTotal).toBeNull();
  });

  it('computes financial rollups from line items', () => {
    const { financials } = parseBomDocument(BOM_MD);
    expect(financials.totalEstimated).toBe(1279);
    expect(financials.totalActual).toBe(1270);
    expect(financials.netVariance).toBe(25);
    // 2 of 3 items are committed (not "Identified")
    expect(financials.procurementProgressPercent).toBe(67);
  });

  it('updates a BOM row surgically without touching other content', () => {
    const updated = updateBomRow(BOM_MD, 'SS07-03', {
      status: 'Ordered',
      tracking: '#H-9000',
      actualTotal: 36
    });

    const { items } = parseBomDocument(updated);
    expect(items[2].status).toBe('Ordered');
    expect(items[2].tracking).toBe('#H-9000');
    expect(items[2].actualTotal).toBe(36);
    // Other rows and sections untouched
    expect(updated).toContain('Motenergy ME1115 BLDC Motor');
    expect(updated).toContain('Keep long-lead items prioritized.');
    expect(updated).toContain('## 2. Financial Rollup');
  });

  it('throws when updating a nonexistent item', () => {
    expect(() => updateBomRow(BOM_MD, 'XX-99', { status: 'Ordered' })).toThrow(/not found/i);
  });
});

describe('actions-parser', () => {
  it('parses work instruction header, steps, and non-conformance log', () => {
    const wi = parseWorkInstruction(WI_MD, 'ACTION-03-MOUNT-MOTOR-WORK-INSTRUCTION.md');
    expect(wi.actionId).toBe('ACTION-03');
    expect(wi.title).toContain('Mount Electric Motor');
    expect(wi.status).toBe('IN-PROGRESS');

    expect(wi.steps).toHaveLength(3);
    expect(wi.steps[0].checked).toBe(true);
    expect(wi.steps[1].checked).toBe(false);
    expect(wi.steps[1].text).toContain('45 ft-lbs');
    expect(wi.steps[2].gated).toBe(true);

    expect(wi.artifacts).toContain('artifacts/ACTION-03-MOUNT-MOTOR-WI-1-TORQUE-STRIPE.jpg');
    expect(wi.nonConformance.flagStatus).toBe('OPEN_NON_CONFORMANCE');
    expect(wi.nonConformance.defectDescription).toContain('3.5mm');
    expect(wi.nonConformance.defectEvidence).toContain('DEFECT-BOLT.jpg');
  });

  it('toggles a checklist step on disk content without altering other steps', () => {
    const updated = toggleWorkInstructionStep(WI_MD, 1, true);
    const wi = parseWorkInstruction(updated);
    expect(wi.steps[1].checked).toBe(true);
    expect(wi.steps[0].checked).toBe(true);
    expect(wi.steps[2].checked).toBe(false);
    // Prerequisite action checkbox untouched (not a checklist step)
    expect(updated).toContain('- [x] **ACTION-01:**');

    const reverted = toggleWorkInstructionStep(updated, 0, false);
    expect(parseWorkInstruction(reverted).steps[0].checked).toBe(false);
  });

  it('throws on out-of-range step index', () => {
    expect(() => toggleWorkInstructionStep(WI_MD, 9, true)).toThrow(/out of range/i);
  });
});

describe('issues-parser', () => {
  it('aggregates non-conformances and open questions into a unified issue list', () => {
    const wi = parseWorkInstruction(WI_MD, 'ACTION-03-MOUNT-MOTOR-WORK-INSTRUCTION.md');
    const summary = aggregateProjectIssues(
      [wi],
      [{ phase: 'CONOPS', file: 'docs/CONOPS.md', questions: ['Preferred cooling loop: liquid or air?'] }]
    );

    expect(summary.nonConformanceCount).toBe(1);
    expect(summary.openQuestionCount).toBe(1);
    expect(summary.issues).toHaveLength(2);

    const defect = summary.issues.find(i => i.type === 'non_conformance')!;
    expect(defect.title).toContain('ACTION-03');
    expect(defect.description).toContain('3.5mm');
    expect(defect.evidence).toContain('DEFECT-BOLT.jpg');

    const question = summary.issues.find(i => i.type === 'open_question')!;
    expect(question.description).toContain('cooling loop');
    expect(question.source).toBe('docs/CONOPS.md');
  });

  it('skips resolved non-conformances', () => {
    const resolved = WI_MD.replace('OPEN_NON_CONFORMANCE', 'RESOLVED');
    const wi = parseWorkInstruction(resolved);
    const summary = aggregateProjectIssues([wi], []);
    expect(summary.nonConformanceCount).toBe(0);
    expect(summary.issues).toHaveLength(0);
  });
});
