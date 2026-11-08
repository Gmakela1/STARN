// Pure-function tests for web_fetch extraction (no network): structured data + full-document cleaning.
import { describe, it, expect } from 'vitest';
import {
  buildWebFetchResult,
  cleanHtmlText,
  extractStructuredData,
  formatStructuredData
} from '../src/tools/handlers/web-fetch.js';

function jsonLd(payload: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

/** Markup-only filler: adds bytes but no readable text, so the cap cannot hide the description. */
function filler(count: number, attrValue: string): string {
  return Array.from({ length: count }, () => `<div data-filler="${attrValue}"></div>`).join('');
}

describe('web_fetch extraction', () => {
  it('keeps early JSON-LD price and a description located ~100KB into the page', () => {
    const html = [
      '<html><head>',
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'MOTENERGY ME1115 Motor',
        sku: 'MOT-ME1115',
        offers: {
          price: '875.00',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock'
        }
      }),
      '</head><body>',
      filler(1600, 'x'.repeat(60)), // ~100 KB of attribute-only markup before the real description
      '<h1>Product description</h1>',
      '<p>The MOT-ME1115 delivers 12 KW Continuous output.</p>',
      '</body></html>'
    ].join('');

    expect(html.length).toBeGreaterThan(100 * 1024);

    const result = buildWebFetchResult(html);

    expect(result.startsWith('[structured data]')).toBe(true);
    expect(result).toContain('875');
    expect(result).toContain('InStock');
    expect(result).toContain('MOT-ME1115');
    expect(result).toContain('12 KW Continuous');
  });

  it('surfaces visible text after 60KB of leading inline CSS', () => {
    const css = `.a${'b'.repeat(10)}{color:#fff}`.repeat(2600); // ~60 KB
    const html = `<html><head><style>${css}</style></head><body><p>Visible datasheet text</p></body></html>`;

    expect(html.length).toBeGreaterThan(60 * 1024);

    const cleaned = cleanHtmlText(html);
    expect(cleaned).toContain('Visible datasheet text');
    expect(cleaned).not.toContain('color:#fff');
    expect(buildWebFetchResult(html)).toContain('Visible datasheet text');
  });

  it('does not throw on invalid JSON-LD and still returns readable text', () => {
    const html = [
      '<html><head>',
      '<script type="application/ld+json">{"@type":"Product","sku":"BROKEN",}</script>',
      '</head><body><p>Readable fallback text</p></body></html>'
    ].join('');

    expect(() => extractStructuredData(html)).not.toThrow();
    expect(extractStructuredData(html)).toEqual({});
    expect(buildWebFetchResult(html)).toBe('Readable fallback text');
  });

  it('emits no [structured data] block for an article without structured data', () => {
    const html = '<html><body><h1>Stepper motor theory</h1><p>Article body.</p></body></html>';

    const result = buildWebFetchResult(html);
    expect(result).not.toContain('[structured data]');
    expect(result).toContain('Stepper motor theory');
  });

  it('resolves price, sku and availability from an @graph shape', () => {
    const html = [
      '<html><head>',
      jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'EV Drives' },
          {
            '@type': 'Product',
            name: 'MOTENERGY ME1115/ME1917 Brushless DC Permanent Magnet Motor',
            sku: 'MOT-ME1115',
            brand: { '@type': 'Brand', name: 'MOTENERGY' },
            description: '12 KW Continuous output brushless DC motor.',
            offers: [
              {
                '@type': 'Offer',
                price: 875.0,
                priceCurrency: 'USD',
                availability: 'https://schema.org/InStock'
              }
            ]
          }
        ]
      }),
      '</head><body><p>Body</p></body></html>'
    ].join('');

    const data = extractStructuredData(html);
    expect(data.price).toBe('875');
    expect(data.currency).toBe('USD');
    expect(data.sku).toBe('MOT-ME1115');
    expect(data.availability).toBe('InStock');
    expect(data.brand).toBe('MOTENERGY');

    const block = formatStructuredData(data);
    expect(block).toContain('price: 875 USD');
    expect(block).toContain('availability: InStock');
  });

  it('falls back to Open Graph / product meta tags when JSON-LD is absent', () => {
    const html = [
      '<html><head>',
      '<meta property="og:title" content="Widget &amp; Co Motor">',
      '<meta property="og:description" content="Meta description text">',
      '<meta property="product:price:amount" content="42.50">',
      '</head><body><p>Body</p></body></html>'
    ].join('');

    const data = extractStructuredData(html);
    expect(data.name).toBe('Widget & Co Motor');
    expect(data.description).toBe('Meta description text');
    expect(data.price).toBe('42.50');
    expect(buildWebFetchResult(html).startsWith('[structured data]')).toBe(true);
  });
});
