import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES } from '../src/workspace/state.js';

describe('reopen and re-approve', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-reopen-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('test', 'Test');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('revertArtifactToDraft sets artifact to draft and re-locks downstream phases (transitive)', () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv1');
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'CONOPS',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.0
    });

    stateMgr.revertArtifactToDraft('CONOPS');

    const state = stateMgr.getState();
    const conopsArt = state.artifacts.find(a => a.id === 'CONOPS');
    expect(conopsArt?.status).toBe('draft');
    expect(state.workflow.phases['conops'].status).toBe('in_progress');

    // All phases after conops should be re-locked (pending)
    const conopsIdx = ORDERED_WORKFLOW_PHASES.findIndex(p => p.id === 'conops');
    for (let i = conopsIdx + 1; i < ORDERED_WORKFLOW_PHASES.length; i++) {
      const phaseId = ORDERED_WORKFLOW_PHASES[i].id;
      expect(state.workflow.phases[phaseId].status).toBe('pending');
    }
  });

  it('recordArtifact stores approvedContentHash on approval', () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv1 content');
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'CONOPS',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.0
    });
    const state = stateMgr.getState();
    const art = state.artifacts.find(a => a.id === 'CONOPS');
    expect(art?.approvedContentHash).toBeTruthy();
    expect(typeof art?.approvedContentHash).toBe('string');
  });

  it('hasContentChangedSinceApproval returns true when doc differs from hash', () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv1');
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'CONOPS',
      path: 'docs/CONOPS.md',
      status: 'approved'
    });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv2 changed');
    expect(stateMgr.hasContentChangedSinceApproval('CONOPS')).toBe(true);
  });

  it('hasContentChangedSinceApproval returns false when doc is unchanged', () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv1');
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'CONOPS',
      path: 'docs/CONOPS.md',
      status: 'approved'
    });
    expect(stateMgr.hasContentChangedSinceApproval('CONOPS')).toBe(false);
  });
});

describe('workflow reconciliation on load', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-reconcile-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    stateMgr = new ProjectStateManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('heals stale activePhase pointing at an approved artifact', () => {
    // Simulate a stale state: CONOPS approved but activePhase still 'conops'
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv1');
    const staleState = {
      projectId: 'test',
      name: 'Test',
      currentPhase: 'conops',
      discovery: { lastScanned: null, summary: '', keyConstraints: [] },
      intake: { completed: true, currentQuestionIndex: 5, answers: {} },
      workflow: {
        activePhase: 'conops',
        phases: Object.fromEntries(ORDERED_WORKFLOW_PHASES.map((p, i) => [
          p.id,
          { id: p.id, name: p.name, status: i === 0 ? 'approved' : 'pending', artifactPath: p.artifactPath, updatedAt: null }
        ]))
      },
      artifacts: [{ id: 'CONOPS', title: 'CONOPS', path: 'docs/CONOPS.md', status: 'approved', criticScore: 9.0, updatedAt: '2026-01-01' }],
      openRisks: [],
      recentActions: []
    };
    fs.mkdirSync(path.join(tmpDir, '.starn'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.starn', 'state.json'), JSON.stringify(staleState), 'utf-8');

    // Load — reconciliation should advance activePhase past CONOPS
    const state = stateMgr.getOrCreateState('test', 'Test');
    expect(state.workflow.activePhase).not.toBe('conops');
    expect(state.workflow.phases['conops'].status).toBe('approved');
    // Active phase should be the first non-approved (architecture)
    expect(state.workflow.activePhase).toBe('architecture');
    expect(state.workflow.phases['architecture'].status).toBe('in_progress');
  });

  it('syncs phase status from artifacts when workflow is stale', () => {
    // Simulate: artifact array says BOM is approved, but workflow.phases.bom.status = 'pending'
    const staleState = {
      projectId: 'test',
      name: 'Test',
      currentPhase: 'bom',
      discovery: { lastScanned: null, summary: '', keyConstraints: [] },
      intake: { completed: true, currentQuestionIndex: 5, answers: {} },
      workflow: {
        activePhase: 'bom',
        phases: Object.fromEntries(ORDERED_WORKFLOW_PHASES.map(p => [
          p.id,
          { id: p.id, name: p.name, status: 'pending', artifactPath: p.artifactPath, updatedAt: null }
        ]))
      },
      artifacts: [
        { id: 'CONOPS', title: 'CONOPS', path: 'docs/CONOPS.md', status: 'approved', updatedAt: '2026-01-01' },
        { id: 'ARCHITECTURE', title: 'Architecture', path: 'docs/ARCHITECTURE.md', status: 'approved', updatedAt: '2026-01-01' },
        { id: 'BOM', title: 'BOM', path: 'docs/BOM.md', status: 'approved', updatedAt: '2026-01-01' }
      ],
      openRisks: [],
      recentActions: []
    };
    fs.mkdirSync(path.join(tmpDir, '.starn'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.starn', 'state.json'), JSON.stringify(staleState), 'utf-8');

    const state = stateMgr.getOrCreateState('test', 'Test');
    // BOM phase should now reflect approved
    expect(state.workflow.phases['bom'].status).toBe('approved');
    // CONOPS and ARCHITECTURE too
    expect(state.workflow.phases['conops'].status).toBe('approved');
    expect(state.workflow.phases['architecture'].status).toBe('approved');
    // activePhase should have advanced past all approved phases
    expect(state.workflow.activePhase).not.toBe('bom');
  });
});

describe('workflow reconciliation rebuilds phase set from canonical list', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-rebuild-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    stateMgr = new ProjectStateManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds missing canonical phases and drops obsolete ones from a stale state', () => {
    // Stale state from an older STARN version: missing architecture/icd/bom,
    // has obsolete 'wbs'. CONOPS approved, ARCHITECTURE.md drafted on disk.
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), '# CONOPS\nv1');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'ARCHITECTURE.md'), '# Architecture\nv1');
    const staleState = {
      projectId: 'test',
      name: 'Test',
      currentPhase: 'conops',
      discovery: { lastScanned: null, summary: '', keyConstraints: [] },
      intake: { completed: true, currentQuestionIndex: 5, answers: {} },
      workflow: {
        activePhase: 'conops',
        phases: {
          conops: { id: 'conops', name: 'CONOPS', status: 'approved', artifactPath: 'docs/CONOPS.md', updatedAt: null },
          wbs: { id: 'wbs', name: 'WBS', status: 'pending', artifactPath: 'docs/WBS.md', updatedAt: null }
        }
      },
      artifacts: [{ id: 'CONOPS', title: 'CONOPS', path: 'docs/CONOPS.md', status: 'approved', updatedAt: '2026-01-01' }],
      openRisks: [],
      recentActions: []
    };
    fs.mkdirSync(path.join(tmpDir, '.starn'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.starn', 'state.json'), JSON.stringify(staleState), 'utf-8');

    const state = stateMgr.getOrCreateState('test', 'Test');

    // Obsolete 'wbs' dropped
    expect(state.workflow.phases['wbs']).toBeUndefined();
    // Missing canonical phases now present
    expect(state.workflow.phases['architecture']).toBeDefined();
    expect(state.workflow.phases['icd']).toBeDefined();
    expect(state.workflow.phases['bom']).toBeDefined();
    // CONOPS still approved
    expect(state.workflow.phases['conops'].status).toBe('approved');
    // activePhase advanced past approved CONOPS to architecture
    expect(state.workflow.activePhase).toBe('architecture');
  });
});
