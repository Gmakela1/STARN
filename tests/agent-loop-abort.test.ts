import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAgentToolLoop } from '../src/core/agent-loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('runAgentToolLoop abort', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-loop-abort-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('test', 'Test');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns { aborted: true } when the signal aborts mid-flight', async () => {
    const controller = new AbortController();
    const mockClient = {
      chatCompletion: vi.fn(async (opts: any) => {
        return new Promise((_resolve, reject) => {
          if (opts.signal?.aborted) {
            const e = new Error('aborted');
            e.name = 'AbortError';
            return reject(e);
          }
          opts.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        });
      })
    } as any;

    const loopPromise = runAgentToolLoop({
      client: mockClient,
      model: 'test',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolRegistry: new ToolRegistry(),
      allowedTools: [],
      context: { projectPath: tempDir, stateManager: stateMgr },
      signal: controller.signal
    });

    // Abort mid-flight (the in-flight chatCompletion is pending).
    controller.abort();

    const result = await loopPromise;

    expect(result.aborted).toBe(true);
    expect(result.finalResponse).toBe('');
  });

  it('returns aborted when the signal is already aborted before the first call', async () => {
    const controller = new AbortController();
    controller.abort();

    const mockClient = {
      chatCompletion: vi.fn(async (opts: any) => {
        if (opts.signal?.aborted) {
          const e = new Error('aborted');
          e.name = 'AbortError';
          throw e;
        }
        return { content: 'ok', toolCalls: [] };
      })
    } as any;

    const result = await runAgentToolLoop({
      client: mockClient,
      model: 'test',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolRegistry: new ToolRegistry(),
      allowedTools: [],
      context: { projectPath: tempDir, stateManager: stateMgr },
      signal: controller.signal
    });

    expect(result.aborted).toBe(true);
    expect(result.finalResponse).toBe('');
  });
});
