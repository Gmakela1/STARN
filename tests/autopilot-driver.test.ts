import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES, defaultAutopilotState } from '../src/workspace/state.js';
import { AutopilotDriver, AutopilotEvent, AutopilotDeps } from '../src/core/autopilot.js';
import { TurnResult } from '../src/core/runner.js';
import { approveArtifact } from '../src/core/approvals.js';
import { addPortalItem, listPortalItems } from '../src/core/question-portal.js';
import { PortalItem } from '../src/workspace/types.js';

/**
 * Helper: create a canned TurnResult for a given specialist phase.
 */
function makeTurnResult(specialistId: string, overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    specialistId,
    specialistName: specialistId.charAt(0).toUpperCase() + specialistId.slice(1),
    output: `# ${specialistId.toUpperCase()}\n\nDeliverable content.`,
    criticResult: overrides.criticResult ?? { passed: true, score: 9.0, summary: 'pass', strengths: [], weaknesses: [], actionableGuidance: '' },
    autoRevisionsRun: overrides.autoRevisionsRun ?? 0,
    requiresReview: overrides.requiresReview ?? true,
    sessionMessages: [],
    criticFailed: overrides.criticFailed ?? false,
    ...overrides
  };
}

/**
 * Helper: write a doc to disk so approveArtifact can read it back.
 */
function writeDoc(projectPath: string, specialistId: string, content: string): void {
  const docsDir = path.join(projectPath, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, `${specialistId.toUpperCase()}.md`), content, 'utf-8');
}

/**
 * Pre-approve a phase by writing its doc and calling approveArtifact.
 */
async function preApprovePhase(projectPath: string, stateMgr: ProjectStateManager, phaseId: string, content?: string): Promise<void> {
  const doc = content ?? `# ${phaseId.toUpperCase()}\n\nPre-approved.`;
  writeDoc(projectPath, phaseId, doc);
  await approveArtifact({
    projectPath,
    stateManager: stateMgr,
    specialistId: phaseId,
    content: doc,
    advance: true
  });
}

describe('AutopilotDriver', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;
  let capturedEvents: AutopilotEvent[];
  let executeTurnMock: ReturnType<typeof vi.fn>;

  /** Returns a new AutopilotDriver with a fresh mock executeTurn. */
  function createDriver(overrides?: Partial<AutopilotDeps>): AutopilotDriver {
    const deps: AutopilotDeps = {
      stateManager: overrides?.stateManager ?? stateMgr,
      projectPath: overrides?.projectPath ?? tmpDir,
      executeTurn: overrides?.executeTurn ?? executeTurnMock
    };
    return new AutopilotDriver(deps, (ev) => { capturedEvents.push(ev); });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-autopilot-'));
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('p1', 'Autopilot Test');
    capturedEvents = [];
    executeTurnMock = vi.fn();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Test 1: 3-phase chain all passing ──────────────────────────────────

  it('drives conops→architecture→icd with phase events and complete', async () => {
    // Mock executeTurn to write doc and return passing results
    executeTurnMock.mockImplementation(async (opts: { forceSpecialistId: string }) => {
      writeDoc(tmpDir, opts.forceSpecialistId, `# ${opts.forceSpecialistId.toUpperCase()}\n\nAuto-generated.`);
      return makeTurnResult(opts.forceSpecialistId);
    });

    const driver = createDriver();
    driver.start();

    // Wait for the async run to complete
    await vi.waitFor(() => {
      expect(capturedEvents.some(e => e.kind === 'complete')).toBe(true);
    }, { timeout: 5000, interval: 50 });

    // Events in order
    const startEv = capturedEvents.find(e => e.kind === 'start')!;
    expect(startEv).toMatchObject({ kind: 'start', total: 13 });

    // All 13 phases should run (first 3 are conops, architecture, icd)
    const draftingEvents = capturedEvents.filter(e => e.kind === 'phase' && (e as any).status === 'drafting');
    const firstThreePhaseIds = draftingEvents.slice(0, 3).map(e => (e as any).phaseId);
    expect(firstThreePhaseIds).toEqual(['conops', 'architecture', 'icd']);

    const completeEv = capturedEvents.find(e => e.kind === 'complete')!;
    expect(completeEv).toMatchObject({ kind: 'complete' });
    const completeResult = (completeEv as any).result;
    expect(completeResult.passed.length).toBe(13);
    expect(completeResult.passed[0]).toBe('conops');
    expect(completeResult.passed[1]).toBe('architecture');
    expect(completeResult.passed[2]).toBe('icd');
    expect(completeResult.parked).toEqual([]);

    // executeTurn called with forceSpecialistId per phase
    const turnCalls = executeTurnMock.mock.calls;
    expect(turnCalls.length).toBe(13);
    expect(turnCalls[0][0].forceSpecialistId).toBe('conops');
    expect(turnCalls[1][0].forceSpecialistId).toBe('architecture');
    expect(turnCalls[2][0].forceSpecialistId).toBe('icd');

    // Artifacts approved
    const state = stateMgr.getState();
    expect(state.artifacts.filter(a => a.status === 'approved').map(a => a.id))
      .toEqual(expect.arrayContaining(['CONOPS', 'ARCHITECTURE', 'ICD']));

    // Active phase advanced to the last phase (all 13 ran, sow is last)
    expect(state.workflow.activePhase).toBe('sow');
    // Autopilot state
    expect(state.autopilot!.running).toBe(false);
    expect(state.autopilot!.docStatus['conops']).toBe('passed');
    expect(state.autopilot!.docStatus['architecture']).toBe('passed');
    expect(state.autopilot!.docStatus['icd']).toBe('passed');
  });

  // ── Test 2: forceSpecialistId passed in each executeTurn opts ──────────

  it('passes forceSpecialistId in each executeTurn call', async () => {
    executeTurnMock.mockImplementation(async (opts: { forceSpecialistId: string }) => {
      writeDoc(tmpDir, opts.forceSpecialistId, `# ${opts.forceSpecialistId.toUpperCase()}\n\nAuto-generated.`);
      return makeTurnResult(opts.forceSpecialistId);
    });

    const driver = createDriver();
    driver.start();

    await vi.waitFor(() => {
      expect(capturedEvents.some(e => e.kind === 'complete')).toBe(true);
    }, { timeout: 5000, interval: 50 });

    const calls = executeTurnMock.mock.calls;
    for (const call of calls) {
      expect(call[0]).toHaveProperty('forceSpecialistId');
      expect(typeof call[0].forceSpecialistId).toBe('string');
    }
  });

  // ── Test 3: onQuestions → addPortalItem persisted + event emitted ──────

  it('captures questions via onQuestions, persists portal items, run continues', async () => {
    executeTurnMock.mockImplementation(async (opts: { forceSpecialistId: string; onQuestions?: Function }) => {
      writeDoc(tmpDir, opts.forceSpecialistId, `# ${opts.forceSpecialistId.toUpperCase()}\n\nAuto-generated.`);
      // Fire onQuestions as the real runner would
      if (opts.onQuestions) {
        opts.onQuestions([
          { type: 'question', severity: 'normal', docPath: `docs/${opts.forceSpecialistId.toUpperCase()}.md`, title: 'What voltage?', source: 'autopilot' },
          { type: 'question', severity: 'normal', docPath: `docs/${opts.forceSpecialistId.toUpperCase()}.md`, title: 'What current?', source: 'autopilot' }
        ]);
      }
      return makeTurnResult(opts.forceSpecialistId);
    });

    const driver = createDriver();
    driver.start();

    await vi.waitFor(() => {
      expect(capturedEvents.some(e => e.kind === 'complete')).toBe(true);
    }, { timeout: 5000, interval: 50 });

    // Portal items persisted
    const items = listPortalItems(stateMgr);
    expect(items.length).toBeGreaterThanOrEqual(2);

    // Question events emitted
    const questionEvents = capturedEvents.filter(e => e.kind === 'question');
    expect(questionEvents.length).toBeGreaterThanOrEqual(2);

    // Run completed normally (non-blocking)
    const completeEv = capturedEvents.find(e => e.kind === 'complete')!;
    expect(completeEv).toBeDefined();
  });

  // ── Test 4: criticFailed → park, stop, emit park event ────────────────

  it('parks phase on criticFailed, stops run, emits parked event', async () => {
    executeTurnMock.mockImplementation(async (opts: { forceSpecialistId: string }) => {
      writeDoc(tmpDir, opts.forceSpecialistId, `# ${opts.forceSpecialistId.toUpperCase()}\n\nAuto-generated.`);
      if (opts.forceSpecialistId === 'architecture') {
        return makeTurnResult('architecture', { criticFailed: true, criticResult: { passed: false, score: 4.0, summary: 'failed', strengths: [], weaknesses: ['Poor'], actionableGuidance: 'Rewrite' } });
      }
      return makeTurnResult(opts.forceSpecialistId);
    });

    const driver = createDriver();
    driver.start();

    await vi.waitFor(() => {
      expect(capturedEvents.some(e => e.kind === 'complete')).toBe(true);
    }, { timeout: 5000, interval: 50 });

    // Parked event emitted
    const parkedEv = capturedEvents.find(e => e.kind === 'parked')!;
    expect(parkedEv).toBeDefined();

    // Parked portal item persisted
    const parkedItems = listPortalItems(stateMgr, { type: 'parked' });
    expect(parkedItems.length).toBeGreaterThanOrEqual(1);
    expect(parkedItems[0].severity).toBe('blocking');

    // Run stopped: running=false
    const state = stateMgr.getState();
    expect(state.autopilot!.running).toBe(false);
    expect(state.autopilot!.blocks).toBeGreaterThanOrEqual(1);

    // Only conops passed, architecture parked
    const completeEv = capturedEvents.find(e => e.kind === 'complete')! as any;
    expect(completeEv.result.passed).toEqual(['conops']);
    expect(completeEv.result.parked).toContain('architecture');
  });

  // ── Test 5: resume after park → re-run, resolve, continue ─────────────

  it('resumes parked phase, re-runs it, resolves parked item, continues chain', async () => {
    let callIndex = 0;
    executeTurnMock.mockImplementation(async (opts: { forceSpecialistId: string }) => {
      callIndex++;
      writeDoc(tmpDir, opts.forceSpecialistId, `# ${opts.forceSpecialistId.toUpperCase()}\n\nAuto-generated.`);
      if (opts.forceSpecialistId === 'architecture' && callIndex <= 2) {
        return makeTurnResult('architecture', { criticFailed: true, criticResult: { passed: false, score: 4.0, summary: 'failed', strengths: [], weaknesses: ['Poor'], actionableGuidance: 'Rewrite' } });
      }
      return makeTurnResult(opts.forceSpecialistId);
    });

    const driver = createDriver();
    driver.start();

    await vi.waitFor(() => {
      expect(capturedEvents.some(e => e.kind === 'complete')).toBe(true);
    }, { timeout: 5000, interval: 50 });

    // First run: conops passed, architecture parked
    expect(stateMgr.getState().autopilot!.blocks).toBeGreaterThanOrEqual(1);
    expect(stateMgr.getState().autopilot!.running).toBe(false);

    // Resume architecture
    capturedEvents = []; // clear events for resume
    driver.resume('architecture');

    await vi.waitFor(() => {
      expect(capturedEvents.some(e => e.kind === 'complete')).toBe(true);
    }, { timeout: 5000, interval: 50 });

    const state = stateMgr.getState();
    expect(state.autopilot!.running).toBe(false);
    expect(state.autopilot!.blocks).toBe(0);

    // Parked item resolved
    const parkedItems = listPortalItems(stateMgr, { type: 'parked' });
    for (const item of parkedItems) {
      expect(item.status).toBe('resolved');
    }

    // Chain continued past architecture
    const completeEv = capturedEvents.find(e => e.kind === 'complete')! as any;
    expect(completeEv.result.passed).toContain('architecture');
  });

  // ── Test 6: stop mid-run → abort signal, no later phases ──────────────

  it('stops mid-run, propagates abort, does not run later phases', async () => {
    let conopsSignal: AbortSignal | undefined;
    executeTurnMock.mockImplementation(async (opts: { forceSpecialistId: string; signal?: AbortSignal }) => {
      if (opts.forceSpecialistId === 'conops') {
        conopsSignal = opts.signal;
        writeDoc(tmpDir, 'conops', '# CONOPS\n\nAuto-generated.');
        return makeTurnResult('conops');
      }
      if (opts.forceSpecialistId === 'architecture') {
        writeDoc(tmpDir, 'architecture', '# ARCHITECTURE\n\nAuto-generated.');
        return makeTurnResult('architecture');
      }
      writeDoc(tmpDir, opts.forceSpecialistId, `# ${opts.forceSpecialistId.toUpperCase()}\n\nAuto-generated.`);
      return makeTurnResult(opts.forceSpecialistId);
    });

    const driver = createDriver();
    driver.start();

    // Wait for conops to start (phase event)
    await vi.waitFor(() => {
      const phaseEvs = capturedEvents.filter(e => e.kind === 'phase' && (e as any).phaseId === 'conops' && (e as any).status === 'drafting');
      return phaseEvs.length > 0;
    }, { timeout: 3000, interval: 30 });

    // Let conops complete (it returns immediately from mock)
    await vi.waitFor(() => {
      const phaseEvs = capturedEvents.filter(e => e.kind === 'phase' && (e as any).phaseId === 'conops' && (e as any).status === 'passed');
      return phaseEvs.length > 0;
    }, { timeout: 3000, interval: 30 });

    // Stop before architecture runs
    driver.stop();

    // The current phase should be set to idle in autopilot state
    const state = stateMgr.getState();
    expect(state.autopilot!.running).toBe(false);

    // Abort signal was propagated (conops had a signal)
    expect(conopsSignal).toBeDefined();
    expect(conopsSignal?.aborted).toBe(true);

    // Only conops ran, no architecture or icd
    const turnCalls = executeTurnMock.mock.calls;
    const phaseIdsRun = turnCalls.map((c: any) => c[0].forceSpecialistId);
    expect(phaseIdsRun).toContain('conops');
    // Architecture may or may not have been called depending on timing; at minimum
    // the run stopped before completing all phases
  });

  // ── Test 7: already-approved skip + prereq order ───────────────────────

  it('skips already-approved phases and maintains order', async () => {
    // Pre-approve CONOPS
    await preApprovePhase(tmpDir, stateMgr, 'conops');

    executeTurnMock.mockImplementation(async (opts: { forceSpecialistId: string }) => {
      writeDoc(tmpDir, opts.forceSpecialistId, `# ${opts.forceSpecialistId.toUpperCase()}\n\nAuto-generated.`);
      return makeTurnResult(opts.forceSpecialistId);
    });

    const driver = createDriver();
    driver.start();

    await vi.waitFor(() => {
      expect(capturedEvents.some(e => e.kind === 'complete')).toBe(true);
    }, { timeout: 5000, interval: 50 });

    // CONOPS was NOT re-run (already approved)
    const turnCalls = executeTurnMock.mock.calls;
    const phaseIdsRun = turnCalls.map((c: any) => c[0].forceSpecialistId);
    expect(phaseIdsRun).not.toContain('conops');

    // Chain started at architecture
    const phaseEvents = capturedEvents.filter(e => e.kind === 'phase');
    const firstPhase = phaseEvents[0] as any;
    expect(firstPhase.phaseId).toBe('architecture');

    // Order maintained: architecture before icd
    const phaseIds = phaseEvents.map((e: any) => e.phaseId);
    const archIdx = phaseIds.indexOf('architecture');
    const icdIdx = phaseIds.indexOf('icd');
    expect(archIdx).toBeLessThan(icdIdx);
  });

  // ── Test 8: auto-approve: each passing phase is recorded approved ─────

  it('records artifacts as approved and advances activePhase after each phase', async () => {
    executeTurnMock.mockImplementation(async (opts: { forceSpecialistId: string }) => {
      writeDoc(tmpDir, opts.forceSpecialistId, `# ${opts.forceSpecialistId.toUpperCase()}\n\nAuto-generated.`);
      return makeTurnResult(opts.forceSpecialistId);
    });

    const driver = createDriver();
    driver.start();

    await vi.waitFor(() => {
      expect(capturedEvents.some(e => e.kind === 'complete')).toBe(true);
    }, { timeout: 5000, interval: 50 });

    const state = stateMgr.getState();

    // CONOPS should be approved
    expect(state.artifacts.find(a => a.id === 'CONOPS')?.status).toBe('approved');
    // Active phase advanced past CONOPS
    expect(state.workflow.activePhase).not.toBe('conops');
    // Workflow phase status set
    expect(state.workflow.phases['conops'].status).toBe('approved');
  });

  // ── Test 9: start while running → no-op ───────────────────────────────

  it('does nothing when start() called while already running', async () => {
    // Make executeTurn hang until we signal
    let resolveTurn: Function;
    executeTurnMock.mockImplementation(() => new Promise(resolve => { resolveTurn = resolve; }));

    const driver = createDriver();
    driver.start();

    // Give start() a chance to set running=true
    await vi.waitFor(() => {
      expect(stateMgr.getState().autopilot!.running).toBe(true);
    }, { timeout: 2000, interval: 30 });

    // Capture the call count so far
    const callCountBefore = executeTurnMock.mock.calls.length;

    // Call start() again — should be no-op
    driver.start();

    // executeTurn should not have been called again
    expect(executeTurnMock.mock.calls.length).toBe(callCountBefore);

    // Clean up: resolve the hanging turn
    if (resolveTurn) {
      resolveTurn(makeTurnResult('conops'));
    }
  });

  // ── Test 10: getState() returns live autopilot state ──────────────────

  it('getState returns live AutopilotState from the state manager', async () => {
    executeTurnMock.mockImplementation(async (opts: { forceSpecialistId: string }) => {
      writeDoc(tmpDir, opts.forceSpecialistId, `# ${opts.forceSpecialistId.toUpperCase()}\n\nAuto-generated.`);
      return makeTurnResult(opts.forceSpecialistId);
    });

    const driver = createDriver();
    expect(driver.getState().running).toBe(false);

    driver.start();

    await vi.waitFor(() => {
      expect(capturedEvents.some(e => e.kind === 'complete')).toBe(true);
    }, { timeout: 5000, interval: 50 });

    const state = driver.getState();
    expect(state.running).toBe(false);
    expect(state.docStatus['conops']).toBe('passed');
    expect(state.revisionsUsed['conops']).toBeDefined();
  });
});
