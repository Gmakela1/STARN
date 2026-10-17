import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolExecutionContext } from '../src/tools/types.js';

describe('web_fetch Tool Handler & SSRF Defense', () => {
  const registry = new ToolRegistry();
  const context: ToolExecutionContext = {
    projectPath: '/tmp/test',
    stateManager: {} as any
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks localhost and loopback IPv4', async () => {
    const res = await registry.execute(
      'web_fetch',
      { url: 'http://127.0.0.1:8080/secret' },
      context,
      ['web_fetch']
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/private or restricted IP/i);

    const res2 = await registry.execute(
      'web_fetch',
      { url: 'http://localhost:3000/api' },
      context,
      ['web_fetch']
    );
    expect(res2.success).toBe(false);
    expect(res2.error).toMatch(/private or restricted IP/i);
  });

  it('blocks RFC1918 private subnets and cloud metadata', async () => {
    const urls = [
      'http://10.0.0.1/admin',
      'http://192.168.1.1/router',
      'http://172.16.0.5/internal',
      'http://169.254.169.254/latest/meta-data'
    ];

    for (const url of urls) {
      const res = await registry.execute('web_fetch', { url }, context, ['web_fetch']);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/private or restricted IP/i);
    }
  });

  it('blocks non-http protocols (file://, ftp://, gopher://)', async () => {
    const res = await registry.execute(
      'web_fetch',
      { url: 'file:///etc/passwd' },
      context,
      ['web_fetch']
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/only http and https/i);
  });

  it('extracts clean text from valid HTML response and strips scripts/styles', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Kelly Controller Specs</title>
          <style>.hide { display: none; }</style>
          <script>alert('malicious')</script>
        </head>
        <body>
          <h1>Kelly KLS7245N</h1>
          <p>The Kelly KLS7245N is a <strong>72V 450A</strong> programmable sinusoidal controller.</p>
          <ul>
            <li>Nominal Voltage: 72V</li>
            <li>Peak Current: 450A</li>
          </ul>
        </body>
      </html>
    `;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => mockHtml
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await registry.execute(
      'web_fetch',
      { url: 'https://example.com/kelly-manual' },
      context,
      ['web_fetch']
    );

    expect(res.success).toBe(true);
    expect(res.result).toContain('Kelly KLS7245N');
    expect(res.result).toContain('72V 450A');
    expect(res.result).toContain('Nominal Voltage: 72V');
    expect(res.result).not.toContain('<script>');
    expect(res.result).not.toContain('malicious');
    expect(res.result).not.toContain('display: none');
  });
});
