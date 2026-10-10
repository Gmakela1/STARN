import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CoreRunner } from '../src/core/runner.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { ChatClient, ChatCompletionOptions, ChatCompletionResult } from '../src/openrouter/types.js';

type Impl = (o: ChatCompletionOptions) => Promise<ChatCompletionResult>;
const fake = (impl: Impl) => {
  const chatCompletion = vi.fn(impl);
  return { client: { chatCompletion } as ChatClient, chatCompletion };
};

const CONOPS_DOC = '# Concept of Operations\n## 1. Executive Summary\nElectric tractor.';
const PASS = JSON.stringify({ passed: true, score: 9, summary: 'ok', strengths: [], weaknesses: [], actionableGuidance: '' });

describe('per-role model routing', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-roles-'));
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('p1', 'Tractor');
    stateMgr.completeIntake();
  });

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const base = () => ({
    projectPath: tempDir,
    stateManager: stateMgr,
    toolRegistry: new ToolRegistry(),
    specialistRegistry: new SpecialistRegistry(),
    sessionMessages: []
  });

  it('classifier and critic use their own clients and models', async () => {
    const drafting = fake(async () => ({ content: CONOPS_DOC, raw: {} }));
    const classifier = fake(async () => ({ content: '{"specialistId":"conops","reason":"x"}', raw: {} }));
    const critic = fake(async () => ({ content: PASS, raw: {} }));

    const result = await CoreRunner.executeTurn({
      ...base(),
      userPrompt: 'Draft the CONOPS for the tractor',
      client: drafting.client,
      model: 'draft-m',
      classifierClient: classifier.client,
      classifierModel: 'cls-m',
      criticClient: critic.client,
      criticModel: 'crit-m'
    });

    expect(result.specialistId).toBe('conops');
    expect(classifier.chatCompletion).toHaveBeenCalled();
    expect(classifier.chatCompletion.mock.calls.every(c => c[0].model === 'cls-m')).toBe(true);
    expect(critic.chatCompletion).toHaveBeenCalled();
    expect(critic.chatCompletion.mock.calls.every(c => c[0].model === 'crit-m')).toBe(true);
    expect(drafting.chatCompletion.mock.calls.every(c => c[0].model === 'draft-m')).toBe(true);
  });

  it('/compact uses compactionClient and compactionModel', async () => {
    const drafting = fake(async () => ({ content: 'x', raw: {} }));
    const compaction = fake(async () => ({ content: 'summary', raw: {} }));
    const msgs = Array.from({ length: 6 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `message ${i} `.repeat(50)
    }));

    await CoreRunner.executeTurn({
      ...base(),
      sessionMessages: msgs,
      userPrompt: '/compact',
      client: drafting.client,
      model: 'draft-m',
      compactionClient: compaction.client,
      compactionModel: 'cmp-m',
      keepRecentTokens: 1
    });

    expect(compaction.chatCompletion).toHaveBeenCalledTimes(1);
    expect(compaction.chatCompletion.mock.calls[0][0].model).toBe('cmp-m');
    expect(drafting.chatCompletion).not.toHaveBeenCalled();
  });

  it('falls back to client/model when role fields unset', async () => {
    const single = fake(async o =>
      o.messages.some(m => typeof m.content === 'string' && m.content.includes('Request Classifier'))
        ? { content: '{"specialistId":"conops","reason":"x"}', raw: {} }
        : o.messages.some(m => typeof m.content === 'string' && m.content.includes('Respond ONLY with valid JSON'))
          ? { content: PASS, raw: {} }
          : { content: CONOPS_DOC, raw: {} }
    );

    await CoreRunner.executeTurn({ ...base(), userPrompt: 'Draft the CONOPS', client: single.client, model: 'test-model' });

    expect(single.chatCompletion.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(single.chatCompletion.mock.calls.every(c => c[0].model === 'test-model')).toBe(true);
  });
});
