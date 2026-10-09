import { describe, it, expect } from 'vitest';
import { parseTradeStudyDocument } from '../src/server/parsers/trade-study-parser.js';

const SAMPLE_TRADE_STUDY = `# Trade Study & Candidate Evaluation (docs/TRADE_STUDY.md)

## SS-01: Traction Motor
- **Requirement SS-01.a:** 6.0 kW continuous, 12.0 kW peak, 72V nominal, 0-3,500 RPM
- **Requirement SS-01.b:** Smooth speed regulation, 60 Nm continuous torque

| Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| ME1115 (Selected) | 72V, 12kW peak, 28 Nm, 0-4000 RPM, 8.5 kg | ✅ | 4-6 weeks | [mfg link](https://x.com) | $895 |
| Motenergy ME1003 | 48V, 10kW peak, 22 Nm, 0-3500 RPM, 7.2 kg | ⚠️ 48V, not 72V | 3-5 weeks | [mfg link](https://y.com) | $650 |
| Golden Motor HPM5000 | 72V, 8kW cont, 25 Nm, 0-4500 RPM, 11 kg | ❌ 8kW < 12kW peak req | 2-3 weeks | [link](https://z.com) | $720 |

### Selection Rationale
ME1115 satisfies all peak voltage and thermal constraints.

## SS-02: Battery Pack
- **Requirement SS-02.a:** 72V nominal, 15 kWh capacity

| Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price |
|---|---|---|---|---|---|
| CALB 100Ah LiFePO4 | 24S 76.8V, 100Ah, 7.68 kWh x 2 | ✅ | 2-3 weeks | [store](https://b.com) | $3,200 |

### Selection Rationale
Safe chemistry with modular sizing.
`;

describe('Trade Study Parser', () => {
  it('parses subsystems, requirements, candidates, and rationales', () => {
    const studies = parseTradeStudyDocument(SAMPLE_TRADE_STUDY);
    expect(studies).toHaveLength(2);

    expect(studies[0].subsystemId).toBe('SS-01');
    expect(studies[0].subsystemName).toBe('Traction Motor');
    expect(studies[0].requirements).toHaveLength(2);
    expect(studies[0].candidates).toHaveLength(3);
    expect(studies[0].candidates[0].candidate).toBe('ME1115 (Selected)');
    expect(studies[0].candidates[0].satisfies).toBe('compliant');
    expect(studies[0].candidates[1].satisfies).toBe('warning');
    expect(studies[0].candidates[2].satisfies).toBe('non_compliant');
    expect(studies[0].candidates[0].estPrice).toBe(895);
    expect(studies[0].rationale).toContain('ME1115 satisfies');

    expect(studies[1].subsystemId).toBe('SS-02');
    expect(studies[1].subsystemName).toBe('Battery Pack');
    expect(studies[1].candidates[0].estPrice).toBe(3200);
  });

  it('handles empty or table-less documents gracefully', () => {
    const studies = parseTradeStudyDocument('# Trade Study\n\nNo tables yet.');
    expect(studies).toEqual([]);
  });
});
