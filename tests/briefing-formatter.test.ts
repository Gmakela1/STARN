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

  it('formats clean plain text for terminal output with charter on page 1 and financials on page 2', () => {
    const dataWithCharter = {
      ...data,
      charter: [
        { heading: 'Purpose', body: 'Build deployable solar array.' },
        { heading: 'Objectives', body: '- Fast deployment\n- Rugged' }
      ]
    };
    const text = formatExecutiveBriefingPlain(dataWithCharter);
    expect(text).toContain('EXECUTIVE BRIEFING');
    expect(text).toContain('Solar Field Rig');
    expect(text).toContain('1. PROJECT OVERVIEW & CHARTER');
    expect(text).toContain('[Purpose]');
    expect(text).toContain('Build deployable solar array.');

    // Page 2 comes after Section 1, and starts with financials
    const p1Idx = text.indexOf('1. PROJECT OVERVIEW & CHARTER');
    const p2Idx = text.indexOf('PAGE 2');
    const finIdx = text.indexOf('2. FINANCIAL & PROCUREMENT ROLLUP');

    expect(p1Idx).toBeGreaterThan(-1);
    expect(p2Idx).toBeGreaterThan(p1Idx);
    expect(finIdx).toBeGreaterThan(p2Idx);
    expect(text).toContain('$12,000');
    expect(text).toContain('Inverter bracket offset');
  });

  it('formats clean markdown suitable for docs/EXECUTIVE_BRIEFING.md', () => {
    const md = formatExecutiveBriefingMarkdown(data);
    expect(md).toContain('# Executive Briefing: Solar Field Rig');
    expect(md).toContain('## 2. Financial & Procurement Rollup');
    expect(md).toContain('## 3. Phase-Gate Milestone Status');
  });
});
