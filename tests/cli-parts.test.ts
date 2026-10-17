import { describe, it, expect } from 'vitest';
import {
  formatPartsTable,
  parsePartsUpdateArgs,
  formatTradeStudySummary,
  BomData
} from '../src/cli/parts-commands.js';
import { SubsystemTradeStudy } from '../src/server/parsers/trade-study-parser.js';

describe('CLI Parts & Sourcing Commands', () => {
  const sampleBomData: BomData = {
    items: [
      {
        id: 'SS01-01',
        description: 'Motenergy ME1115 BLDC Motor',
        subsystem: 'SS-01',
        qty: 1,
        source: 'https://example.com/me1115',
        tracking: '1Z9999999999999999',
        status: 'Shipped',
        estUnit: 895,
        estTotal: 895,
        actualTotal: 920,
        variance: 25
      },
      {
        id: 'SS01-02',
        description: 'Adapter Flange',
        subsystem: 'SS-01',
        qty: 1,
        source: 'https://example.com/flange',
        tracking: '—',
        status: 'Identified',
        estUnit: 350,
        estTotal: 350,
        actualTotal: null,
        variance: null
      }
    ],
    financials: {
      totalEstimated: 1245,
      totalActual: 920,
      netVariance: 25,
      procurementProgressPercent: 50
    },
    tradeStudy: null
  };

  it('formatPartsTable renders table with items and financial rollup', () => {
    const table = formatPartsTable(sampleBomData);
    expect(table).toContain('SS01-01');
    expect(table).toContain('Motenergy ME1115');
    expect(table).toContain('Shipped');
    expect(table).toContain('1Z9999999999999999');
    expect(table).toContain('Total Estimated Budget: $1,245.00');
    expect(table).toContain('Total Actual Committed: $920.00');
  });

  it('parsePartsUpdateArgs parses itemId, status, actual, and tracking', () => {
    const parsed1 = parsePartsUpdateArgs('SS01-01 Ordered 895.00 #ORD-123');
    expect(parsed1.itemId).toBe('SS01-01');
    expect(parsed1.status).toBe('Ordered');
    expect(parsed1.actualTotal).toBe(895);
    expect(parsed1.tracking).toBe('#ORD-123');

    const parsed2 = parsePartsUpdateArgs('SS01-02 Shipped "1Z 999 000"');
    expect(parsed2.itemId).toBe('SS01-02');
    expect(parsed2.status).toBe('Shipped');
    expect(parsed2.tracking).toBe('1Z 999 000');

    const parsed3 = parsePartsUpdateArgs('SS01-01 Consumed');
    expect(parsed3.itemId).toBe('SS01-01');
    expect(parsed3.status).toBe('Consumed');
  });

  it('formatTradeStudySummary formats candidates with compliance markers', () => {
    const studies: SubsystemTradeStudy[] = [
      {
        subsystemId: 'SS-01',
        subsystemName: 'Traction Motor',
        requirements: ['72V nominal', '12kW peak'],
        candidates: [
          {
            candidate: 'ME1115 (Selected)',
            specs: '72V, 12kW, 28 Nm',
            satisfies: 'compliant',
            leadTime: '4-6 weeks',
            source: 'https://example.com/me1115',
            estPrice: 895
          }
        ],
        rationale: 'Best fit for 72V architecture.'
      }
    ];

    const out = formatTradeStudySummary(studies);
    expect(out).toContain('SS-01: Traction Motor');
    expect(out).toContain('ME1115 (Selected)');
    expect(out).toContain('4-6 weeks');
    expect(out).toContain('$895.00');
  });
});
