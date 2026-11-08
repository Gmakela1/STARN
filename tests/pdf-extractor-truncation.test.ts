// pdf-extractor page-cap tests: the TEXT_MAX_PAGES cut is announced and the pdfjs document is always destroyed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractTextFromPdfBuffer } from '../src/tools/handlers/pdf-extractor.js';

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

function serveDoc(doc: ReturnType<typeof fakeDoc>): void {
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
});
