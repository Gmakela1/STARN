// web_fetch content-type gate tests: non-text bodies are refused, text types still decode.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutionContext } from '../src/tools/types.js';
import type { PdfTextMeta } from '../src/tools/handlers/pdf-extractor.js';

/** Extractor is mocked so the PDF routing assertion never depends on pdfjs output. */
vi.mock('../src/tools/handlers/pdf-extractor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/tools/handlers/pdf-extractor.js')>();
  return { ...actual, extractPdfTextWithMeta: vi.fn() };
});

const { extractPdfTextWithMeta } = await import('../src/tools/handlers/pdf-extractor.js');
const extractMock = vi.mocked(extractPdfTextWithMeta);
const { webFetchHandler } = await import('../src/tools/handlers/web-fetch.js');

/** Bytes of a real PNG header: binary, not decodable as a page. */
function pngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // \x89PNG\r\n\x1a\n
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0xff, 0xfe, 0x80, 0x81, 0x00, 0xc3, 0x28, 0xa0
  ]);
}

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Response double without a stream body: the handler reads it via `arrayBuffer()`. */
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

const PRODUCT_HTML =
  '<html><head>' +
  '<script type="application/ld+json">{"@type":"Product","name":"Kelly KLS7245N","offers":{"price":"129.00","priceCurrency":"USD"}}</script>' +
  '</head><body><h1>Controller</h1><p>Peak Current: 450A</p></body></html>';

describe('web_fetch content-type gate', () => {
  const context: ToolExecutionContext = { projectPath: '/tmp/test', stateManager: {} as any };

  beforeEach(() => {
    vi.unstubAllGlobals();
    extractMock.mockReset();
  });

  it('refuses image/png instead of returning mojibake', async () => {
    stubFetch(pngBytes(), 'image/png');

    const res = await webFetchHandler.execute({ url: 'https://example.com/logo.png' }, context);

    expect(res.success).toBe(false);
    expect(res.error).toBe(
      'This URL is image/png, not a text page. Download it into reference/ and read it with fs_read.'
    );
    expect(res.result).toBeUndefined();
    expect(res.error).not.toContain('\uFFFD');
    expect(extractMock).not.toHaveBeenCalled();
  });

  it('refuses application/octet-stream without %PDF- magic', async () => {
    stubFetch(pngBytes(), 'application/octet-stream');

    const res = await webFetchHandler.execute({ url: 'https://example.com/blob' }, context);

    expect(res.success).toBe(false);
    expect(res.error).toContain('application/octet-stream');
    expect(res.result).toBeUndefined();
  });

  it('keeps the text/html success path with structured data intact', async () => {
    stubFetch(textBytes(PRODUCT_HTML), 'text/html; charset=utf-8');

    const res = await webFetchHandler.execute({ url: 'https://example.com/product' }, context);

    expect(res.success).toBe(true);
    expect(res.result).toContain('[structured data]');
    expect(res.result).toContain('Kelly KLS7245N');
    expect(res.result).toContain('129.00 USD');
    expect(res.result).toContain('Peak Current: 450A');
  });

  it('allows application/json', async () => {
    stubFetch(textBytes('{"sku":"MOT-ME1115","price":875}'), 'application/json');

    const res = await webFetchHandler.execute({ url: 'https://example.com/api/item' }, context);

    expect(res.success).toBe(true);
    expect(res.result).toContain('MOT-ME1115');
  });

  it('allows a response with no content-type header', async () => {
    stubFetch(textBytes('<html><body><p>No header page</p></body></html>'), null);

    const res = await webFetchHandler.execute({ url: 'https://example.com/plain' }, context);

    expect(res.success).toBe(true);
    expect(res.result).toContain('No header page');
  });

  it('routes application/pdf with %PDF- magic to the PDF extractor, not the refusal', async () => {
    extractMock.mockResolvedValue({
      text: 'Peak Current: 450A',
      numPages: 1,
      pagesRead: 1,
      textTruncated: false
    } satisfies PdfTextMeta);
    stubFetch(textBytes('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'), 'application/pdf');

    const res = await webFetchHandler.execute({ url: 'https://example.com/datasheet.pdf' }, context);

    expect(res.success).toBe(true);
    expect(res.result).toContain('[pdf text extracted from url]');
    expect(res.result).toContain('Peak Current: 450A');
    expect(extractMock).toHaveBeenCalledOnce();
  });
});
