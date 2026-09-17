import { describe, it, expect } from 'vitest';
import { formatDocumentToc, extractSections } from '../src/cli/ui.js';

const SAMPLE_DOC = `# BOM

## SS-01: Traction Motor
### Candidate table
content here

## SS-02: Battery Pack
### Candidate table
more content

## Design Decisions
D-001`;

describe('formatDocumentToc', () => {
  it('formats a two-level TOC with all ## and ### headings', () => {
    const toc = formatDocumentToc(SAMPLE_DOC);
    expect(toc).toContain('SS-01: Traction Motor');
    expect(toc).toContain('Candidate table');
    expect(toc).toContain('SS-02: Battery Pack');
    expect(toc).toContain('Design Decisions');
  });
});

describe('extractSections', () => {
  it('extracts section content by heading', () => {
    const sections = extractSections(SAMPLE_DOC);
    expect(sections['SS-01: Traction Motor']).toContain('content here');
    expect(sections['SS-02: Battery Pack']).toContain('more content');
  });
});
