// web_fetch PDF branch tests: PDF URLs yield extracted text (never raw binary); HTML path unchanged.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolExecutionContext } from '../src/tools/types.js';
import { NO_PDF_TEXT_MARKER } from '../src/tools/handlers/pdf-extractor.js';

/** Extractor is mocked so the test never depends on pdfjs output or a real PDF file. */
vi.mock('../src/tools/handlers/pdf-extractor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/tools/handlers/pdf-extractor.js')>();
  return { ...actual, extractTextFromPdfBuffer: vi.fn() };
});

const { extractTextFromPdfBuffer } = await import('../src/tools/handlers/pdf-extractor.js');
const extractMock = vi.mocked(extractTextFromPdfBuffer);

const PDF_REFUSAL =
  'This URL is a PDF and its text layer could not be read. Download it into reference/ and read it with fs_read, or use read_chart_data for charts.';

/** Minimal fake PDF payload: enough to carry the `%PDF-` magic and binary-looking body. */
function pdfBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nstream\n\x00\x01\x02\nendstream\nendobj\n');
}

function htmlBytes(html: string): Uint8Array {
  return new TextEncoder().encode(html);
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

describe('web_fetch PDF handling', () => {
  const registry = new ToolRegistry();
  const context: ToolExecutionContext = { projectPath: '/tmp/test', stateManager: {} as any };

  beforeEach(() => {
    vi.unstubAllGlobals();
    extractMock.mockReset();
  });

  it('returns extracted text instead of binary for an application/pdf response', async () => {
    extractMock.mockResolvedValue('Peak Current: 450A\nNominal Voltage: 72V');
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

  it('treats %PDF- magic bytes as a PDF even without a pdf content-type', async () => {
    extractMock.mockResolvedValue('Torque: 12 Nm');
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
    extractMock.mockResolvedValue(NO_PDF_TEXT_MARKER);
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

  it('refuses a PDF body larger than the raw-byte cap before parsing', async () => {
    const huge = Buffer.alloc(2 * 1024 * 1024 + 1, 0x20);
    huge.write('%PDF-1.4\n', 0, 'latin1');
    stubFetch(new Uint8Array(huge), 'application/pdf');

    const res = await registry.execute('web_fetch', { url: 'https://example.com/huge.pdf' }, context, ['web_fetch']);

    expect(res.success).toBe(false);
    expect(res.error).toBe(PDF_REFUSAL);
    expect(extractMock).not.toHaveBeenCalled();
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
