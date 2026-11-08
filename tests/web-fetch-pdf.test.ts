// web_fetch PDF branch tests: PDF URLs yield extracted text (never raw binary); HTML path unchanged.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolExecutionContext } from '../src/tools/types.js';
import type { PdfTextMeta } from '../src/tools/handlers/pdf-extractor.js';

/** Extractor is mocked so the test never depends on pdfjs output or a real PDF file. */
vi.mock('../src/tools/handlers/pdf-extractor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/tools/handlers/pdf-extractor.js')>();
  return { ...actual, extractPdfTextWithMeta: vi.fn() };
});

const { extractPdfTextWithMeta } = await import('../src/tools/handlers/pdf-extractor.js');
const extractMock = vi.mocked(extractPdfTextWithMeta);

const PDF_REFUSAL =
  'This URL is a PDF and its text layer could not be read. Download it into reference/ and read it with fs_read, or use read_chart_data for charts.';

/** Extraction result with a fully-read single-page default, so tests state only what matters. */
function meta(text: string, overrides: Partial<PdfTextMeta> = {}): PdfTextMeta {
  const numPages = overrides.numPages ?? 1;
  return { text, numPages, pagesRead: numPages, textTruncated: false, ...overrides };
}

/** Minimal fake PDF payload: enough to carry the `%PDF-` magic and binary-looking body. */
function pdfBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nstream\n\x00\x01\x02\nendstream\nendobj\n');
}

function htmlBytes(html: string): Uint8Array {
  return new TextEncoder().encode(html);
}

/**
 * A real, parseable one-page PDF carrying the text "Dummy PDF file". pdfjs is NOT
 * mocked for the end-to-end test, so this must be a genuine document.
 */
function realPdfBytes(): Uint8Array {
  return new TextEncoder().encode(
    '%PDF-1.4\n' +
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n' +
      '4 0 obj << /Length 44 >> stream\nBT /F1 24 Tf 72 700 Td (Dummy PDF file) Tj ET\nendstream endobj\n' +
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n' +
      'trailer << /Root 1 0 R /Size 6 >>\n%%EOF\n'
  );
}

function stubFetch(bytes: Uint8Array, contentType: string | null): void {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }));
}

/** Read/cancel bookkeeping for the streaming doubles below. */
interface StreamCounters {
  reads: number;
  cancelled: boolean;
}

/**
 * Response double whose body is a real `ReadableStream` over `chunks`, so the handler's
 * bounded read path (reader + `cancel()`) is exercised for real.
 *
 * @param chunks Body chunks served in order.
 * @param contentType Raw `content-type` header value.
 * @param extraHeaders Additional response headers (e.g. `content-length`).
 * @param counters Optional counters recording `read()` calls and `cancel()` calls.
 */
function stubStreamFetch(
  chunks: Uint8Array[],
  contentType: string | null,
  extraHeaders: Record<string, string> = {},
  counters: StreamCounters = { reads: 0, cancelled: false }
): StreamCounters {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);

  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      counters.reads += 1;
      const chunk = chunks[index];
      if (!chunk) {
        controller.close();
        return;
      }
      index += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      counters.cancelled = true;
    }
  }, { highWaterMark: 0 });

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers,
    body,
    arrayBuffer: async () => {
      throw new Error('arrayBuffer() must not be used when res.body is present');
    }
  }));
  return counters;
}

/** 4 MB chunk beginning with the PDF magic, so the stream looks like a PDF body. */
function pdfChunk(size = 4 * 1024 * 1024): Uint8Array {
  const chunk = Buffer.alloc(size, 0x20);
  chunk.write('%PDF-1.4\n', 0, 'latin1');
  return new Uint8Array(chunk);
}

describe('web_fetch PDF handling', () => {
  const registry = new ToolRegistry();
  const context: ToolExecutionContext = { projectPath: '/tmp/test', stateManager: {} as any };

  beforeEach(() => {
    vi.unstubAllGlobals();
    extractMock.mockReset();
  });

  it('returns extracted text instead of binary for an application/pdf response', async () => {
    extractMock.mockResolvedValue(meta('Peak Current: 450A\nNominal Voltage: 72V'));
    stubFetch(pdfBytes(), 'application/pdf');

    const res = await registry.execute(
      'web_fetch',
      { url: 'https://example.com/kelly-datasheet.pdf' },
      context,
      ['web_fetch']
    );

    expect(res.success).toBe(true);
    expect(res.result).toContain('[pdf text extracted from url]');
    expect(res.result).toContain('https://example.com/kelly-datasheet.pdf');
    expect(res.result).toContain('Peak Current: 450A');
    expect(res.result).not.toContain('%PDF');
    expect(res.result).not.toContain('endobj');
    expect(res.result).not.toContain('stream');
    expect(extractMock).toHaveBeenCalledOnce();
  });

  // Regression for 7cea897: pdfjs rejects a Node Buffer ("Please provide binary data as
  // 'Uint8Array', rather than 'Buffer'"), so every remote PDF failed with PDF_REFUSAL.
  it('hands the extractor a Uint8Array, never a Node Buffer', async () => {
    extractMock.mockResolvedValue(meta('Peak Current: 450A'));
    stubFetch(pdfBytes(), 'application/pdf');

    await registry.execute('web_fetch', { url: 'https://example.com/datasheet.pdf' }, context, ['web_fetch']);

    const received = extractMock.mock.calls[0][0];
    expect(Buffer.isBuffer(received)).toBe(false);
    expect(received).toBeInstanceOf(Uint8Array);
  });

  // Same regression, unmocked: the real pdfjs must accept the bytes and return the text.
  it('extracts text from a real PDF body end-to-end', async () => {
    vi.doUnmock('../src/tools/handlers/pdf-extractor.js');
    vi.resetModules();
    stubFetch(realPdfBytes(), 'application/pdf');

    const { webFetchHandler } = await import('../src/tools/handlers/web-fetch.js');
    const res = await webFetchHandler.execute({ url: 'https://example.com/dummy.pdf' }, context);

    expect(res.success).toBe(true);
    expect(res.result).toContain('[pdf text extracted from url]');
    expect(res.result).toContain('Dummy PDF file');
  }, 60000);

  it('treats %PDF- magic bytes as a PDF even without a pdf content-type', async () => {
    extractMock.mockResolvedValue(meta('Torque: 12 Nm'));
    stubFetch(pdfBytes(), null);

    const res = await registry.execute(
      'web_fetch',
      { url: 'https://example.com/download?id=42' },
      context,
      ['web_fetch']
    );

    expect(res.success).toBe(true);
    expect(res.result).toContain('[pdf text extracted from url]');
    expect(res.result).toContain('Torque: 12 Nm');
    expect(res.result).not.toContain('%PDF');
  });

  it('refuses with guidance when the PDF text layer is empty', async () => {
    extractMock.mockResolvedValue(meta(''));
    stubFetch(pdfBytes(), 'application/pdf');

    const res = await registry.execute(
      'web_fetch',
      { url: 'https://example.com/scanned.pdf' },
      context,
      ['web_fetch']
    );

    expect(res.success).toBe(false);
    expect(res.error).toBe(PDF_REFUSAL);
  });

  it('refuses with guidance when extraction throws', async () => {
    extractMock.mockRejectedValue(new Error('Invalid PDF structure'));
    stubFetch(pdfBytes(), 'application/pdf');

    const res = await registry.execute(
      'web_fetch',
      { url: 'https://example.com/broken.pdf' },
      context,
      ['web_fetch']
    );

    expect(res.success).toBe(false);
    expect(res.error).toBe(PDF_REFUSAL);
  });

  // Round-3 blocking fix: the page-coverage notice must survive the 20,000-char slice, so it
  // rides in the HEADER line instead of the tail.
  it('names the page range in the header so coverage survives the character cap', async () => {
    extractMock.mockResolvedValue(
      meta('dense page text '.repeat(2000), { numPages: 120, pagesRead: 40, textTruncated: true })
    );
    stubFetch(pdfBytes(), 'application/pdf');

    const res = await registry.execute('web_fetch', { url: 'https://example.com/dense.pdf' }, context, ['web_fetch']);

    expect(res.success).toBe(true);
    const header = res.result!.split('\n')[0];
    expect(header).toBe('[pdf text extracted from url] https://example.com/dense.pdf — pages 1-40 of 120');
    expect(res.result).toContain('[Content truncated at 20,000 characters]');
    // The body is capped: nothing after the header may exceed the cap plus the notice.
    const body = res.result!.slice(header.length + 2, -'\n\n[Content truncated at 20,000 characters]'.length);
    expect(body.length).toBe(20000);
  });

  it('omits the page range when every page was read', async () => {
    extractMock.mockResolvedValue(meta('Torque: 12 Nm', { numPages: 3, pagesRead: 3 }));
    stubFetch(pdfBytes(), 'application/pdf');

    const res = await registry.execute('web_fetch', { url: 'https://example.com/short.pdf' }, context, ['web_fetch']);

    expect(res.result!.split('\n')[0]).toBe('[pdf text extracted from url] https://example.com/short.pdf');
  });

  // Regression guard for arxiv.org/pdf/1706.03762: 20,106 characters must still succeed.
  it('still succeeds on a 20,106-character extraction (arxiv datasheet case)', async () => {
    extractMock.mockResolvedValue(meta('x'.repeat(20106), { numPages: 15, pagesRead: 15 }));
    stubFetch(pdfBytes(), 'application/pdf');

    const res = await registry.execute('web_fetch', { url: 'https://arxiv.org/pdf/1706.03762' }, context, ['web_fetch']);

    expect(res.success).toBe(true);
    expect(res.result).toContain('x'.repeat(5000));
    expect(res.result).toContain('[Content truncated at 20,000 characters]');
    expect(res.result).not.toContain('pages 1-');
  });

  // Round-3 blocking fix: an over-limit `content-length` is refused before a single body
  // byte is read, so a 500 MB claim never lands in RAM.
  it('refuses an over-limit content-length before reading the body', async () => {
    const counters = stubStreamFetch([pdfChunk()], 'application/pdf', {
      'content-length': String(20 * 1024 * 1024)
    });

    const res = await registry.execute('web_fetch', { url: 'https://example.com/declared.pdf' }, context, ['web_fetch']);

    expect(res.success).toBe(false);
    expect(res.error).toContain('20.0 MB');
    expect(res.error).toContain('15 MB limit');
    expect(res.error).not.toContain('text layer could not be read');
    expect(counters.reads).toBe(0);
    expect(extractMock).not.toHaveBeenCalled();
  });

  // Round-3 blocking fix: a body that lies about its size is aborted mid-read.
  it('aborts and refuses a body that streams past the PDF limit', async () => {
    const counters = stubStreamFetch([pdfChunk(), pdfChunk(), pdfChunk(), pdfChunk(), pdfChunk()], 'application/pdf');

    const res = await registry.execute('web_fetch', { url: 'https://example.com/streaming.pdf' }, context, ['web_fetch']);

    expect(res.success).toBe(false);
    expect(res.error).toContain('15 MB limit');
    expect(counters.cancelled).toBe(true);
    // 5 x 4 MB available, refusal after the 4th chunk: the last one is never read.
    expect(counters.reads).toBe(4);
    expect(extractMock).not.toHaveBeenCalled();
  });

  it('streams a normal PDF body to the extractor unchanged', async () => {
    const body = pdfBytes();
    extractMock.mockResolvedValue(meta('Peak Current: 450A'));
    stubStreamFetch([body], 'application/pdf');

    const res = await registry.execute('web_fetch', { url: 'https://example.com/streamed.pdf' }, context, ['web_fetch']);

    expect(res.success).toBe(true);
    const received = extractMock.mock.calls[0][0] as Uint8Array;
    expect(received.byteLength).toBe(body.byteLength);
    expect(Buffer.from(received).toString('latin1')).toContain('%PDF-1.4');
  });

  it('decodes an iso-8859-1 page with its declared charset (not utf-8 mojibake)', async () => {
    const latin1 = Buffer.from(
      '<html><body><h1>Kühler 25 °C</h1><p>Drehmoment: 12 Nm · 40 µF</p></body></html>',
      'latin1'
    );
    stubFetch(new Uint8Array(latin1), 'text/html; charset=iso-8859-1');

    const res = await registry.execute('web_fetch', { url: 'https://example.com/de/manual' }, context, ['web_fetch']);

    expect(res.success).toBe(true);
    expect(res.result).toContain('Kühler 25 °C');
    expect(res.result).toContain('40 µF');
    expect(res.result).not.toContain('\uFFFD');
  });

  it('decodes a single-quoted charset label (quotes stripped, not fed to TextDecoder)', async () => {
    const latin1 = Buffer.from('<html><body><h1>Kühler 25 °C</h1></body></html>', 'latin1');
    stubFetch(new Uint8Array(latin1), "text/html; charset='iso-8859-1'");

    const res = await registry.execute('web_fetch', { url: 'https://example.com/de/quoted' }, context, ['web_fetch']);

    expect(res.success).toBe(true);
    expect(res.result).toContain('Kühler 25 °C');
    expect(res.result).not.toContain('\uFFFD');
  });

  it('caps the buffered HTML body by BYTES before decoding', async () => {
    // 'é' is 2 bytes in utf-8: the body exceeds the 2 MB byte cap while staying
    // under 2 MB characters, so a character-based slice would keep the JSON-LD.
    const filler = 'é'.repeat(1_100_000);
    const html =
      '<html><head>' +
      filler +
      '<script type="application/ld+json">{"@type":"Product","name":"BeyondCap","offers":{"price":"1234.00","priceCurrency":"USD"}}</script>' +
      '</head><body><p>Visible body text</p></body></html>';
    const body = Buffer.from(html, 'utf8');
    expect(body.byteLength).toBeGreaterThan(2 * 1024 * 1024);
    expect(html.length).toBeLessThan(2 * 1024 * 1024);
    stubFetch(new Uint8Array(body), 'text/html; charset=utf-8');

    const res = await registry.execute('web_fetch', { url: 'https://example.com/wide-chars' }, context, ['web_fetch']);

    expect(res.success).toBe(true);
    expect(res.result).not.toContain('1234.00');
  });

  // The PDF cap is 15 MB, NOT the 2 MB HTML cap: arxiv.org/pdf/1706.03762 is 2.11 MB and
  // must extract. Oversize is a size refusal, not a parse failure, so it must not claim
  // the text layer was unreadable.
  it('refuses a PDF body over the 15 MB cap with an honest size message', async () => {
    const huge = Buffer.alloc(16 * 1024 * 1024, 0x20);
    huge.write('%PDF-1.4\n', 0, 'latin1');
    stubFetch(new Uint8Array(huge), 'application/pdf');

    const res = await registry.execute('web_fetch', { url: 'https://example.com/huge.pdf' }, context, ['web_fetch']);

    expect(res.success).toBe(false);
    expect(res.error).toContain('16.0 MB');
    expect(res.error).toContain('15 MB limit');
    expect(res.error).not.toContain('text layer could not be read');
    expect(extractMock).not.toHaveBeenCalled();
  });

  it('extracts a 3 MB PDF body (real datasheet size) instead of refusing it', async () => {
    const datasheet = Buffer.alloc(3 * 1024 * 1024, 0x20);
    datasheet.write('%PDF-1.4\n', 0, 'latin1');
    extractMock.mockResolvedValue(meta('Peak Current: 450A\nNominal Voltage: 72V'));
    stubFetch(new Uint8Array(datasheet), 'application/pdf');

    const res = await registry.execute('web_fetch', { url: 'https://example.com/3mb-datasheet.pdf' }, context, ['web_fetch']);

    expect(extractMock).toHaveBeenCalledOnce();
    expect(res.success).toBe(true);
    expect(res.result).toContain('Peak Current: 450A');
  });

  it('keeps the HTML extraction path unchanged for text/html responses', async () => {
    stubFetch(
      htmlBytes(
        '<html><head><script type="application/ld+json">{"@type":"Product","name":"Kelly KLS7245N","sku":"KLS-7245N","offers":{"price":"189.00","priceCurrency":"USD"}}</script></head>' +
          '<body><h1>Kelly KLS7245N</h1><p>72V 450A sinusoidal controller.</p></body></html>'
      ),
      'text/html; charset=utf-8'
    );

    const res = await registry.execute(
      'web_fetch',
      { url: 'https://example.com/kelly-manual' },
      context,
      ['web_fetch']
    );

    expect(res.success).toBe(true);
    expect(res.result).toContain('Kelly KLS7245N');
    expect(res.result).toContain('189.00');
    expect(res.result).toContain('72V 450A');
    expect(res.result).not.toContain('[pdf text extracted from url]');
    expect(extractMock).not.toHaveBeenCalled();
  });
});