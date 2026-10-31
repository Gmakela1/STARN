// Purpose: criticDisabled TurnOptions flag (ripple fix turns) — the critic
// evaluation + revision loop is skipped entirely while the artifact-guard
// stays enforced. Mock pattern mirrors runner-autopilot-hooks.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CoreRunner } from '../src/core/runner.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { CriticEvaluator } from '../src/core/critic.js';
import { ProjectStateManager } from '../src/workspace/state.js';

function installBomMock(dir: string, client: OpenRouterClient, opts: { draftDoc: boolean }) {
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  return vi.spyOn(client, 'chatCompletion').mockImplementation(async (o: any) => {
    const msg = o.messages[0];
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.includes('Request Classifier for STARN')) {
      return { content: JSON.stringify({ specialistId: 'bom', reason: 'classify' }), raw: {} };
    }
    if (content.includes('Harsh Critic')) {
      throw new Error('critic must never be called when criticDisabled is set');
    }
    // Specialist drafting call (BOM system prompt marker).
    if (content.includes('Bill of Materials (BOM) Specialist')) {
      if (opts.draftDoc) {
        fs.writeFileSync(path.join(docsDir, 'BOM.md'), '# Bill of Materials (BOM)\n\n| Item | Part |\n| --- | --- |\n', 'utf-8');
      }
      return { content: opts.draftDoc ? 'I drafted the BOM.' : 'Here is my analysis, but no document.', raw: {} };
    }
    return { content: '', raw: {} };
  });
}

describe('CoreRunner criticDisabled', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;
  let mockClient: OpenRouterClient;
  let toolRegistry: ToolRegistry;
  let specialistRegistry: SpecialistRegistry;

  /** BOM's prerequisite artifact must be approved or the turn redirects. */
  function approveRequirements(): void {
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'REQUIREMENTS.md'), '# Requirements\nApproved baseline.', 'utf-8');
    stateMgr.recordArtifact({
      id: 'REQUIREMENTS',
      title: 'Engineering Requirements',
      path: 'docs/REQUIREMENTS.md',
      status: 'approved',
      criticScore: 8.8
    });
  }

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-critic-disabled-' + Date.now() + '-' + Math.random().toString(36).substring(2));
    fs.mkdirSync(tempDir, { recursive: true });
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('p1', 'Critic Disabled Test');
    stateMgr.completeIntake();
    mockClient = new OpenRouterClient({ apiKey: 'mock' });
    toolRegistry = new ToolRegistry();
    specialistRegistry = new SpecialistRegistry();
    approveRequirements();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function runTurn(draftDoc: boolean) {
    installBomMock(tempDir, mockClient, { draftDoc });
    const evaluateSpy = vi.spyOn(CriticEvaluator.prototype, 'evaluate');
    const result = await CoreRunner.executeTurn({
      userPrompt: 'Draft the BOM',
      projectPath: tempDir,
      stateManager: stateMgr,
      client: mockClient,
      model: 'test-model',
      toolRegistry,
      specialistRegistry,
      forceSpecialistId: 'bom',
      sessionMessages: [],
      criticDisabled: true
    });
    return { result, evaluateSpy };
  }

  it('skips the critic loop: evaluate is never called, no revisions, no criticFailed', async () => {
    const { result, evaluateSpy } = await runTurn(true);
    expect(evaluateSpy).not.toHaveBeenCalled();
    expect(result.specialistId).toBe('bom');
    expect(result.autoRevisionsRun).toBe(0);
    expect(result.criticResult).toBeUndefined();
    expect(result.criticFailed).toBeFalsy();
    expect(result.error).toBeFalsy();
  });

  it('still enforces the artifact-guard: a turn with no document and no tool calls errors', async () => {
    const { result, evaluateSpy } = await runTurn(false);
    expect(evaluateSpy).not.toHaveBeenCalled();
    expect(result.error).toBe(true);
    expect(result.output).toContain('produced no document');
  });
});
