/**
 * Unit tests for the research delegation runner (src/core/research-delegation.ts):
 * band mapping, the successful result shape, the three failure mappings, the
 * optional decision-block extraction, and the focus-line prefix. Stub clients
 * only — no network, no state writes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../src/workspace/state.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ChatCompletionResult } from '../src/openrouter/types.js';
import { ResearchGateDeps } from '../src/core/research-gate.js';
import { runResearchDelegation, runResearchDelegationWithTimeout, toBand } from '../src/core/research-delegation.js';

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

const PLAIN_ANSWER = 'The main contactor is rated 48V DC.';
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
});
