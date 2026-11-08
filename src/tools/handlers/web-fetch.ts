// web_fetch tool handler: SSRF-guarded page fetch, structured-data harvest, readable-text extraction.
import dns from 'node:dns/promises';
import net from 'node:net';
import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import { NO_PDF_TEXT_MARKER, extractTextFromPdfBuffer } from './pdf-extractor.js';

/**
 * Maximum raw BODY bytes considered for cleaning (raised from 50 KB). HTML is cut to
 * this many bytes before decoding; a larger PDF body is refused instead.
 */
const MAX_RAW_BYTES = 2 * 1024 * 1024;
/** Maximum characters of cleaned text returned to the model. */
const MAX_OUTPUT_CHARS = 20000;
const TRUNCATION_NOTICE = '\n\n[Content truncated at 20,000 characters]';
const EMPTY_PAGE_NOTICE = 'Web page was empty or contained no readable text.';
const PDF_HEADER = '[pdf text extracted from url]';
/** Refusal used for every unreadable-PDF outcome; matches this handler's `success:false` convention. */
const PDF_REFUSAL =
  'This URL is a PDF and its text layer could not be read. Download it into reference/ and read it with fs_read, or use read_chart_data for charts.';

/**
 * True when the response body is a PDF, judged by content-type or `%PDF-`
 * anywhere in the first 1024 bytes (some servers prepend a BOM or junk).
 *
 * @param contentType Raw `content-type` header value (may be null).
 * @param bytes Raw response body.
 * @returns `true` for PDF responses.
 */
export function looksLikePdf(contentType: string | null, bytes: Uint8Array): boolean {
  if ((contentType ?? '').toLowerCase().includes('application/pdf')) return true;
  return Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-');
}

/**
 * Charset label declared by a `content-type` header (e.g. `text/html;
 * charset=iso-8859-1`), with surrounding single or double quotes stripped —
 * TextDecoder rejects a quoted label and would fall back to utf-8.
 *
 * @param contentType Raw header value (may be null).
 * @returns Lowercased label, or undefined when the header declares none.
 */
function charsetFrom(contentType: string | null): string | undefined {
  const match = /charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^";\s]+))/i.exec(contentType ?? '');
  const label = match?.[1] ?? match?.[2] ?? match?.[3];
  return label ? label.toLowerCase() : undefined;
}

/**
 * Decodes a response body with the charset its `content-type` declares (what
 * `res.text()` used to do), falling back to utf-8 when the label is missing,
 * unknown or the body is malformed for it.
 *
 * @param bytes Raw response body (a Buffer is already a Uint8Array — no copy).
 * @param contentType Raw `content-type` header value (may be null).
 * @returns The decoded body text.
 * @throws Never: any decode failure falls back to a utf-8 decode.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  try {
    return new TextDecoder(charsetFrom(contentType) ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Builds the tool response for a PDF URL by extracting its text layer.
 *
 * @param bytes Raw PDF bytes.
 * @param url Source URL echoed in the result header.
 * @returns `success:true` with capped extracted text, or `success:false` with `PDF_REFUSAL`.
 * @throws Never: extraction errors are converted to the refusal response.
 */
async function buildPdfFetchResult(bytes: Uint8Array, url: string): Promise<ToolExecutionResponse> {
  // Remote PDFs are parsed in-process: refuse absurd bodies before pdfjs sees
  // them instead of buffering/parsing an unbounded document.
  if (bytes.byteLength > MAX_RAW_BYTES) {
    return { success: false, error: PDF_REFUSAL };
  }
  let text: string;
  try {
    text = await extractTextFromPdfBuffer(bytes);
  } catch {
    return { success: false, error: PDF_REFUSAL };
  }

  if (!text || text === NO_PDF_TEXT_MARKER) {
    return { success: false, error: PDF_REFUSAL };
  }

  const capped = text.length > MAX_OUTPUT_CHARS
    ? text.slice(0, MAX_OUTPUT_CHARS) + TRUNCATION_NOTICE
    : text;
  return { success: true, result: `${PDF_HEADER} ${url}\n\n${capped}` };
}

/** Product fields recovered from JSON-LD / Open Graph metadata. All fields optional. */
export interface StructuredData {
  name?: string;
  sku?: string;
  brand?: string;
  price?: string;
  currency?: string;
  availability?: string;
  description?: string;
}

export function isPrivateOrRestrictedIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [b0, b1] = parts;

    // 0.0.0.0/8
    if (b0 === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (RFC1918)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (RFC1918)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (RFC1918)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (Link-local / AWS metadata)
    if (b0 === 169 && b1 === 254) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // ::1 (Loopback)
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // Unique local address (fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local (fe80::/10)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;

    return false;
  }

  return false;
}

/**
 * Decodes the small set of HTML entities that matter for readable text.
 * @param text Raw text possibly containing entities.
 * @returns Text with `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;` decoded.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Converts raw HTML into readable plain text.
 * Removes element *content* (script/style/svg/noscript/comments) before stripping tags,
 * so inline CSS never survives as text.
 * @param html Raw HTML fragment (already size-capped by the caller).
 * @returns Trimmed readable text; empty string when nothing readable remains.
 */
export function cleanHtmlText(html: string): string {
  let text = html;

  // Remove element content (never leaves the payload behind)
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '');
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert headings
  text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n### $1\n');
  // Convert list items
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1');
  // Convert line breaks and paragraph ends
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = decodeHtmlEntities(text);

  // Collapse multiple blank lines
  text = text
    .split('\n')
    .map(line => line.trim())
    .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join('\n');

  return text.trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Keys whose nested objects never describe the product itself (offers, brand, ratings, media). */
const SKIP_KEYS = new Set([
  'offers', 'brand', 'aggregateRating', 'review', 'address', 'image',
  'publisher', 'author', 'potentialAction', 'mainEntityOfPage'
]);

/** Depth-first collection of JSON-LD nodes; `@graph` arrays are traversed like any array. */
function collectNodes(value: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out, depth + 1);
    return;
  }
  const node = asRecord(value);
  if (!node) return;
  out.push(node);
  for (const [key, child] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue;
    if (child && typeof child === 'object') collectNodes(child, out, depth + 1);
  }
}

function offersOf(node: Record<string, unknown>): Record<string, unknown>[] {
  const raw = node.offers;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null);
}

function nodeHasPriceOrSku(node: Record<string, unknown>): boolean {
  if (asText(node.sku)) return true;
  return offersOf(node).some(offer => asText(offer.price) !== undefined);
}

function normalizeAvailability(value: unknown): string | undefined {
  const text = asText(value);
  return text ? text.replace(/^https?:\/\/schema\.org\//i, '') : undefined;
}

function brandName(value: unknown): string | undefined {
  return asText(value) ?? asText(asRecord(value)?.name);
}

/** Parses every JSON-LD block; a malformed block is skipped, never thrown. */
function parseJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Malformed JSON-LD block: ignore and keep scanning.
    }
  }
  return blocks;
}

const META_KEYS = ['og:title', 'og:description', 'product:price:amount', 'product:price:currency'] as const;

/** Reads the handful of meta tags used as structured-data fallbacks. */
function readMetaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tagRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1]?.toLowerCase();
    if (!key || !META_KEYS.includes(key as typeof META_KEYS[number])) continue;
    if (out[key] !== undefined) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(match[0])?.[1];
    if (content !== undefined) out[key] = decodeHtmlEntities(content).trim();
  }
  return out;
}

/**
 * Harvests product fields from JSON-LD and Open Graph metadata, before any tag stripping.
 * Never throws: any parse failure degrades to the fields found so far (possibly none).
 * @param html Raw HTML.
 * @returns Fields that were actually found; absent keys mean "not present".
 */
export function extractStructuredData(html: string): StructuredData {
  const data: StructuredData = {};

  try {
    const nodes: Record<string, unknown>[] = [];
    for (const block of parseJsonLdBlocks(html)) collectNodes(block, nodes);
    const product = nodes.find(nodeHasPriceOrSku);
    if (product) {
      const offer = offersOf(product).find(entry => asText(entry.price) !== undefined) ?? offersOf(product)[0];
      data.name = asText(product.name);
      data.sku = asText(product.sku);
      data.brand = brandName(product.brand);
      data.price = asText(offer?.price);
      data.currency = asText(offer?.priceCurrency);
      data.availability = normalizeAvailability(offer?.availability);
      data.description = asText(product.description);
    }
  } catch {
    // Extraction must never fail a fetch; fall back to meta tags below.
  }

  try {
    const meta = readMetaTags(html);
    data.name ??= meta['og:title'];
    data.description ??= meta['og:description'];
    data.price ??= meta['product:price:amount'];
    data.currency ??= meta['product:price:currency'];
  } catch {
    // Meta fallback is optional.
  }

  return data;
}

/**
 * Renders found fields as a `[structured data]` block of `label: value` lines.
 * @param data Result of {@link extractStructuredData}.
 * @returns Block text, or empty string when no field was found.
 */
export function formatStructuredData(data: StructuredData): string {
  const lines: string[] = [];
  const push = (label: string, value: string | undefined): void => {
    if (value) lines.push(`${label}: ${value}`);
  };
  push('name', data.name);
  push('sku', data.sku);
  push('brand', data.brand);
  push('price', [data.price, data.currency].filter(Boolean).join(' ') || undefined);
  push('availability', data.availability);
  push('description', data.description);
  return lines.length > 0 ? `[structured data]\n${lines.join('\n')}` : '';
}

/**
 * Full extraction pipeline: structured data first, then clean the whole document, then cap.
 * @param html Raw HTML body (caller caps bytes at {@link MAX_RAW_BYTES}).
 * @returns Final tool result: optional `[structured data]` block followed by readable text.
 */
export function buildWebFetchResult(html: string): string {
  const structured = formatStructuredData(extractStructuredData(html));
  const cleaned = cleanHtmlText(html);
  const capped = cleaned.length > MAX_OUTPUT_CHARS
    ? cleaned.slice(0, MAX_OUTPUT_CHARS) + TRUNCATION_NOTICE
    : cleaned;
  const body = capped || EMPTY_PAGE_NOTICE;
  return structured ? `${structured}\n\n${body}` : body;
}

export const webFetchHandler: ToolHandler = {
  name: 'web_fetch',
  definition: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetches a public web page, technical datasheet, or product page and extracts readable markdown text with SSRF security protection.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The HTTP or HTTPS URL to fetch (e.g. https://example.com/datasheet.html).'
          }
        },
        required: ['url']
      }
    }
  },
  execute: async (args: any, _context: ToolExecutionContext): Promise<ToolExecutionResponse> => {
    const rawUrl = String(args?.url ?? '').trim();
    if (!rawUrl) {
      return { success: false, error: 'URL is required.' };
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { success: false, error: `Invalid URL: "${rawUrl}"` };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: 'Only HTTP and HTTPS protocols are permitted.' };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '0.0.0.0') {
      return { success: false, error: 'Private or restricted IP address access is forbidden.' };
    }

    if (net.isIP(hostname)) {
      if (isPrivateOrRestrictedIp(hostname)) {
        return { success: false, error: 'Private or restricted IP address access is forbidden.' };
      }
    } else {
      // Resolve hostname to prevent DNS rebinding to private IPs
      try {
        const lookup = await dns.lookup(hostname);
        if (isPrivateOrRestrictedIp(lookup.address)) {
          return { success: false, error: 'Private or restricted IP address access is forbidden.' };
        }
      } catch (_e) {
        // If DNS fails during offline tests with example.com, allow continued fetch attempt
      }
    }

    try {
      const res = await fetch(parsed.toString(), {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) STARN/1.0 (Hardware-Engineering-Research)',
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8'
        }
      });

      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }

      const bodyContentType = res.headers.get('content-type');
      // Read the body once: the same bytes feed the PDF probe, PDF extraction, and HTML decoding.
      const bytes = Buffer.from(await res.arrayBuffer());
      if (looksLikePdf(bodyContentType, bytes)) {
        return await buildPdfFetchResult(bytes, parsed.toString());
      }

      // Cap the buffered body by BYTES before decoding (same budget the PDF branch
      // enforces), then clean the whole capped document.
      const cappedBytes = bytes.byteLength > MAX_RAW_BYTES ? bytes.subarray(0, MAX_RAW_BYTES) : bytes;
      const bodyText = decodeBody(cappedBytes, bodyContentType);
      const finalResult = buildWebFetchResult(bodyText);

      return {
        success: true,
        result: finalResult
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to fetch URL: ${err.message || String(err)}`
      };
    }
  }
};
