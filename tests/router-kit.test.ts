import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { originMatchesHost, MUTATING_METHODS, ok, fail, sendJson } from '../src/server/routes/kit.js';

// Minimal ServerResponse stub capturing status/headers/body. ok/fail/sendJson
// write synchronously through writeHead + end, so the captures are valid
// immediately after each call.
function makeRes(): {
  res: http.ServerResponse;
  status: () => number;
  headers: () => Record<string, string>;
  body: () => string;
} {
  let statusCode = 0;
  let head: Record<string, string> = {};
  let buf = '';
  const res = {
    writeHead(code: number, h?: Record<string, string>): void {
      statusCode = code;
      if (h) head = { ...head, ...h };
    },
    end(chunk?: unknown): void {
      if (chunk !== undefined) buf += String(chunk);
    }
  } as unknown as http.ServerResponse;
  return { res, status: () => statusCode, headers: () => head, body: () => buf };
}

describe('originMatchesHost (CSRF loopback alias table)', () => {
  it('treats localhost / 127.0.0.1 / [::1] as the same loopback site', () => {
    expect(originMatchesHost('http://localhost', 'localhost')).toBe(true);
    expect(originMatchesHost('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(originMatchesHost('http://127.0.0.1:3000', 'localhost:3000')).toBe(true);
    expect(originMatchesHost('http://localhost', '127.0.0.1:3000')).toBe(true);
    expect(originMatchesHost('http://[::1]:3000', '127.0.0.1:3000')).toBe(true);
    expect(originMatchesHost('http://127.0.0.1', '[::1]:3000')).toBe(true);
  });

  it('rejects mismatched origins (fail closed)', () => {
    expect(originMatchesHost('http://evil.example', 'localhost:3000')).toBe(false);
    expect(originMatchesHost('http://localhost.evil.com', 'localhost:3000')).toBe(false);
    expect(originMatchesHost('http://127.0.0.1.evil.com', '127.0.0.1:3000')).toBe(false);
  });

  it('ignores ports and schemes for the same hostname (original loose-site semantics)', () => {
    expect(originMatchesHost('http://localhost:9000', 'localhost:3000')).toBe(true);
    expect(originMatchesHost('https://example.com', 'example.com')).toBe(true);
  });

  it('rejects unparseable origins and absent hosts', () => {
    expect(originMatchesHost('not a url', 'localhost:3000')).toBe(false);
    expect(originMatchesHost('http://localhost', undefined)).toBe(false);
    expect(originMatchesHost('http://localhost', '')).toBe(false);
  });

  it('is case-insensitive for hostnames', () => {
    expect(originMatchesHost('HTTP://LOCALHOST:3000', 'localhost:3000')).toBe(true);
  });
});

describe('MUTATING_METHODS membership', () => {
  it('contains the four browser-attached-Origin mutation methods', () => {
    expect(MUTATING_METHODS.has('POST')).toBe(true);
    expect(MUTATING_METHODS.has('PUT')).toBe(true);
    expect(MUTATING_METHODS.has('PATCH')).toBe(true);
    expect(MUTATING_METHODS.has('DELETE')).toBe(true);
  });

  it('excludes reads and non-mutators', () => {
    expect(MUTATING_METHODS.has('GET')).toBe(false);
    expect(MUTATING_METHODS.has('HEAD')).toBe(false);
    expect(MUTATING_METHODS.has('OPTIONS')).toBe(false);
  });
});

describe('response envelope builders', () => {
  it('ok writes 200 {success:true,data,error:null} with no-store JSON headers', () => {
    const { res, status, headers, body } = makeRes();
    ok(res, { projectId: 'p1', count: 2 });
    expect(status()).toBe(200);
    expect(headers()['Content-Type']).toBe('application/json');
    expect(headers()['Cache-Control']).toBe('no-store');
    expect(body()).toBe(JSON.stringify({ success: true, data: { projectId: 'p1', count: 2 }, error: null }));
  });

  it('fail writes the status code and {success:false,data:null,error} envelope', () => {
    const { res, status, body } = makeRes();
    fail(res, 404, 'Document not found');
    expect(status()).toBe(404);
    expect(body()).toBe(JSON.stringify({ success: false, data: null, error: 'Document not found' }));
  });

  it('sendJson emits arbitrary statuses and envelopes untouched', () => {
    const { res, status, body } = makeRes();
    sendJson(res, 202, { success: true, data: { queued: true }, error: null });
    expect(status()).toBe(202);
    expect(body()).toBe(JSON.stringify({ success: true, data: { queued: true }, error: null }));
    expect(body()).toContain('"queued":true');
  });
});