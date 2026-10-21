import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { docTranscribeHandler } from '../src/tools/handlers/doc-transcribe.js';
import { ChatClient, ChatContentPart, ChatCompletionResult } from '../src/openrouter/types.js';

const ctx = (over: any = {}) => ({
  projectPath: os.tmpdir(),
  stateManager: {} as any,
  ...over
});

describe('doc_transcribe handler', () => {
  it('rejects path traversal', async () => {
    const res = await docTranscribeHandler.execute({ path: '../../etc/passwd' }, ctx());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/traversal|permitted/i);
  });

  it('errors clearly when no transcriber available', async () => {
    const file = path.join(os.tmpdir(), 'scanned.pdf');
    fs.writeFileSync(file, 'not a pdf');
    const res = await docTranscribeHandler.execute({ path: 'scanned.pdf' }, ctx());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not available|disabled/i);
    fs.unlinkSync(file);
  });

  it('returns transcription with header when transcriber present', async () => {
    const client: ChatClient & { calls: number } = (() => {
      const calls = { calls: 0 };
      const c: ChatClient = {
        async chatCompletion(o): Promise<ChatCompletionResult> {
          calls.calls += 1;
          const parts = o.messages[1].content as ChatContentPart[];
          if (parts[1].type !== 'image_url') throw new Error('no image');
          return { content: 'transcribed page', raw: {} };
        }
      };
      Object.defineProperty(c, 'calls', { get: () => calls.calls });
      return c as ChatClient & { calls: number };
    })();
    const file = path.join(os.tmpdir(), 'blank.pdf');
    fs.writeFileSync(file, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n');
    const res = await docTranscribeHandler.execute(
      { path: 'blank.pdf', maxPages: 1 },
      ctx({ transcriber: { client, model: 'stub' } })
    );
    expect(res.success).toBe(true);
    expect(res.result).toContain('Scanned document transcription');
    expect(res.result).toContain('transcribed page');
    fs.unlinkSync(file);
  });
});