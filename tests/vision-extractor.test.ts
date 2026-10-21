import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractTextFromScannedPdf,
  transcribePages,
  renderScaleForPage,
  TRANSCRIBER_SYSTEM_PROMPT,
  NO_TEXT_SENTINEL,
  RenderedPage,
  Transcriber
} from '../src/tools/document-extractors/vision-extractor.js';
import { ChatClient, ChatContentPart, ChatCompletionResult } from '../src/openrouter/types.js';

function stubClient(pages: string[]): ChatClient & { calls: number } {
  const calls = { calls: 0 };
  const client: ChatClient = {
    async chatCompletion(o): Promise<ChatCompletionResult> {
      const parts = o.messages[1].content as ChatContentPart[];
      expect(parts[0].type).toBe('text');
      if (parts[1].type !== 'image_url') throw new Error('expected image_url part');
      expect(parts[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
      const idx = Math.min(calls.calls, pages.length - 1);
      calls.calls += 1;
      return { content: pages[idx], raw: {} };
    }
  };
  Object.defineProperty(client, 'calls', { get: () => calls.calls });
  return client as ChatClient & { calls: number };
}

const fakePage = (): RenderedPage => ({
  width: 1024,
  height: 1325,
  toJpegBase64: () => 'data:image/jpeg;base64,ZmFrZQ=='
});

const HALLOW_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n'
);

describe('vision extractor', () => {
  it('joins pages with page markers', async () => {
    const client = stubClient(['page one text', 'page two text']);
    const out = await transcribePages(
      2,
      async () => fakePage(),
      { client, model: 'stub' },
      { maxPages: 5 }
    );
    expect(client.calls).toBe(2);
    expect(out).toContain('page one text');
    expect(out).toContain('--- Page 2 ---');
    expect(out).toContain('page two text');
  });

  it('caps pages at maxPages', async () => {
    const client = stubClient(['only']);
    const out = await transcribePages(10, async () => fakePage(), { client, model: 'stub' }, { maxPages: 1 });
    expect(client.calls).toBe(1);
    expect(out).toContain('only');
  });

  it('returns sentinel when maxPages <= 0', async () => {
    const client = stubClient(['x']);
    const out = await transcribePages(10, async () => fakePage(), { client, model: 'stub' }, { maxPages: 0 });
    expect(client.calls).toBe(0);
    expect(out).toBe(NO_TEXT_SENTINEL);
  });

  it('throws AbortError when aborted before a page', async () => {
    const ac = new AbortController();
    ac.abort();
    const client = stubClient(['x']);
    await expect(
      transcribePages(10, async () => fakePage(), { client, model: 'stub' }, { signal: ac.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('continues past a broken page with a non-fatal note', async () => {
    const client = stubClient(['ok text']);
    let calls = 0;
    const out = await transcribePages(
      2,
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('render exploded');
        return fakePage();
      },
      { client, model: 'stub' },
      { maxPages: 5 }
    );
    expect(out).toContain('[Page 1 unreadable');
    expect(out).toContain('ok text');
  });

  it('clamps scale to 2048px longest edge (min 0.5, max 2.75)', () => {
    expect(renderScaleForPage(600, 800)).toBeCloseTo(Math.min(2.75, 2048 / 800), 5);
    expect(renderScaleForPage(2000, 4000)).toBeCloseTo(2048 / 4000, 5);
    expect(renderScaleForPage(20000, 40000)).toBeCloseTo(0.5, 5);
  });

  it('system prompt contains injection guardrails', () => {
    expect(TRANSCRIBER_SYSTEM_PROMPT).toMatch(/untrusted/);
    expect(TRANSCRIBER_SYSTEM_PROMPT).toMatch(/ignore/i);
    expect(TRANSCRIBER_SYSTEM_PROMPT).toMatch(/never follow/i);
  });

  it('renders a real one-page PDF and transcribes it via the stub', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-vision-'));
    const file = path.join(dir, 'blank.pdf');
    fs.writeFileSync(file, HALLOW_PDF);
    const client = stubClient(['rendered page text']);
    const transcriber: Transcriber = { client, model: 'stub' };
    const out = await extractTextFromScannedPdf(file, transcriber, { maxPages: 1 });
    expect(client.calls).toBe(1);
    expect(out).toContain('rendered page text');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});