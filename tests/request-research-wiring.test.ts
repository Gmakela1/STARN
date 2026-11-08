/**
 * Wiring tests for the `request_research` capability (spec §5.5, §9, §11):
 * a fake research-gate deps set assembled the way the runner/session assemble
 * it feeds the closure, the tool handler returns the delegated findings, and a
 * delegation appends exactly ONE `kind:'research'` thread row on success and
 * none on failure. Stub clients only — no network, no real state writes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../src/workspace/state.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ChatCompletionResult } from '../src/openrouter/types.js';
import { ResearchGateDeps } from '../src/core/research-gate.js';
import {
  ResearchDelegationDeps,
  ResearchDelegationRequest,
  ResearchDelegationResult,
  buildResearchThreadRow,
  runResearchDelegationWithTimeout
} from '../src/core/research-delegation.js';
import { requestResearchHandler } from '../src/tools/handlers/request-research.js';
import { appendThreadMessage } from '../src/core/question-portal.js';
import { PortalThreadMessage } from '../src/workspace/types.js';

function chat(content: string): ChatCompletionResult {
  return { content, raw: {} } as ChatCompletionResult;
}

/** Research-turn reply in the strict JSON shape the gate prompt demands. */
const RESEARCH_REPLY = JSON.stringify({
  answer: 'The main contactor is rated 48V DC.',
  sources: [{ title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' }],
  reasoning: 'Stated verbatim in the datasheet.'
});

/** Critic reply in the strict JSON shape the research rubric demands. */
const CRITIC_REPLY = JSON.stringify({
  confidence: 0.62,
  corroborated: true,
  verdict: 'propose',
  rationale: 'Vendor datasheet, stated verbatim.'
});

describe('request_research wiring', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-request-research-wiring-'));
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('p1', 'Request Research Wiring Test');
    registry = new ToolRegistry();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** Fake gate deps — the same read-only subset runner/session assemble. */
  function makeDeps(overrides: Partial<ResearchGateDeps> = {}): ResearchDelegationDeps {
    return {
      client: { chatCompletion: vi.fn(async () => chat(RESEARCH_REPLY)) } as any,
      model: 'research-model',
      criticClient: { chatCompletion: vi.fn(async () => chat(CRITIC_REPLY)) } as any,
      criticModel: 'critic-model',
      projectPath: tmpDir,
      stateManager: stateMgr,
      toolRegistry: registry,
      verifySource: async () => ({ ok: true, excerpt: 'Manufacturer datasheet: contactor rated 48V DC.' }),
      ...overrides
    };
  }

  /** The closure both call sites build: delegation under the shared budget. */
  function makeClosure(deps: ResearchDelegationDeps) {
    return (req: ResearchDelegationRequest) => runResearchDelegationWithTimeout(deps, req);
  }

  it('the capability returns the delegation result through the tool handler', async () => {
    const deps = makeDeps();
    const context = { projectPath: tmpDir, stateManager: stateMgr, requestResearch: makeClosure(deps) };

    const res = await requestResearchHandler.execute({ question: 'What is the contactor rating?' }, context);

    expect(res.success).toBe(true);
    expect(res.result).toContain('## Research findings');
    expect(res.result).toContain('48V DC');
    expect(res.result).toContain('https://vendor.example/ds.pdf');
    expect(res.result).toContain('medium (0.62)');
    expect(res.result).not.toContain('Research unavailable in this context');
  });

  it('a successful delegation appends exactly one research row with the band and sources', async () => {
    const req: ResearchDelegationRequest = { question: 'What is the contactor rating?' };
    const result = await makeClosure(makeDeps())(req);
    expect(result.ok).toBe(true);

    const row = buildResearchThreadRow(req, result, 1700000000000);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      role: 'specialist',
      kind: 'research',
      text: 'What is the contactor rating?',
      ts: 1700000000000,
      research: {
        confidence: 0.62,
        band: 'medium',
        sources: [{ title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' }]
      }
    });

    // The row goes through the core append rule the session uses: exactly one
    // new row, no trim below the cap.
    const thread: PortalThreadMessage[] = [{ role: 'user', text: 'Can 48V work?', ts: 1 }];
    const next = appendThreadMessage(thread, row!);
    expect(next).toHaveLength(2);
    expect(next.filter(m => m.kind === 'research')).toHaveLength(1);
  });

  it('a failed delegation appends no row', async () => {
    const req: ResearchDelegationRequest = { question: 'What is the contactor rating?' };
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const deps = makeDeps({ criticClient: { chatCompletion: vi.fn(async () => { throw abort; }) } as any });

    const result = await makeClosure(deps)(req);
    expect(result.ok).toBe(false);

    const row = buildResearchThreadRow(req, result, 1700000000001);
    expect(row).toBeNull();
    // Session guard: only a non-null row is appended, so the thread is untouched.
    const thread: PortalThreadMessage[] = [{ role: 'user', text: 'Can 48V work?', ts: 1 }];
    const next = row ? appendThreadMessage(thread, row) : thread;
    expect(next).toEqual(thread);
  });

  it('runner and session both inject the capability (the bug this commit fixes)', () => {
    const runner = fs.readFileSync(path.join(process.cwd(), 'src/core/runner.ts'), 'utf-8');
    const session = fs.readFileSync(path.join(process.cwd(), 'src/server/session.ts'), 'utf-8');

    // runner: closure built from the gate deps, passed into the tool context.
    expect(runner).toMatch(/const requestResearch = \(req: ResearchDelegationRequest\) =>/);
    expect(runner).toMatch(/requestResearch,/);
    expect(runner).toContain('runResearchDelegationWithTimeout');

    // session: same closure for the advisory and the conclude turn, built once.
    expect(session).toContain('runResearchDelegationWithTimeout');
    expect(session.match(/requestResearch: this\.buildRequestResearch\(item\.id\)/g)).toHaveLength(2);
    expect(session).toContain("'request_research'");
  });
});