import { describe, it, expect } from 'vitest';
import { extractConopsOverview, extractConopsCharter } from '../src/core/conops-overview.js';

describe('extractConopsCharter', () => {
  it('extracts all 7 charter subsections from Section 1 in order, excluding System-Level Capabilities', () => {
    const md = `# CONOPS

## 1. Project Overview & Charter

Intro overview prose.

### Background & Problem
Old diesel tractor is noisy.

### Purpose
Convert to clean electric.

### Objectives
- Zero emissions
- 4 hour runtime

### Success Criteria
Mows 2 acres on a charge.

### Scope
**In scope:** motor, battery.
**Out of scope:** bodywork.

### Users & Stakeholders
Property owner.

### Key Constraints & Assumptions
120V charging available.

### System-Level Capabilities
- Electric traction

## 2. Operational Environment
Outdoors.`;

    const charter = extractConopsCharter(md);
    expect(charter).toHaveLength(8); // Intro 'Overview' + 7 subsections
    expect(charter[0]).toEqual({ heading: 'Overview', body: 'Intro overview prose.' });
    expect(charter[1]).toEqual({ heading: 'Background & Problem', body: 'Old diesel tractor is noisy.' });
    expect(charter[2]).toEqual({ heading: 'Purpose', body: 'Convert to clean electric.' });
    expect(charter[7]).toEqual({ heading: 'Key Constraints & Assumptions', body: '120V charging available.' });
    expect(charter.some(s => s.heading.includes('System-Level Capabilities'))).toBe(false);
  });

  it('handles legacy CONOPS without subsections by returning a single Overview entry', () => {
    const md = `## 1. Executive Summary & User Intent\nA single prose paragraph.\n\n## 2. Operational Environment\nOutdoors.`;
    const charter = extractConopsCharter(md);
    expect(charter).toEqual([{ heading: 'Overview', body: 'A single prose paragraph.' }]);
  });

  it('returns empty array when Section 1 is absent', () => {
    expect(extractConopsCharter('# Document without section 1')).toEqual([]);
  });

  it('preserves nested markdown in bodies (lists, bolding)', () => {
    const md = `## 1. Project Overview & Charter\n\n### Objectives\n- Item 1\n- Item 2: **bold detail**\n\n## 2. Next`;
    const charter = extractConopsCharter(md);
    expect(charter).toEqual([
      { heading: 'Objectives', body: '- Item 1\n- Item 2: **bold detail**' }
    ]);
  });
});

describe('extractConopsOverview', () => {
  it('returns Section 1 intro prose up to the first ### subsection', () => {
    const md = `# CONOPS: Tractor

## 1. Project Overview & Charter
Converts a diesel tractor to electric.

Primary intent is quiet operation.

### System-Level Capabilities
- Electric traction

## 2. Operational Environment
Outdoors.`;
    expect(extractConopsOverview(md)).toBe(
      'Converts a diesel tractor to electric.\n\nPrimary intent is quiet operation.'
    );
  });

  it('stops at the next ## section when there are no subsections', () => {
    const md = `## 1. Executive Summary\nShort overview.\n## 2. Environment\nOutdoors.`;
    expect(extractConopsOverview(md)).toBe('Short overview.');
  });

  it('falls back to Purpose when Section 1 has no intro prose', () => {
    const md = `## 1. Project Overview & Charter\n\n### Purpose\nConvert tractor to clean electric.\n\n### Objectives\nMow the lawn.`;
    expect(extractConopsOverview(md)).toBe('Convert tractor to clean electric.');
  });

  it('falls back to first subsection when Purpose is missing and no intro prose', () => {
    const md = `## 1. Project Overview & Charter\n\n### Background & Problem\nOld engine broke down.\n\n### Objectives\nMow the lawn.`;
    expect(extractConopsOverview(md)).toBe('Old engine broke down.');
  });

  it('returns null when Section 1 is missing', () => {
    expect(extractConopsOverview('# Title\n\n## 2. Environment\nOutdoors.')).toBeNull();
  });

  it('returns null for empty input or empty Section 1', () => {
    expect(extractConopsOverview('')).toBeNull();
    expect(extractConopsOverview('## 1. Project Overview & Charter\n\n## 2. Environment')).toBeNull();
  });
});
