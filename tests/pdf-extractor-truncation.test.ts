// pdf-extractor page/text-cap tests: both cuts are announced and the pdfjs document is always destroyed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MAX_TEXT_CHARS,
  extractPdfTextWithMeta,
  extractTextFromPdfBuffer,
} from '../src/tools/handlers/pdf-extractor.js';

/** pdfjs is mocked: these tests assert the extractor's own contract, not pdfjs parsing. */
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: vi.fn() }));

const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const getDocumentMock = vi.mocked(getDocument as any);

/** Fake pdfjs document: one text-bearing page per requested index. */
function fakeDoc(numPages: number, getPage?: (index: number) => Promise<any>) {
  return {
    numPages,
    getPage: vi.fn(getPage ?? (async (index: number) => ({
      getTextContent: async () => ({ items: [{ str: `page ${index}` }] }),
    }))),
    destroy: vi.fn(async () => {}),
  };
}

/** Fake pdfjs document whose every page carries the same `pageText` (for the char budget). */
function fakeDenseDoc(numPages: number, pageText: string) {
  return {
    numPages,
    getPage: vi.fn(async () => ({ getTextContent: async () => ({ items: [{ str: pageText }] }) })),
    destroy: vi.fn(async () => {}),
  };
}

function serveDoc(doc: { destroy: unknown }): void {
  getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) } as any);
}

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF" — content is irrelevant, pdfjs is mocked.

describe('extractTextFromPdfBuffer page cap', () => {
  beforeEach(() => {
    getDocumentMock.mockReset();
  });

  it('announces truncation with the real page count when the document exceeds the cap', async () => {
    const doc = fakeDoc(120);
    serveDoc(doc);

    const text = await extractTextFromPdfBuffer(bytes);

    expect(text).toContain('\n\n[Truncated: first 40 of 120 pages — use read_chart_data or split the PDF]');
    expect(text).toContain('page 40');
    expect(text).not.toContain('page 41');
    expect(doc.getPage).toHaveBeenCalledTimes(40);
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it('adds no truncation notice at exactly the cap', async () => {
    const doc = fakeDoc(40);
    serveDoc(doc);

    const text = await extractTextFromPdfBuffer(bytes);

    expect(text).not.toContain('[Truncated');
    expect(doc.getPage).toHaveBeenCalledTimes(40);
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it('adds no truncation notice under the cap', async () => {
    const doc = fakeDoc(7);
    serveDoc(doc);

    const text = await extractTextFromPdfBuffer(bytes);

    expect(text).not.toContain('[Truncated');
    expect(text).toContain('page 7');
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the document when page extraction throws', async () => {
    const doc = fakeDoc(3, async () => {
      throw new Error('page decode failed');
    });
    serveDoc(doc);

    await expect(extractTextFromPdfBuffer(bytes)).rejects.toThrow('page decode failed');
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  // Round-3 blocking fix: the character cap must bound the WORK, not just the output.
  it('stops accumulating at MAX_TEXT_CHARS and never parses the remaining pages', async () => {
    const doc = fakeDenseDoc(120, 'a'.repeat(30000));
    serveDoc(doc);

    const result = await extractPdfTextWithMeta(bytes);

    expect(result.textTruncated).toBe(true);
    expect(result.pagesRead).toBe(2);
    expect(result.numPages).toBe(120);
    expect(doc.getPage).toHaveBeenCalledTimes(2);
    // Two 30,000-char pages plus one page break: nothing beyond the budget was accumulated.
    expect(result.text.length).toBeLessThan(MAX_TEXT_CHARS + 30000);
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it('reports textTruncated=false when the document fits the budget', async () => {
    const doc = fakeDenseDoc(3, 'Torque: 12 Nm');
    serveDoc(doc);

    const result = await extractPdfTextWithMeta(bytes);

    expect(result.textTruncated).toBe(false);
    expect(result.pagesRead).toBe(3);
    expect(result.text).toBe(
      ['Torque: 12 Nm', '--- Page Break ---', 'Torque: 12 Nm', '--- Page Break ---', 'Torque: 12 Nm'].join('\n\n')
    );
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  // Round-4 blocking fix: a char-budget cut must say so. The old notice claimed page
  // truncation, so a ≤40-page PDF looked like a complete read of a page-capped document.
  it('announces the text budget honestly when it stops a short document early', async () => {
    const doc = fakeDenseDoc(12, 'a'.repeat(30000));
    serveDoc(doc);

    const text = await extractTextFromPdfBuffer(bytes);

    expect(text).toContain(
      '\n\n[Truncated: text budget of 60,000 characters reached at page 2 of 12 — use read_chart_data or split the PDF]'
    );
    expect(text).not.toContain('first 2 of 12 pages');
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  // fs_read/project-files contract: a text-budget cut still names the real page coverage.
  it('keeps a tail notice in the wrapper when the text budget stopped early', async () => {
    const doc = fakeDenseDoc(120, 'a'.repeat(30000));
    serveDoc(doc);

    const text = await extractTextFromPdfBuffer(bytes);

    expect(text).toContain(
      '\n\n[Truncated: text budget of 60,000 characters reached at page 2 of 120 — use read_chart_data or split the PDF]'
    );
  });
});
