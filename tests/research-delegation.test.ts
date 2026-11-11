/**
 * Unit tests for the research delegation runner (src/core/research-delegation.ts):
 * band mapping, the successful result shape, the three failure mappings, the
 * optional decision-block extraction, the focus-line prefix, and the ONE
 * focused retry when the critic names a gap. Stub clients only — no network,
 * no state writes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../src/workspace/state.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ChatCompletionResult } from '../src/openrouter/types.js';
import { ResearchGateDeps } from '../src/core/research-gate.js';
import { runResearchDelegation, runResearchDelegationWithTimeout, toBand, RESEARCH_RETRY_BUDGET_MS } from '../src/core/research-delegation.js';

function chat(content: string): ChatCompletionResult {
  return { content, raw: {} } as ChatCompletionResult;
}

/** Research-turn reply in the strict JSON shape the gate prompt demands. */
function researchReply(answer: string): string {
  return JSON.stringify({
    answer,
    sources: [{ title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' }],
    reasoning: 'Stated verbatim in the datasheet.'
  });
}

/** Critic reply in the strict JSON shape the research rubric demands. */
function criticReply(confidence: number): string {
  return JSON.stringify({
    confidence,
    corroborated: true,
    verdict: 'propose',
    rationale: 'Vendor datasheet, stated verbatim.'
  });
}

/** Critic reply with an explicit rationale (the gap text a retry focuses on). */
function criticReplyWith(rationale: string, confidence: number): string {
  return JSON.stringify({ confidence, corroborated: true, verdict: 'propose', rationale });
}

/** Research reply with an explicit source list, for merged-source assertions. */
function researchReplyWith(answer: string, sources: { title: string; url?: string }[]): string {
  return JSON.stringify({ answer, sources, reasoning: 'Stated verbatim in the datasheet.' });
}

/** Captured INFO lines, so the retry/skip audit lines can be asserted exactly. */
function capturingLogger(): { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** INFO lines whose message starts with `prefix`. */
function lines(logger: { info: ReturnType<typeof vi.fn> }, prefix: string): string[] {
  return logger.info.mock.calls.map(([message]) => String(message)).filter(message => message.startsWith(prefix));
}

const PLAIN_ANSWER = 'The main contactor is rated 48V DC.';

/** One model turn that issues the given tool calls. */
function toolCallTurn(calls: { id: string; name: string; args?: any }[]): ChatCompletionResult {
  return {
    content: '',
    toolCalls: calls.map(call => ({
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) }
    })),
    raw: {}
  } as ChatCompletionResult;
}

/**
 * Registry carrying stub tool handlers, so an aborted loop's transcript holds
 * real tool rows without touching the filesystem or the network.
 *
 * @param handlers - tool name plus the stub `execute` to run
 * @returns the registry the research loop executes against
 */
function stubRegistry(handlers: { name: string; execute: (args: any) => Promise<any> }[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const handler of handlers) {
    registry.register({
      name: handler.name,
      definition: { type: 'function', function: { name: handler.name, description: handler.name, parameters: {} } },
      execute: handler.execute
    } as any);
  }
  return registry;
}

const ANSWER_WITH_OPTIONS = `${PLAIN_ANSWER}\n\nAlternatives:\nA) 48V — stock item\nB) 24V — cheaper\nRecommended: A`;

describe('research delegation', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-research-delegation-'));
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('p1', 'Research Delegation Test');
    registry = new ToolRegistry();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeDeps(overrides: Partial<ResearchGateDeps> = {}): ResearchGateDeps {
    return {
      client: { chatCompletion: vi.fn(async () => chat(researchReply(PLAIN_ANSWER))) } as any,
      model: 'research-model',
      criticClient: { chatCompletion: vi.fn(async () => chat(criticReply(0.62))) } as any,
      criticModel: 'critic-model',
      projectPath: tmpDir,
      stateManager: stateMgr,
      toolRegistry: registry,
      applyAnswer: async () => {
        throw new Error('delegation must never apply answers');
      },
      verifySource: async () => ({ ok: true, excerpt: 'Manufacturer datasheet: contactor rated 48V DC.' }),
      ...overrides
    };
  }

  it('toBand: 0.85 high, 0.849 medium, 0.3 medium, 0.299 low, 0 low, 1 high', () => {
    expect(toBand(0.85)).toBe('high');
    expect(toBand(0.849)).toBe('medium');
    expect(toBand(0.3)).toBe('medium');
    expect(toBand(0.299)).toBe('low');
    expect(toBand(0)).toBe('low');
    expect(toBand(1)).toBe('high');
  });

  it('successful delegation returns answer, sources, confidence, band and reasoning', async () => {
    const result = await runResearchDelegation(makeDeps(), { question: 'What is the contactor rating?' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer).toContain('48V');
    expect(result.sources).toEqual([{ title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' }]);
    expect(result.confidence).toBe(0.62);
    expect(result.band).toBe('medium');
    expect(result.reasoning).toContain('Vendor datasheet');
    // A completed pass is not a salvaged one.
    expect(result.partial).toBeUndefined();
  });

  it('AbortError is mapped to reason timeout, never re-thrown', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const deps = makeDeps({ criticClient: { chatCompletion: vi.fn(async () => { throw abort; }) } as any });

    const result = await runResearchDelegation(deps, { question: 'What is the contactor rating?' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
    expect(result.detail).toBe('aborted');
  });

  it('an answer-less research turn is mapped to reason unverified', async () => {
    const deps = makeDeps({ client: { chatCompletion: vi.fn(async () => chat('I could not find a source.')) } as any });

    const result = await runResearchDelegation(deps, { question: 'What is the contactor rating?' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unverified');
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it('any other throw is mapped to reason error with the message as detail', async () => {
    const deps = makeDeps({
      stateManager: {
        getState: () => {
          throw new Error('state unavailable');
        }
      } as any
    });

    const result = await runResearchDelegation(deps, { question: 'What is the contactor rating?' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('error');
    expect(result.detail).toBe('state unavailable');
  });

  it('options carries the Alternatives: block when present, undefined otherwise', async () => {
    const withOptions = await runResearchDelegation(
      makeDeps({ client: { chatCompletion: vi.fn(async () => chat(researchReply(ANSWER_WITH_OPTIONS))) } as any }),
      { question: 'Which contactor?' }
    );
    expect(withOptions.ok).toBe(true);
    if (!withOptions.ok) return;
    expect(withOptions.options).toContain('A) 48V');
    expect(withOptions.options).toContain('Recommended: A');

    const withoutOptions = await runResearchDelegation(makeDeps(), { question: 'Which contactor?' });
    expect(withoutOptions.ok).toBe(true);
    if (!withoutOptions.ok) return;
    expect(withoutOptions.options).toBeUndefined();

    // A pure verification answer ends with the literal `Alternatives: none`.
    const noneOptions = await runResearchDelegation(
      makeDeps({ client: { chatCompletion: vi.fn(async () => chat(researchReply(`${PLAIN_ANSWER}\n\nAlternatives: none`))) } as any }),
      { question: 'Which contactor?' }
    );
    expect(noneOptions.ok).toBe(true);
    if (!noneOptions.ok) return;
    expect(noneOptions.options).toBeUndefined();
  });

  it('options stops at a trailing Implications: line instead of swallowing it', async () => {
    const answer = `${PLAIN_ANSWER}\n\nAlternatives:\nA) 48V — stock item\nB) 24V — cheaper\nRecommended: A\n\nImplications: the 48 V harness stays as baselined.`;
    const result = await runResearchDelegation(
      makeDeps({ client: { chatCompletion: vi.fn(async () => chat(researchReply(answer))) } as any }),
      { question: 'Which contactor?' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toContain('A) 48V');
    expect(result.options).toContain('Recommended: A');
    expect(result.options).not.toContain('Implications');
  });

  it('options stops at a trailing markdown heading after the option list', async () => {
    const answer = `${PLAIN_ANSWER}\n\nAlternatives:\nA) 48V — stock item\nB) 24V — cheaper\nRecommended: A\n\n## Implications for the baseline\nThe 48 V harness stays.`;
    const result = await runResearchDelegation(
      makeDeps({ client: { chatCompletion: vi.fn(async () => chat(researchReply(answer))) } as any }),
      { question: 'Which contactor?' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toBe('A) 48V — stock item\nB) 24V — cheaper\nRecommended: A');
  });

  it('options keeps an option line that starts with a hash-digit, which is not a heading', async () => {
    const answer = `${PLAIN_ANSWER}\n\nAlternatives:\nA) 48V — stock item\n  #1 priority: harness cost\nB) 24V — cheaper\nRecommended: A`;
    const result = await runResearchDelegation(
      makeDeps({ client: { chatCompletion: vi.fn(async () => chat(researchReply(answer))) } as any }),
      { question: 'Which contactor?' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `#1` needs no space after the hash, so it is text inside the block, not a
    // section boundary — the block must run to the end of the answer.
    expect(result.options).toContain('#1 priority: harness cost');
    expect(result.options).toContain('Recommended: A');
  });

  it('focus prefixes the question with one Focus files: line', async () => {
    const deps = makeDeps();
    await runResearchDelegation(deps, {
      question: 'What is the contactor rating?',
      focus: ['reference/a.pdf', 'docs/b.md']
    });

    const call = (deps.client.chatCompletion as any).mock.calls[0][0];
    const userMessage = String(call.messages.find((m: any) => m.role === 'user').content);
    expect(userMessage).toContain('QUESTION: Focus files: reference/a.pdf, docs/b.md\nWhat is the contactor rating?');
  });

  it('no focus line is added when focus is absent', async () => {
    const deps = makeDeps();
    await runResearchDelegation(deps, { question: 'What is the contactor rating?' });

    const call = (deps.client.chatCompletion as any).mock.calls[0][0];
    const userMessage = String(call.messages.find((m: any) => m.role === 'user').content);
    expect(userMessage).toContain('QUESTION: What is the contactor rating?');
    expect(userMessage).not.toContain('Focus files:');
  });

  it('an aborted pass returns partial findings with the chart row first', async () => {
    const registry = stubRegistry([
      { name: 'web_search', execute: async () => ({ success: true, result: 'Search hits: ME1115 performance curve (vendor).' }) },
      {
        name: 'read_chart_data',
        execute: async () => ({
          success: true,
          result: '**Charts — reference/me1115.pdf, page 4**\n\n| x | Eff. | Watts Out |\n|---|---|---|\n| 100 | 0.88 | 7400 |'
        })
      }
    ]);
    let call = 0;
    const deps = makeDeps({
      toolRegistry: registry,
      client: {
        chatCompletion: vi.fn(async () => {
          if (call++ === 0) {
            return toolCallTurn([
              { id: 'call-1', name: 'web_search', args: { query: 'ME1115 curve' } },
              { id: 'call-2', name: 'read_chart_data', args: { path: 'reference/me1115.pdf' } }
            ]);
          }
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        })
      } as any
    });

    const result = await runResearchDelegation(deps, { question: 'What is the efficiency at 100 A?' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
    expect(result.partial).toBe(true);
    const findings = result.findings ?? '';
    expect(findings).toContain('[read_chart_data]');
    expect(findings).toContain('[web_search]');
    // The chart row carries sampled values, so it leads the digest.
    expect(findings.indexOf('[read_chart_data]')).toBeLessThan(findings.indexOf('[web_search]'));
    expect(findings).toContain('| 100 | 0.88 | 7400 |');
  });

  it('an aborted pass with no successful tool row carries no findings', async () => {
    const registry = stubRegistry([
      { name: 'web_fetch', execute: async () => ({ success: false, error: 'socket hang up' }) },
      { name: 'read_chart_data', execute: async () => ({ success: true, result: 'Refusal: non-monotonic left y axis labels' }) }
    ]);
    let call = 0;
    const deps = makeDeps({
      toolRegistry: registry,
      client: {
        chatCompletion: vi.fn(async () => {
          if (call++ === 0) {
            return toolCallTurn([
              { id: 'call-1', name: 'web_fetch', args: { url: 'https://vendor.example/ds.pdf' } },
              { id: 'call-2', name: 'read_chart_data', args: { path: 'reference/me1115.pdf' } }
            ]);
          }
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        })
      } as any
    });

    const result = await runResearchDelegation(deps, { question: 'What is the rating?' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
    expect(result.partial).toBe(true);
    expect(result.findings).toBeUndefined();
  });

  it('caps salvaged findings at 6000 characters', async () => {
    const registry = stubRegistry([
      {
        name: 'read_chart_data',
        execute: async (args: any) => ({ success: true, result: `chart ${args.path}\n${'z'.repeat(2000)}` })
      }
    ]);
    const calls = Array.from({ length: 6 }, (_, index) => ({
      id: `call-${index}`,
      name: 'read_chart_data',
      args: { path: `reference/p${index}.pdf` }
    }));
    let call = 0;
    const deps = makeDeps({
      toolRegistry: registry,
      client: {
        chatCompletion: vi.fn(async () => {
          if (call++ === 0) return toolCallTurn(calls);
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        })
      } as any
    });

    const result = await runResearchDelegation(deps, { question: 'Curve values?' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const findings = result.findings ?? '';
    expect(findings.length).toBeGreaterThan(5000);
    expect(findings.length).toBeLessThanOrEqual(6000);
  });

  it('runResearchDelegationWithTimeout keeps salvaged findings when the budget fires', async () => {
    const registry = stubRegistry([
      {
        name: 'read_chart_data',
        execute: async () => ({ success: true, result: '| x | Watts Out |\n|---|---|\n| 100 | 7400 |' })
      }
    ]);
    let call = 0;
    const deps = makeDeps({
      toolRegistry: registry,
      client: {
        chatCompletion: vi.fn((opts: any) => {
          if (call++ === 0) {
            return Promise.resolve(toolCallTurn([{ id: 'call-1', name: 'read_chart_data', args: { path: 'reference/me1115.pdf' } }]));
          }
          // Honour the budget signal like a real client: reject on abort.
          return new Promise((_resolve, reject) => {
            opts.signal?.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              { once: true }
            );
          });
        })
      } as any
    });

    const result = await runResearchDelegationWithTimeout(deps, { question: 'Efficiency at 100 A?' }, 20);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
    expect(result.detail).toBe('0.02s');
    expect(result.partial).toBe(true);
    expect(result.findings).toContain('| 100 | 7400 |');
  });

  it('runResearchDelegationWithTimeout keeps a grace-window run\'s OWN reason instead of a bare timeout', async () => {
    // The client ignores the abort signal and settles ~40 ms into the grace
    // window with no usable answer: the real reason ('unverified') must survive.
    const deps = makeDeps({
      client: {
        chatCompletion: vi.fn(
          () => new Promise<ChatCompletionResult>(resolve => setTimeout(() => resolve(chat('I found nothing usable.')), 60))
        )
      } as any
    });

    const result = await runResearchDelegationWithTimeout(deps, { question: 'What is the contactor rating?' }, 20);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unverified');
    expect(result.detail).not.toBe('0.02s');
  });

  it('runResearchDelegationWithTimeout: a run that never settles hits the budget and aborts the signal', async () => {
    let seenSignal: AbortSignal | undefined;
    const deps = makeDeps({
      client: {
        chatCompletion: vi.fn((opts: any) => {
          seenSignal = opts?.signal;
          return new Promise(() => { /* never settles */ });
        })
      } as any
    });

    const result = await runResearchDelegationWithTimeout(deps, { question: 'What is the contactor rating?' }, 20);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
    expect(result.detail).toBe('0.02s');
    // The budget is an AbortController wired to deps.signal, so the abandoned
    // research loop is actually cancelled rather than left running.
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(true);
  });

  it('runResearchDelegationWithTimeout passes an un-aborted signal through to the delegation', async () => {
    let seenSignal: AbortSignal | undefined;
    const deps = makeDeps({
      criticClient: {
        chatCompletion: vi.fn(async (opts: any) => {
          seenSignal = opts?.signal;
          return chat(criticReply(0.62));
        })
      } as any
    });

    const result = await runResearchDelegationWithTimeout(deps, { question: 'What is the contactor rating?' });

    expect(result.ok).toBe(true);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(false);
  });

  it('runResearchDelegationWithTimeout: a caller abort ends the run without waiting out the budget', async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      signal: controller.signal,
      client: { chatCompletion: vi.fn(() => new Promise(() => { /* never settles */ })) } as any
    });
    setTimeout(() => controller.abort(), 10);
    const startedAt = Date.now();

    const result = await runResearchDelegationWithTimeout(
      deps,
      { question: 'What is the contactor rating?' },
      5000
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it('a named gap below the confidence cap runs ONE focused retry that keeps the better answer and merges sources', async () => {
    const logger = capturingLogger();
    let researchCall = 0;
    let criticCall = 0;
    const deps = makeDeps({
      logger: logger as any,
      client: {
        chatCompletion: vi.fn(async () =>
          chat(
            researchCall++ === 0
              ? researchReplyWith(PLAIN_ANSWER, [{ title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' }])
              : researchReplyWith(`${PLAIN_ANSWER} Independently confirmed by the second datasheet.`, [
                  { title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' },
                  { title: 'Agency listing', url: 'https://agency.example/listing' }
                ])
          )
        )
      } as any,
      criticClient: {
        chatCompletion: vi.fn(async () =>
          chat(
            criticCall++ === 0
              ? criticReplyWith('Only one source states the rating; a second independent source is missing.', 0.7)
              : criticReplyWith('Two independent sources agree on the rating.', 0.88)
          )
        )
      } as any
    });

    const result = await runResearchDelegation(deps, { question: 'What is the contactor rating?' });

    expect(researchCall).toBe(2);
    expect(criticCall).toBe(2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.88);
    expect(result.band).toBe('high');
    expect(result.answer).toContain('Independently confirmed');
    expect(result.sources).toEqual([
      { title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' },
      { title: 'Agency listing', url: 'https://agency.example/listing' }
    ]);
    const retryLines = lines(logger, 'Research retry:');
    expect(retryLines).toHaveLength(1);
    expect(retryLines[0]).toBe(
      'Research retry: confidence=0.70 gap=named retryConfidence=0.88 outcome=kept-retry'
    );
  });

  it('an empty or generic rationale runs no retry', async () => {
    const emptyClient = { chatCompletion: vi.fn(async () => chat(researchReply(PLAIN_ANSWER))) } as any;
    const empty = await runResearchDelegation(
      makeDeps({ client: emptyClient, criticClient: { chatCompletion: vi.fn(async () => chat(criticReplyWith('', 0.7))) } as any }),
      { question: 'What is the contactor rating?' }
    );
    expect(emptyClient.chatCompletion).toHaveBeenCalledTimes(1);
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.confidence).toBe(0.7);

    const genericClient = { chatCompletion: vi.fn(async () => chat(researchReply(PLAIN_ANSWER))) } as any;
    const generic = await runResearchDelegation(
      makeDeps({
        client: genericClient,
        criticClient: {
          chatCompletion: vi.fn(async () => chat(criticReplyWith('Vendor datasheet, stated verbatim; no conflicts found.', 0.7)))
        } as any
      }),
      { question: 'What is the contactor rating?' }
    );
    expect(genericClient.chatCompletion).toHaveBeenCalledTimes(1);
    expect(generic.ok).toBe(true);
  });

  it('never retries at or above the 0.85 confidence cap, even when a gap is named', async () => {
    const client = { chatCompletion: vi.fn(async () => chat(researchReply(PLAIN_ANSWER))) } as any;
    const result = await runResearchDelegation(
      makeDeps({
        client,
        criticClient: {
          chatCompletion: vi.fn(async () => chat(criticReplyWith('A second source is missing.', 0.95)))
        } as any
      }),
      { question: 'What is the contactor rating?' }
    );

    expect(client.chatCompletion).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.95);
  });

  it('a timed-out first pass with a salvaged digest earns the retry, and the better retry answer wins', async () => {
    const registry = stubRegistry([
      { name: 'web_search', execute: async () => ({ success: true, result: 'Search hits: ME1115 performance curve (vendor).' }) }
    ]);
    let researchCall = 0;
    const deps = makeDeps({
      toolRegistry: registry,
      client: {
        chatCompletion: vi.fn(async () => {
          const call = researchCall++;
          if (call === 0) return toolCallTurn([{ id: 'call-1', name: 'web_search', args: { query: 'ME1115 curve' } }]);
          if (call === 1) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          return chat(researchReply(PLAIN_ANSWER));
        })
      } as any,
      criticClient: { chatCompletion: vi.fn(async () => chat(criticReplyWith('Two independent sources agree.', 0.8))) } as any
    });

    const result = await runResearchDelegation(deps, { question: 'What is the efficiency at 100 A?' });

    expect(researchCall).toBe(3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.8);
    expect(result.answer).toContain('48V');
    // The retry question carries the salvaged tool output as its focus.
    const retryCall = (deps.client.chatCompletion as any).mock.calls[2][0];
    const retryPrompt = String(retryCall.messages.find((m: any) => m.role === 'user').content);
    expect(retryPrompt).toContain('Focus:');
    expect(retryPrompt).toContain('ME1115 performance curve');
  });

  it('a worse retry is discarded: the first answer is kept, sources merged, and no second retry runs', async () => {
    const logger = capturingLogger();
    let researchCall = 0;
    let criticCall = 0;
    const deps = makeDeps({
      logger: logger as any,
      client: {
        chatCompletion: vi.fn(async () =>
          chat(
            researchCall++ === 0
              ? researchReplyWith(PLAIN_ANSWER, [{ title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' }])
              : researchReplyWith('A weaker, unsourced restatement.', [
                  { title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' },
                  { title: 'Blog post', url: 'https://blog.example/ratings' }
                ])
          )
        )
      } as any,
      criticClient: {
        chatCompletion: vi.fn(async () =>
          chat(criticCall++ === 0 ? criticReplyWith('A second independent source is missing.', 0.7) : criticReplyWith('Still missing a second source.', 0.6))
        )
      } as any
    });

    const result = await runResearchDelegation(deps, { question: 'What is the contactor rating?' });

    // Exactly one retry, even though the retry is itself below the cap.
    expect(researchCall).toBe(2);
    expect(criticCall).toBe(2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.7);
    expect(result.answer).toBe(PLAIN_ANSWER);
    expect(result.sources.map(s => s.url)).toEqual(['https://vendor.example/ds.pdf', 'https://blog.example/ratings']);
    expect(lines(logger, 'Research retry:')).toEqual([
      'Research retry: confidence=0.70 gap=named retryConfidence=0.60 outcome=kept-first'
    ]);
  });

  it('a better retry below the cap still gets no third pass', async () => {
    let researchCall = 0;
    let criticCall = 0;
    const deps = makeDeps({
      client: {
        chatCompletion: vi.fn(async () =>
          chat(researchCall++ === 0 ? researchReply(PLAIN_ANSWER) : researchReply(`${PLAIN_ANSWER} Second source agrees.`))
        )
      } as any,
      criticClient: {
        chatCompletion: vi.fn(async () =>
          chat(criticCall++ === 0 ? criticReplyWith('A second independent source is missing.', 0.5) : criticReplyWith('A conflict remains in the voltage rating.', 0.8))
        )
      } as any
    });

    const result = await runResearchDelegation(deps, { question: 'What is the contactor rating?' });

    expect(researchCall).toBe(2);
    expect(criticCall).toBe(2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.8);
    expect(result.answer).toContain('Second source agrees.');
  });

  it('skips the retry for cost when the remaining budget cannot cover it', async () => {
    const logger = capturingLogger();
    const client = {
      chatCompletion: vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return chat(researchReply(PLAIN_ANSWER));
      })
    } as any;
    const deps = makeDeps({
      client,
      logger: logger as any,
      criticClient: { chatCompletion: vi.fn(async () => chat(criticReplyWith('A second independent source is missing.', 0.7))) } as any
    });

    const result = await runResearchDelegation(
      deps,
      { question: 'What is the contactor rating?' },
      RESEARCH_RETRY_BUDGET_MS + 1
    );

    expect(client.chatCompletion).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.7);
    const skipLines = lines(logger, 'Research retry skipped');
    expect(skipLines).toHaveLength(1);
    expect(skipLines[0]).toContain('confidence=0.70 gap=named');
    expect(skipLines[0]).toContain('outcome=kept-first');
  });

  /**
   * Research client whose FIRST pass issues one tool call and then hangs until
   * the pass signal aborts (salvaging the tool row), and whose RETRY answers.
   *
   * @param answer - the JSON answer the retry pass returns
   * @returns the stubbed client plus a counter of the model calls it saw
   */
  function hangingFirstPassClient(answer: string): { client: any; calls: () => number } {
    let researchCall = 0;
    const client = {
      chatCompletion: vi.fn((opts: any) => {
        const call = researchCall++;
        if (call === 0) {
          return Promise.resolve(toolCallTurn([{ id: 'call-1', name: 'web_search', args: { query: 'ME1115 curve' } }]));
        }
        if (call === 1) {
          return new Promise((_resolve, reject) => {
            opts.signal?.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              { once: true }
            );
          });
        }
        return Promise.resolve(chat(answer));
      })
    };
    return { client, calls: () => researchCall };
  }

  it('a first pass that hangs past its own cap times out and still earns the retry when the outer budget has room', async () => {
    const registry = stubRegistry([
      { name: 'web_search', execute: async () => ({ success: true, result: 'Search hits: ME1115 performance curve (vendor).' }) }
    ]);
    const { client, calls } = hangingFirstPassClient(researchReply(PLAIN_ANSWER));
    const deps = makeDeps({
      toolRegistry: registry,
      client,
      criticClient: { chatCompletion: vi.fn(async () => chat(criticReplyWith('Two independent sources agree.', 0.8))) } as any
    });

    // 400 ms total, 20 ms per pass: the first pass may spend only its own cap.
    const result = await runResearchDelegation(deps, { question: 'What is the efficiency at 100 A?' }, 400, 20);

    expect(calls()).toBe(3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer).toContain('48V');
    // The salvaged digest survived the per-pass race and focuses the retry.
    const retryPrompt = String(client.chatCompletion.mock.calls[2][0].messages.find((m: any) => m.role === 'user').content);
    expect(retryPrompt).toContain('Focus:');
    expect(retryPrompt).toContain('ME1115 performance curve');
  });

  it('a per-pass timeout reports that pass\'s own elapsed time, not the total budget', async () => {
    const registry = stubRegistry([
      { name: 'web_search', execute: async () => ({ success: true, result: 'Search hits: ME1115 performance curve (vendor).' }) }
    ]);
    const { client, calls } = hangingFirstPassClient(researchReply(PLAIN_ANSWER));
    const deps = makeDeps({ toolRegistry: registry, client });

    // 25 ms total leaves 5 ms after the 20 ms pass: the retry cannot be paid for.
    const result = await runResearchDelegation(deps, { question: 'What is the efficiency at 100 A?' }, 25, 20);

    expect(calls()).toBe(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
    // 0.02 s is the PASS cap that ended it; the 0.025 s total is not.
    expect(result.detail).toBe('0.02s');
    expect(result.partial).toBe(true);
    expect(result.findings).toContain('ME1115 performance curve');
  });

  it('a fast first pass plus a slow retry is capped at the per-pass budget, not the outer one', async () => {
    let researchCall = 0;
    const deps = makeDeps({
      client: {
        chatCompletion: vi.fn((opts: any) => {
          if (researchCall++ === 0) return Promise.resolve(chat(researchReply(PLAIN_ANSWER)));
          return new Promise((_resolve, reject) => {
            opts.signal?.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              { once: true }
            );
          });
        })
      } as any,
      criticClient: {
        chatCompletion: vi.fn(async () => chat(criticReplyWith('A second independent source is missing.', 0.7)))
      } as any
    });
    const startedAt = Date.now();

    // A 5 s outer ceiling would hold the caller for 5 s; the 20 ms pass cap
    // ends the hanging retry instead, so the first answer is kept.
    const result = await runResearchDelegationWithTimeout(deps, { question: 'What is the contactor rating?' }, 5000, 20);

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(researchCall).toBe(2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.7);
    expect(result.answer).toBe(PLAIN_ANSWER);
  });

  it('the outer ceiling still ends the whole delegation, and reports its own elapsed time', async () => {
    let seenSignal: AbortSignal | undefined;
    const deps = makeDeps({
      client: {
        chatCompletion: vi.fn((opts: any) => {
          seenSignal = opts?.signal;
          return new Promise(() => { /* never settles */ });
        })
      } as any
    });

    // The pass cap (5 s) is far larger than the ceiling (20 ms): the ceiling wins.
    const result = await runResearchDelegationWithTimeout(deps, { question: 'What is the contactor rating?' }, 20, 5000);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timeout');
    expect(result.detail).toBe('0.02s');
    expect(seenSignal?.aborted).toBe(true);
  });
});
