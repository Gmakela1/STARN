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
