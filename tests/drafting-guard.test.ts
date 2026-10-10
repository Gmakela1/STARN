import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CoreRunner } from '../src/core/runner.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { ChatClient } from '../src/openrouter/types.js';

describe('no-document drafting guard', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-guard-'));
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('p1', 'Tractor');
    stateMgr.completeIntake();
  });

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it('reports an error and skips the critic when drafting produced no document', async () => {
    const drafting = { chatCompletion: vi.fn(async () => ({ content: 'Sure, I will do that.', raw: {} })) };
    const classifier = { chatCompletion: vi.fn(async () => ({ content: '{"specialistId":"conops"}', raw: {} })) };
    const critic = { chatCompletion: vi.fn(async () => ({ content: '{}', raw: {} })) };

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the CONOPS',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: drafting as ChatClient,
      model: 'qwen2.5:7b',
      draftingProviderName: 'Ollama',
      classifierClient: classifier as ChatClient,
      criticClient: critic as ChatClient,
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry(),
      sessionMessages: []
    });

    expect(result.error).toBe(true);
    expect(result.requiresReview).toBe(false);
    expect(result.output.startsWith(
      'Drafting model "qwen2.5:7b" on "Ollama" produced no document. It may not support tool calling. Reassign drafting in Settings or /models.'
    )).toBe(true);
    expect(result.output).toContain('Sure, I will do that.');
    expect(critic.chatCompletion).not.toHaveBeenCalled();
  });

  it('does not fire when the model made tool calls (tool calling works)', async () => {
    let n = 0;
    const drafting = {
      chatCompletion: vi.fn(async () =>
        n++ === 0
          ? { content: null, toolCalls: [{ id: 't1', type: 'function' as const, function: { name: 'fs_list', arguments: '{"path":"."}' } }], raw: {} }
          : { content: 'Which climate will it operate in?', raw: {} }
      )
    };
    const classifier = { chatCompletion: vi.fn(async () => ({ content: '{"specialistId":"conops"}', raw: {} })) };

    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the CONOPS',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: drafting as ChatClient,
      model: 'qwen2.5:7b',
      draftingProviderName: 'Ollama',
      classifierClient: classifier as ChatClient,
      criticClient: { chatCompletion: vi.fn(async () => ({ content: '{"passed":true,"score":9}', raw: {} })) } as ChatClient,
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry(),
      sessionMessages: []
    });

    expect(result.error).toBeUndefined();
  });
});
