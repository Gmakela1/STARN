import { describe, it, expect, vi } from 'vitest';
import { runAgentToolLoop } from '../src/core/agent-loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Budget-exhaustion behavior of runAgentToolLoop: default budget of 8 turns is
 * unchanged, and when the budget runs out while the model was still tool-calling
 * the loop makes ONE final model call with tools disabled ("forced final write")
 * and adopts its reply as finalResponse only when it contains a # heading.
 */

function makeCtx(dir: string): { projectPath: string; stateManager: ProjectStateManager } {
  return { projectPath: dir, stateManager: new ProjectStateManager(dir) };
}

function toolCallTurn(id: string) {
  return {
    content: '',
    toolCalls: [{ id, type: 'function', function: { name: 'no_such_tool', arguments: '{}' } }]
  };
}

describe('runAgentToolLoop budget and forced final write', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-loop-budget-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('default budget stays 8 turns, then one forced no-tools rescue call', async () => {
    const ctx = makeCtx(tempDir);
    const calls: any[] = [];
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        calls.push(o);
        // Turns 1..8: keep tool-calling. Turn 9 is the forced final write.
        if (calls.length <= 8) return toolCallTurn('t' + calls.length);
        return { content: '# Rescue Document\n\nDelivered.', toolCalls: [] };
      })
    } as any;

    const result = await runAgentToolLoop({
      client: mockClient,
      model: 'test',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolRegistry: new ToolRegistry(),
      allowedTools: [],
      context: ctx
    });

    expect(calls).toHaveLength(9);
    // The rescue call must NOT pass tools (tools disabled, no tool executor).
    expect(calls[8].tools).toBeUndefined();
    const rescueMsgs = calls[8].messages.map((m: any) => String(m.content));
    expect(rescueMsgs.some((c: string) => c.includes('Stop using tools'))).toBe(true);
    expect(result.finalResponse).toContain('# Rescue Document');
    expect(result.turnsUsed).toBe(8);
    expect(result.toolCallCount).toBe(8);
  });

  it('forced final write does NOT fire when the loop ends normally', async () => {
    const ctx = makeCtx(tempDir);
    const mockClient = {
      chatCompletion: vi.fn(async () => ({ content: '# Done\n\nReply text.', toolCalls: [] }))
    } as any;

    const result = await runAgentToolLoop({
      client: mockClient,
      model: 'test',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolRegistry: new ToolRegistry(),
      allowedTools: [],
      context: ctx,
      maxTurns: 4
    });

    expect(mockClient.chatCompletion).toHaveBeenCalledTimes(1);
    expect(result.finalResponse).toBe('# Done\n\nReply text.');
    expect(result.turnsUsed).toBe(1);
  });

  it('rescue reply without a # heading is NOT adopted as finalResponse', async () => {
    const ctx = makeCtx(tempDir);
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        const last = o.messages[o.messages.length - 1];
        if (typeof last.content === 'string' && last.content.includes('Stop using tools')) {
          return { content: 'Still just commentary, no heading.', toolCalls: [] };
        }
        return toolCallTurn('t1');
      })
    } as any;

    const result = await runAgentToolLoop({
      client: mockClient,
      model: 'test',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolRegistry: new ToolRegistry(),
      allowedTools: [],
      context: ctx,
      maxTurns: 1
    });

    expect(result.finalResponse).toBe('');
    expect(mockClient.chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('rescue reply with only a mid-sentence # marker is NOT adopted', async () => {
    const ctx = makeCtx(tempDir);
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        const last = o.messages[o.messages.length - 1];
        if (typeof last.content === 'string' && last.content.includes('Stop using tools')) {
          // '# ' appears mid-sentence, not as a line-start heading.
          return { content: 'Plan item 1: do the thing # 2 next. No heading here.', toolCalls: [] };
        }
        return toolCallTurn('t1');
      })
    } as any;

    const result = await runAgentToolLoop({
      client: mockClient,
      model: 'test',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolRegistry: new ToolRegistry(),
      allowedTools: [],
      context: ctx,
      maxTurns: 1
    });

    expect(result.finalResponse).toBe('');
    expect(mockClient.chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('rescue reply with a line-start # heading IS adopted', async () => {
    const ctx = makeCtx(tempDir);
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        const last = o.messages[o.messages.length - 1];
        if (typeof last.content === 'string' && last.content.includes('Stop using tools')) {
          // Leading heading wins even though '# ' also appears mid-sentence below.
          return { content: '# Headed Rescue\n\nA note about # 2 in prose.', toolCalls: [] };
        }
        return toolCallTurn('t1');
      })
    } as any;

    const result = await runAgentToolLoop({
      client: mockClient,
      model: 'test',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolRegistry: new ToolRegistry(),
      allowedTools: [],
      context: ctx,
      maxTurns: 1
    });

    expect(result.finalResponse).toBe('# Headed Rescue\n\nA note about # 2 in prose.');
    expect(mockClient.chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('logs a warn with turn count, toolCallCount and docId on budget exhaustion', async () => {
    const ctx = makeCtx(tempDir);
    const warn = vi.fn();
    const logger = { warn, info: vi.fn(), error: vi.fn() } as any;
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        const last = o.messages[o.messages.length - 1];
        if (typeof last.content === 'string' && last.content.includes('Stop using tools')) {
          return { content: '# Headed Rescue\n', toolCalls: [] };
        }
        return toolCallTurn('t1');
      })
    } as any;

    await runAgentToolLoop({
      client: mockClient,
      model: 'test',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolRegistry: new ToolRegistry(),
      allowedTools: [],
      context: ctx,
      maxTurns: 1,
      logger,
      docId: 'bom'
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('budget exhausted');
    expect(msg).toContain('bom');
    expect(msg).toContain('1/1 turns');
    expect(msg).toContain('1 tool calls');
  });
});
