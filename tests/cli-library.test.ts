import { describe, it, expect } from 'vitest';
import { parseFilePathArg, formatLibraryTable } from '../src/cli/library-commands.js';
import { LibraryListing } from '../src/workspace/project-files.js';

describe('CLI library command helpers', () => {
  it('parseFilePathArg trims unquoted and strips matched quotes', () => {
    expect(parseFilePathArg('my-file.md')).toBe('my-file.md');
    expect(parseFilePathArg('"my file.pdf"')).toBe('my file.pdf');
    expect(parseFilePathArg("'path/with spaces/file.txt'")).toBe('path/with spaces/file.txt');
    expect(parseFilePathArg('')).toBe('');
  });

  it('formatLibraryTable formats references and specialist examples', () => {
    const listing: LibraryListing = {
      references: [
        { name: 'pinout.txt', size: 1024, modified: '2026-10-10T12:00:00Z' }
      ],
      examples: {
        conops: [
          { name: 'sample.md', size: 2048, modified: '2026-10-10T12:00:00Z' }
        ]
      }
    };

    const out = formatLibraryTable(listing);
    expect(out).toContain('PROJECT LIBRARY: REFERENCES & QUALITY EXAMPLES');
    expect(out).toContain('pinout.txt');
    expect(out).toContain('CONOPS');
    expect(out).toContain('sample.md');
  });

  it('formatLibraryTable shows clean empty message when library is empty', () => {
    const listing: LibraryListing = {
      references: [],
      examples: {}
    };
    const out = formatLibraryTable(listing);
    expect(out).toContain('No reference documents or custom quality examples');
  });
});
