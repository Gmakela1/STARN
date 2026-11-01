import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseScopingPlan,
  runScopingTurn,
  SCOPING_ALLOWED_TOOLS,
  SCOPING_SYSTEM_DIRECTIVE,
  ScopingPlan,
  ResearchStageDeps
} from '../src/core/research-preflight.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { ChatCompletionOptions, ChatCompletionResult } from '../src/openrouter/types.js';

const SCOPING_MARKDOWN = `## Anticipated Structure
1. System Overview
2. Power Architecture

## Info Needs
1. Motor continuous power rating -> web search "Motenergy ME1115 continuous power"
2. Battery pack voltage baseline -> docs/REQUIREMENTS.md

## Anticipated Questions
1. **Q1. [ELECTRICAL] Confirm main contactor rating.** Blocking procurement.
2. **Q2. [MECHANICAL] Motor mount bolt-circle.** Drives adapter plate.
`;

function makeDeps(overrides: Partial<ResearchStageDeps> = {}): ResearchStageDeps {
  const tempDir = path.join(os.tmpdir(), 'starn-scoping-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(tempDir, { recursive: true });
  const stateManager = new ProjectStateManager(tempDir);
  stateManager.getOrCreateState('p1', 'Test Project');
  return {
    client: { chatCompletion: vi.fn() } as any,
    model: 'test-model',
    projectPath: tempDir,
    stateManager,
    toolRegistry: new ToolRegistry(),
    ...overrides
  };
}

describe('parseScopingPlan', () => {
  it('parses the mandated three-section markdown', () => {
    const plan = parseScopingPlan(SCOPING_MARKDOWN);
    expect(plan).not.toBeNull();
    expect(plan!.structure).toEqual(['System Overview', 'Power Architecture']);
    expect(plan!.infoNeeds).toHaveLength(2);
    expect(plan!.infoNeeds[0]).toContain('Motor continuous power rating');
    expect(plan!.rankedQuestions).toHaveLength(2);
    expect(plan!.rankedQuestions[0]).toContain('[ELECTRICAL]');
    expect(plan!.topics).toEqual(['electrical', 'mechanical']);
  });

  it('parses a JSON-shaped reply (brace-extract precedent)', () => {
    const plan = parseScopingPlan('Preamble noise {"structure":["S1"],"infoNeeds":["fact -> web"],"anticipatedQuestions":["**Q1. [THERMAL] Heatsink size.**"]} trailing');
    expect(plan).not.toBeNull();
    expect(plan!.infoNeeds).toEqual(['fact -> web']);
    expect(plan!.topics).toEqual(['thermal']);
  });

  it('returns null on empty, malformed and section-less output', () => {
    expect(parseScopingPlan('')).toBeNull();
    expect(parseScopingPlan('   ')).toBeNull();
    expect(parseScopingPlan('Just some prose with no sections at all.')).toBeNull();
    expect(parseScopingPlan('{not valid json')).toBeNull();
  });
});

describe('runScopingTurn', () => {
  let capturedAllowedTools: string[] = [];

  beforeEach(() => {
    capturedAllowedTools = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a read-only allow-list (no fs_write/fs_edit/state_update/web_search)', async () => {
    const deps = makeDeps({
      client: {
        chatCompletion: vi.fn(async () => ({
          content: SCOPING_MARKDOWN,
          raw: {}
        }))
      } as any
    });
    vi.spyOn(deps.toolRegistry, 'getDefinitions').mockImplementation(((names?: string[]) => {
      capturedAllowedTools = names ?? [];
      return [];
    }) as any);

    await runScopingTurn(deps);

    expect(capturedAllowedTools).toEqual([...SCOPING_ALLOWED_TOOLS]);
    expect(capturedAllowedTools).not.toContain('fs_write');
    expect(capturedAllowedTools).not.toContain('fs_edit');
    expect(capturedAllowedTools).not.toContain('state_update');
    expect(capturedAllowedTools).not.toContain('web_search');
  });

  it('runs with the specialist system prompt + scoping directive and parses the plan', async () => {
    const prompts: string[] = [];
    const deps = makeDeps({
      specialistSystemPrompt: 'SPECIALIST MISSION PROMPT',
      client: {
        chatCompletion: vi.fn(async (opts: ChatCompletionOptions): Promise<ChatCompletionResult> => {
          prompts.push(String(opts.messages[0]?.content ?? ''));
          return { content: SCOPING_MARKDOWN, raw: {} };
        })
      } as any
    });

    const plan: ScopingPlan | null = await runScopingTurn(deps);

    expect(plan).not.toBeNull();
    expect(plan!.infoNeeds).toHaveLength(2);
    expect(prompts[0]).toContain('SPECIALIST MISSION PROMPT');
    expect(prompts[0]).toContain(SCOPING_SYSTEM_DIRECTIVE);
  });

  it('degrades to null when the loop throws (never propagates non-abort errors)', async () => {
    const deps = makeDeps({
      client: {
        chatCompletion: vi.fn(async () => {
          throw new Error('provider down');
        })
      } as any
    });
    await expect(runScopingTurn(deps)).resolves.toBeNull();
  });
});
