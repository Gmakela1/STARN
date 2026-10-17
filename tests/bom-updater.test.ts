import { describe, it, expect } from 'vitest';
import { updateBomItemInMarkdown, parseBomDocument, BOM_STATUSES } from '../src/server/parsers/bom-updater.js';

describe('BOM Atomic Updater & Financial Recalculator', () => {
  const sampleBom = `# Bill of Materials (BOM) & Procurement Tracker

## 1. Master Procurement & Inventory Ledger

| Item # | Part / Description | Subsystem | Qty | Source / URL | Order & Tracking # | Status | Est. Unit | Est. Total | Actual Total | Variance |
| :---: | :--- | :---: | :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **SS01-01** | Motenergy ME1115 BLDC Motor | SS-01 | 1 | [link](https://example.com/me1115) | — | Identified | $895.00 | $895.00 | — | — |
| **SS01-02** | Adapter Flange | SS-01 | 1 | [link](https://example.com/flange) | — | Identified | $350.00 | $350.00 | — | — |
| **SS02-01** | 72V 80Ah Battery Pack | SS-02 | 1 | [link](https://example.com/pack) | — | Identified | $1,500.00 | $1,500.00 | — | — |

## 2. Financial & Procurement Rollup
- **Total Estimated Budget:** $2,745.00
- **Total Actual Committed Spend:** $0.00
- **Net Budget Variance:** $0.00
- **Procurement Progress:** 0 of 3 line items committed (0%) | 0 Verified (0%)

## 3. Long-Lead Items & Order Priority
- **SS02-01 [Battery Pack]:** 4-6 weeks lead time ★
`;

  it('includes Consumed in BOM_STATUSES', () => {
    expect(BOM_STATUSES).toContain('Consumed');
  });

  it('updates an item status, tracking number, and actual cost', () => {
    const updated = updateBomItemInMarkdown(sampleBom, 'SS01-01', {
      status: 'Shipped',
      tracking: '1Z9999999999999999 (UPS)',
      actualTotal: 920.00
    });

    const parsed = parseBomDocument(updated);
    const item = parsed.items.find(i => i.id === 'SS01-01')!;
    expect(item.status).toBe('Shipped');
    expect(item.tracking).toBe('1Z9999999999999999 (UPS)');
    expect(item.actualTotal).toBe(920.00);
    expect(item.variance).toBe(25.00); // 920 - 895
  });

  it('automatically recalculates the Financial & Procurement Rollup section in markdown', () => {
    const updated = updateBomItemInMarkdown(sampleBom, 'SS01-01', {
      status: 'Ordered',
      actualTotal: 920.00
    });

    expect(updated).toContain('Total Actual Committed Spend:** $920.00');
    expect(updated).toContain('Procurement Progress:** 1 of 3 line items committed (33%)');

    const parsed = parseBomDocument(updated);
    expect(parsed.financials.totalActual).toBe(920.00);
    expect(parsed.financials.procurementProgressPercent).toBe(33);
  });

  it('escapes pipe characters in text inputs to protect table formatting', () => {
    const updated = updateBomItemInMarkdown(sampleBom, 'SS01-02', {
      tracking: 'Order #123 | Tracking #XYZ'
    });

    const parsed = parseBomDocument(updated);
    const item = parsed.items.find(i => i.id === 'SS01-02')!;
    expect(item.tracking).toBe('Order #123 \\| Tracking #XYZ');
    // Ensure table rows count didn't change
    expect(parsed.items).toHaveLength(3);
  });

  it('supports transitioning to Consumed status', () => {
    const updated = updateBomItemInMarkdown(sampleBom, 'SS01-01', {
      status: 'Consumed'
    });

    const parsed = parseBomDocument(updated);
    const item = parsed.items.find(i => i.id === 'SS01-01')!;
    expect(item.status).toBe('Consumed');
  });
});
