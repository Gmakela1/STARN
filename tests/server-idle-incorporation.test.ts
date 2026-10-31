import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ServerSessionManager } from '../src/server/session.js';
import { ProjectStateManager, defaultAutopilotState } from '../src/workspace/state.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { addPortalItem } from '../src/core/question-portal.js';
import { PENDING_INCORPORATION_MARKER } from '../src/core/incorporation-prompt.js';
import { DEFAULT_TRANSCRIBER_MODEL } from '../src/config.js';
import type { TurnResult } from '../src/core/runner.js';

/**
 * Seam tests for the idle-path answer incorporation (critic 55e60194).
 *
 * applyAnswer is NOT mocked — the real core applier runs against a real
 * session queueAnswer. Only CoreRunner.executeTurn (the model boundary the
 * executeTurn dep bottoms out in) is stubbed so the incorporation turn and
 * the ripple scan/fix turns are observable without an LLM.
 */
const { executeTurnMock } = vi.hoisted(() => ({ executeTurnMock: vi.fn() }));

vi.mock('../src/core/runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/runner.js')>();
  return {
    ...actual,
    CoreRunner: class extends actual.CoreRunner {
      static executeTurn = executeTurnMock;
    }
  };
});

function makeTurnResult(specialistId: string, output = '# Heading\n\nDraft.'): TurnResult {
  return {
    specialistId,
    specialistName: specialistId,
    output,
    criticResult: { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' },
    autoRevisionsRun: 0,
    requiresReview: true,
    sessionMessages: []
  };
}

describe('idle-path answer incorporation (real queueAnswer → real applyAnswer)', () => {
  let tempDir: string;
  let stateManager: ProjectStateManager;
  let session: ServerSessionManager;
  let frames: any[];
  let conopsPath: string;
  let architecturePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-idle-incorporation-'));
    fs.mkdirSync(path.join(tempDir, 'docs', 'work_instructions'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'artifacts'), { recursive: true });

    conopsPath = path.join(tempDir, 'docs', 'CONOPS.md');
    architecturePath = path.join(tempDir, 'docs', 'ARCHITECTURE.md');
    fs.writeFileSync(conopsPath, '# CONOPS\n\nBaseline content.\n', 'utf-8');
    fs.writeFileSync(architecturePath, '# Architecture\n\nBaseline content.\n', 'utf-8');

    stateManager = new ProjectStateManager(tempDir);
    stateManager.getOrCreateState('p1', 'Idle Incorporation Test');

    const client = new OpenRouterClient({ apiKey: 'mock' });
    vi.spyOn(client, 'chatCompletion').mockImplementation(async () => ({
      content: '# Draft (unused — CoreRunner.executeTurn is stubbed in this suite)',
      raw: {}
    }));

    session = new ServerSessionManager({
      projectPath: tempDir,
      stateManager,
      apiKey: 'mock',
      providers: [],
      assignments: {
        drafting: { providerId: 'openrouter', model: 'test-model' },
        critic: { providerId: 'openrouter', model: 'test-model' },
        classifier: { providerId: 'openrouter', model: 'test-model' },
        compaction: { providerId: 'openrouter', model: 'test-model' },
        transcriber: { providerId: 'openrouter', model: DEFAULT_TRANSCRIBER_MODEL }
      },
      clientFactory: () => client,
      toolRegistry: new ToolRegistry(),
      specialistRegistry: new SpecialistRegistry()
    });

    frames = [];
    session.addSubscriber((ev: any) => frames.push(ev));
    executeTurnMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function addItem(title: string, docPath = 'docs/CONOPS.md'): { id: string; answer: string } {
    const item = addPortalItem(stateManager, {
      type: 'question',
      severity: 'normal',
      docPath,
      title,
      source: 'autopilot'
    });
    return { id: item.id, answer: '48V nominal' };
  }

  function setDocStatus(statuses: Record<string, string>): void {
    const st = stateManager.getState();
    st.autopilot = { ...defaultAutopilotState(), docStatus: { ...statuses } };
    stateManager.saveState(st);
  }

  /** Incorporation turn: appends an incorporated section to docs/CONOPS.md. */
  function stubIncorporationWrite(): void {
    executeTurnMock.mockImplementation(async (opts: any) => {
      if (opts.forceSpecialistId === 'conops') {
        const current = fs.readFileSync(conopsPath, 'utf-8');
        fs.writeFileSync(
          conopsPath,
          current + '\n## Decision Log\n\n**Bus Voltage**: 48V nominal — incorporated from user answers.\n',
          'utf-8'
        );
        return makeTurnResult('conops');
      }
      if (opts.forceSpecialistId === 'change-impact') {
        return makeTurnResult('change-impact', 'Flagged: docs/ARCHITECTURE.md — Power section still lists 12V, now discrepant.');
      }
      if (opts.forceSpecialistId === 'architecture') {
        fs.writeFileSync(
          architecturePath,
          '# Architecture\n\nBaseline content.\n\n## Power\n\nBus voltage updated to 48V nominal.\n',
          'utf-8'
        );
        return makeTurnResult('architecture');
      }
      return makeTurnResult(String(opts.forceSpecialistId));
    });
  }

  it('a. last answer on an idle session fires ONE incorporation turn, strips the pending block, marks the doc revised, and ripples downstream', async () => {
    setDocStatus({ conops: 'auto-approved', architecture: 'auto-approved' });
    const item = addItem('What bus voltage?');
    stubIncorporationWrite();

    const result = session.queueAnswer(item.id, item.answer);
    expect(result).toEqual({ queued: false });

    // Incorporation turn → ripple scan (change-impact) → ripple fix turn.
    await vi.waitFor(() => expect(executeTurnMock).toHaveBeenCalledTimes(3));
    const specialistOrder = executeTurnMock.mock.calls.map((c: any[]) => c[0].forceSpecialistId);
    expect(specialistOrder).toEqual(['conops', 'change-impact', 'architecture']);

    // The pending block was stripped from the doc after the turn.
    const conops = fs.readFileSync(conopsPath, 'utf-8');
    expect(conops).not.toContain(PENDING_INCORPORATION_MARKER);
    expect(conops).toContain('## Decision Log');

    // Doc statuses follow the applier + ripple guards.
    const st = stateManager.getState();
    expect(st.autopilot.docStatus['conops']).toBe('revised');
    expect(st.autopilot.docStatus['architecture']).toBe('revised');

    // Frames: applied, then revised phase events for both docs.
    expect(frames.some(f => f.kind === 'answer_applied' && f.itemId === item.id)).toBe(true);
    expect(frames.some(f => f.kind === 'phase' && f.phaseId === 'conops' && f.status === 'revised')).toBe(true);
    expect(frames.some(f => f.kind === 'phase' && f.phaseId === 'architecture' && f.status === 'revised')).toBe(true);

    // The drain released the busy guard once everything settled.
    await vi.waitFor(() => expect(session.busy).toBe(false));
  });

  it('b. a parked downstream doc is never clobbered to revised by the ripple', async () => {
    setDocStatus({ conops: 'auto-approved', architecture: 'parked' });
    const item = addItem('What bus voltage?');
    stubIncorporationWrite();

    session.queueAnswer(item.id, item.answer);

    await vi.waitFor(() => expect(executeTurnMock).toHaveBeenCalledTimes(3));
    const st = stateManager.getState();
    expect(st.autopilot.docStatus['conops']).toBe('revised');
    expect(st.autopilot.docStatus['architecture']).toBe('parked');
    expect(frames.some(f => f.kind === 'phase' && f.phaseId === 'architecture' && f.status === 'revised')).toBe(false);
    await vi.waitFor(() => expect(session.busy).toBe(false));
  });

  it('c. mid-drain concurrency: queueAnswer during a post-chain drain cannot null the busy guard mid-incorporation', async () => {
    setDocStatus({ conops: 'auto-approved' });
    const item = addItem('What bus voltage?');

    let releaseIncorporation!: () => void;
    const gate = new Promise<void>(r => { releaseIncorporation = r; });
    executeTurnMock.mockImplementation(async (opts: any) => {
      if (opts.forceSpecialistId === 'conops') {
        await gate;
        // Strip the pending block and leave content byte-identical to the
        // pre-answer doc → no ripple turns in this scenario.
        const current = fs.readFileSync(conopsPath, 'utf-8');
        const idx = current.indexOf(PENDING_INCORPORATION_MARKER);
        fs.writeFileSync(conopsPath, idx >= 0 ? current.slice(0, idx).trimEnd() + '\n' : current, 'utf-8');
        return makeTurnResult('conops');
      }
      return makeTurnResult('change-impact', 'No discrepancies found.');
    });

    // Simulate the chain-end path: chain guard held, answer queued mid-chain,
    // then the chain publishes complete → guard released and the answer
    // drains under a freshly acquired (drain-owned) guard.
    (session as any).beginTurn();
    expect(session.queueAnswer(item.id, item.answer)).toEqual({ queued: true });
    (session as any).publish({ kind: 'complete', result: { passed: [], parked: [] }, reason: 'finished' });

    // The drain-owned guard is held for the WHOLE drain, including the
    // incorporation turn inside it.
    await vi.waitFor(() => expect(executeTurnMock).toHaveBeenCalledTimes(1));
    expect(session.busy).toBe(true);
    // A following POST /api/turns path sees busy → 409 (beginTurn throws).
    expect(() => (session as any).beginTurn()).toThrow('A turn is already in progress');

    // A concurrent queueAnswer during the drain is queued — it must NOT
    // acquire + immediately release the guard mid-incorporation.
    const item2 = addItem('Second question');
    expect(session.queueAnswer(item2.id, item2.answer)).toEqual({ queued: true });
    expect(session.busy).toBe(true);

    releaseIncorporation();

    // Drain finishes: guard released, the concurrently queued answer was
    // picked up by the same drain loop (applied as a plain edit).
    await vi.waitFor(() => expect(session.busy).toBe(false));
    await vi.waitFor(() => expect(frames.some(f => f.kind === 'answer_applied' && f.itemId === item2.id)).toBe(true));
    const st = stateManager.getState();
    expect(st.portalItems.find((i: any) => i.id === item.id)?.status).toBe('answered');
    expect(st.portalItems.find((i: any) => i.id === item2.id)?.status).toBe('answered');
  });
});
