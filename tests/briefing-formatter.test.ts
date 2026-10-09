import { describe, it, expect } from 'vitest';
import { formatExecutiveBriefingPlain, formatExecutiveBriefingMarkdown } from '../src/core/briefing-formatter.js';

describe('Executive Briefing Formatter', () => {
  const data = {
    projectName: 'Solar Field Rig',
    activePhase: 'bom',
    conopsSummary: 'Off-grid deployable solar array.',
    financials: { totalEstimated: 12000, totalActual: 11500, netVariance: -500 },
    phases: [
      { id: 'conops', name: 'CONOPS', status: 'COMPLETED', criticScore: 9.0 },
      { id: 'bom', name: 'BOM', status: 'IN_PROGRESS' }
    ],
    openIssues: [{ title: 'Inverter bracket offset', type: 'non_conformance' }]
  };

  it('formats clean plain text for terminal output', () => {
    const text = formatExecutiveBriefingPlain(data);
    expect(text).toContain('EXECUTIVE BRIEFING');
    expect(text).toContain('Solar Field Rig');
    expect(text).toContain('$12,000');
    expect(text).toContain('Inverter bracket offset');
  });

  it('formats clean markdown suitable for docs/EXECUTIVE_BRIEFING.md', () => {
    const md = formatExecutiveBriefingMarkdown(data);
    expect(md).toContain('# Executive Briefing: Solar Field Rig');
    expect(md).toContain('## Financial Rollup');
    expect(md).toContain('## Phase-Gate Milestone Status');
  });
});
