import { describe, it, expect } from 'vitest';
import { extractConopsOverview } from '../src/core/conops-overview.js';

describe('extractConopsOverview', () => {
  it('returns Section 1 prose up to the first ### subsection', () => {
    const md = `# CONOPS: Tractor

## 1. Executive Summary & User Intent
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

  it('returns null when Section 1 is missing', () => {
    expect(extractConopsOverview('# Title\n\n## 2. Environment\nOutdoors.')).toBeNull();
  });

  it('returns null for empty input or an empty Section 1', () => {
    expect(extractConopsOverview('')).toBeNull();
    expect(extractConopsOverview('## 1. Executive Summary\n\n### Sub\nx')).toBeNull();
  });
});
