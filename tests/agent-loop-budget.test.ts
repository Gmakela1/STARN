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

/** Default research-path convergence directive text used by the tests below. */
const CONVERGENCE_MESSAGE = 'Turn budget nearly exhausted. Stop searching now.';

/** Snapshot of one call's message list (the loop mutates `messages` in place). */
function snapshot(o: any): Array<{ role: string; content: string }> {
  return o.messages.map((m: any) => ({ role: String(m.role), content: String(m.content) }));
}

function countDirective(msgs: Array<{ role: string; content: string }>): number {
  return msgs.filter(m => m.content === CONVERGENCE_MESSAGE).length;
}

describe('runAgentToolLoop convergence directive', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-loop-converge-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('injects the directive exactly once, first visible at turn 7 of 10 (not 6, not 8)', async () => {
    const ctx = makeCtx(tempDir);
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        seen.push(snapshot(o));
        // Turns 1..8 keep tool-calling; turn 9 replies in plain text.
        if (seen.length <= 8) return toolCallTurn('t' + seen.length);
        return { content: '# Answer\n\nDone.', toolCalls: [] };
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
      maxTurns: 10,
      convergenceDirective: { atTurnFraction: 0.7, message: CONVERGENCE_MESSAGE }
    });

    expect(seen).toHaveLength(9);
    // Turn 6 (index 5): not yet. Turn 7 (index 6): injected. Turn 8 (index 7): still one only.
    expect(countDirective(seen[5])).toBe(0);
    expect(countDirective(seen[6])).toBe(1);
    expect(countDirective(seen[7])).toBe(1);
    // Injected ONCE per loop: never present twice in any single request.
    for (const msgs of seen) expect(countDirective(msgs)).toBeLessThanOrEqual(1);
    // It is a user-role message, and it is not the initial user message.
    const injected = seen[6].filter(m => m.content === CONVERGENCE_MESSAGE);
    expect(injected[0].role).toBe('user');
    expect(seen[6].filter(m => m.role === 'user')).toHaveLength(2);
  });

  it('injects nothing when no directive is configured (drafting loops)', async () => {
    const ctx = makeCtx(tempDir);
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        seen.push(snapshot(o));
        if (seen.length <= 8) return toolCallTurn('t' + seen.length);
        return { content: '# Draft\n\nDone.', toolCalls: [] };
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
      maxTurns: 10
    });

    expect(seen).toHaveLength(9);
    for (const msgs of seen) {
      expect(countDirective(msgs)).toBe(0);
      // Only the initial user message ever appears in that role.
      expect(msgs.filter(m => m.role === 'user')).toHaveLength(1);
    }
  });

  it('never injects the directive when the loop ends before the threshold', async () => {
    const ctx = makeCtx(tempDir);
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        seen.push(snapshot(o));
        // Turn 1 tool-calls, turn 2 replies in plain text — well before turn 7.
        if (seen.length === 1) return toolCallTurn('t1');
        return { content: '# Early\n\nDone.', toolCalls: [] };
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
      maxTurns: 10,
      convergenceDirective: { atTurnFraction: 0.7, message: CONVERGENCE_MESSAGE }
    });

    expect(result.finalResponse).toBe('# Early\n\nDone.');
    expect(seen).toHaveLength(2);
    for (const msgs of seen) expect(countDirective(msgs)).toBe(0);
  });
});

describe('runAgentToolLoop wall-clock nudge', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-loop-wallclock-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const NUDGE = 'Wall-clock budget nearly spent. Stop searching NOW.';

  it('injects the nudge exactly once once the clock fraction is spent', async () => {
    const ctx = makeCtx(tempDir);
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        seen.push(snapshot(o));
        if (seen.length === 1) return toolCallTurn('t1');
        return { content: '# Done\n\nReply.', toolCalls: [] };
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
      maxTurns: 10,
      // atFraction 0 = the deadline has already passed on turn 1.
      wallClockNudge: { budgetMs: 1000, atFraction: 0, message: NUDGE }
    });

    const count = (msgs: Array<{ role: string; content: string }>) => msgs.filter(m => m.content === NUDGE).length;
    expect(seen).toHaveLength(2);
    expect(count(seen[0])).toBe(1);
    // Injected ONCE per loop, not once per turn.
    expect(count(seen[1])).toBe(1);
  });

  it('never injects the nudge while the clock budget is intact', async () => {
    const ctx = makeCtx(tempDir);
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        seen.push(snapshot(o));
        if (seen.length === 1) return toolCallTurn('t1');
        return { content: '# Done\n\nReply.', toolCalls: [] };
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
      maxTurns: 10,
      wallClockNudge: { budgetMs: 10_000_000, atFraction: 0.65, message: NUDGE }
    });

    for (const msgs of seen) expect(msgs.some(m => m.content === NUDGE)).toBe(false);
  });

  it('injects ONE message stating BOTH facts when the convergence turn and the spent clock fire together', async () => {
    const ctx = makeCtx(tempDir);
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        seen.push(snapshot(o));
        if (seen.length === 1) return toolCallTurn('t1');
        return { content: '# Done\n\nReply.', toolCalls: [] };
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
      maxTurns: 10,
      // Both thresholds are met on turn 1: convergence at ceil(10 * 0.1) = 1,
      // and atFraction 0 means the clock deadline has already passed.
      convergenceDirective: { atTurnFraction: 0.1, message: CONVERGENCE_MESSAGE },
      wallClockNudge: { budgetMs: 1000, atFraction: 0, message: NUDGE }
    });

    // ONE urgency message, carrying BOTH facts — the clock (the harder
    // deadline) first, then the turn budget. Neither fact is dropped.
    const urgency = (msgs: Array<{ role: string; content: string }>) =>
      msgs.filter(m => m.content !== 'hi' && m.content.includes('Stop searching'));
    expect(seen).toHaveLength(2);
    expect(urgency(seen[0])).toHaveLength(1);
    expect(urgency(seen[0])[0].content).toBe(`${NUDGE} ${CONVERGENCE_MESSAGE}`);
    expect(urgency(seen[0])[0].content).toContain(NUDGE);
    expect(urgency(seen[0])[0].content).toContain(CONVERGENCE_MESSAGE);
    expect(urgency(seen[0])[0].role).toBe('user');
    // Still exactly one: the clock firing again on turn 2 adds nothing.
    expect(urgency(seen[1])).toHaveLength(1);
    expect(urgency(seen[1])[0].content).toBe(`${NUDGE} ${CONVERGENCE_MESSAGE}`);
  });

  it('injects the clock nudge alone when the clock is spent but the turn budget is not', async () => {
    const ctx = makeCtx(tempDir);
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const mockClient = {
      chatCompletion: vi.fn(async (o: any) => {
        seen.push(snapshot(o));
        if (seen.length <= 2) return toolCallTurn('t' + seen.length);
        return { content: '# Done\n\nReply.', toolCalls: [] };
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
      maxTurns: 10,
      // Convergence only at turn 9; the clock is already spent at turn 1.
      convergenceDirective: { atTurnFraction: 0.9, message: CONVERGENCE_MESSAGE },
      wallClockNudge: { budgetMs: 1000, atFraction: 0, message: NUDGE }
    });

    expect(seen).toHaveLength(3);
    expect(seen[0].filter(m => m.content === NUDGE)).toHaveLength(1);
    // The clock message is NOT joined to a turn fact that is not due yet.
    expect(seen[0].some(m => m.content.includes(CONVERGENCE_MESSAGE))).toBe(false);
  });
});

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

describe('runAgentToolLoop abort return shape', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-loop-abort-shape-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** A client whose call rejects with AbortError once the signal fires. */
  function abortableClient() {
    return {
      chatCompletion: vi.fn(async (o: any) => {
        return new Promise((_resolve, reject) => {
          if (o.signal?.aborted) {
            const e = new Error('aborted');
            e.name = 'AbortError';
            return reject(e);
          }
          o.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        });
      })
    } as any;
  }

  it('pre-abort return carries the same fields as an in-flight abort return', async () => {
    const ctx = makeCtx(tempDir);

    const preController = new AbortController();
    preController.abort();
    const preAbort = await runAgentToolLoop({
      client: abortableClient(),
      model: 'test',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolRegistry: new ToolRegistry(),
      allowedTools: [],
      context: ctx,
      signal: preController.signal
    });

    const midController = new AbortController();
    const midFlight = runAgentToolLoop({
      client: abortableClient(),
      model: 'test',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolRegistry: new ToolRegistry(),
      allowedTools: [],
      context: ctx,
      signal: midController.signal
    });
    midController.abort();
    const midAbort = await midFlight;

    expect(preAbort).toEqual({
      finalResponse: '',
      messages: expect.any(Array),
      aborted: true,
      toolCallCount: 0,
      turnsUsed: 0
    });
    expect(midAbort.aborted).toBe(true);
    expect(Object.keys(preAbort).sort()).toEqual(Object.keys(midAbort).sort());
  });
});
