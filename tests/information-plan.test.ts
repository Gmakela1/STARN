/**
 * information-plan.test.ts — parser for the specialist's INFORMATION PLAN
 * block (src/core/information-plan.ts). Covers the canonical shape, separator
 * variants, multiple UNKNOWN lines, the no-plan case and markdown tolerance.
 */
import { describe, it, expect } from 'vitest';
import { parseInformationPlan } from '../src/core/information-plan.js';

const CANONICAL = `# Bill of Materials (BOM)

INFORMATION PLAN (MANDATORY, part of the running plan):
1. Title and scope
2. Motor selection
  - Motor continuous rating — KNOWN: docs/REQUIREMENTS.md §3
  - Motor enclosure ingress protection — UNKNOWN: what IP rating is required? → likely in reference/ME1115 Rev A.pdf

## 1. Master Ledger`;

describe('parseInformationPlan', () => {
  it('parses the canonical plan block (document order + claims)', () => {
    const plan = parseInformationPlan(CANONICAL);
    expect(plan).not.toBeNull();
    expect(plan!.order).toEqual(['Title and scope', 'Motor selection']);
    expect(plan!.claims).toHaveLength(2);
    expect(plan!.claims[0]).toEqual({
      claim: 'Motor continuous rating',
      status: 'known',
      source: 'docs/REQUIREMENTS.md §3'
    });
    expect(plan!.claims[1]).toEqual({
      claim: 'Motor enclosure ingress protection',
      status: 'unknown',
      question: 'what IP rating is required?',
      likelyAt: 'reference/ME1115 Rev A.pdf'
    });
  });

  it('tolerates em dash, en dash, hyphen and colon separators', () => {
    const text = `INFORMATION NEEDED (MANDATORY):
- Bus voltage — KNOWN: docs/REQUIREMENTS.md §2
- Battery chemistry – KNOWN: docs/CONOPS.md §4
- Charge port - KNOWN: vendor page
- Brake resistor: KNOWN: docs/BOM.md §6`;
    const plan = parseInformationPlan(text);
    expect(plan).not.toBeNull();
    expect(plan!.claims.map(c => c.claim)).toEqual([
      'Bus voltage',
      'Battery chemistry',
      'Charge port',
      'Brake resistor'
    ]);
    expect(plan!.claims.map(c => c.source)).toEqual([
      'docs/REQUIREMENTS.md §2',
      'docs/CONOPS.md §4',
      'vendor page',
      'docs/BOM.md §6'
    ]);
    expect(plan!.order).toEqual([]);
  });

  it('parses multiple UNKNOWN lines in written order, each with its likely source', () => {
    const text = `INFORMATION PLAN (MANDATORY, part of the running plan):
- Cable gland size — UNKNOWN: what gland size fits the 12 mm cable? → likely in vendor page for a cable gland
- Heat-sink clearance — UNKNOWN: minimum clearance to the enclosure wall? → likely in reference/thermal.pdf
- Contactor mounting — UNKNOWN: where does the main contactor mount? → likely in reference/ME1115 Rev A.pdf`;
    const plan = parseInformationPlan(text);
    expect(plan).not.toBeNull();
    expect(plan!.claims).toHaveLength(3);
    expect(plan!.claims.map(c => c.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(plan!.claims.map(c => c.question)).toEqual([
      'what gland size fits the 12 mm cable?',
      'minimum clearance to the enclosure wall?',
      'where does the main contactor mount?'
    ]);
    expect(plan!.claims.map(c => c.likelyAt)).toEqual([
      'vendor page for a cable gland',
      'reference/thermal.pdf',
      'reference/ME1115 Rev A.pdf'
    ]);
  });

  it('returns null when the reply carries no plan', () => {
    expect(parseInformationPlan('# Bill of Materials\n\n| Item | Part |\n| --- | --- |\n')).toBeNull();
    expect(parseInformationPlan('I drafted the BOM.')).toBeNull();
    expect(parseInformationPlan('')).toBeNull();
  });

  it('parses a plan with no KNOWN lines', () => {
    const text = `INFORMATION NEEDED (MANDATORY):
- Motor rating — UNKNOWN: continuous rating at 40 C ambient? → likely in reference/ME1115 Rev A.pdf`;
    const plan = parseInformationPlan(text);
    expect(plan).not.toBeNull();
    expect(plan!.claims).toHaveLength(1);
    expect(plan!.claims[0].status).toBe('unknown');
    expect(plan!.claims.find(c => c.status === 'known')).toBeUndefined();
  });

  it('extracts the text after "→ likely in" and drops it from the question', () => {
    const text = `INFORMATION PLAN (MANDATORY, part of the running plan):
- Ingress protection — UNKNOWN: what IP rating does the enclosure need? → likely in IEC 60529 standard`;
    const plan = parseInformationPlan(text);
    expect(plan!.claims[0].question).toBe('what IP rating does the enclosure need?');
    expect(plan!.claims[0].likelyAt).toBe('IEC 60529 standard');
  });

  it('tolerates markdown bold markers on the claim and the source', () => {
    const text = `INFORMATION PLAN (MANDATORY, part of the running plan):
- **Motor continuous rating** — KNOWN: **docs/REQUIREMENTS.md §3**`;
    const plan = parseInformationPlan(text);
    expect(plan).not.toBeNull();
    expect(plan!.claims[0]).toEqual({
      claim: 'Motor continuous rating',
      status: 'known',
      source: 'docs/REQUIREMENTS.md §3'
    });
  });
});