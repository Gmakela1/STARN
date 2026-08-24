import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectRegistry } from '../src/workspace/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('Project Registry & State', () => {
  let tempBaseDir: string;
  let registryFile: string;

  beforeEach(() => {
    tempBaseDir = path.join(os.tmpdir(), 'starn-workspace-test-' + Date.now());
    fs.mkdirSync(tempBaseDir, { recursive: true });
    registryFile = path.join(tempBaseDir, 'registry.json');
  });

  afterEach(() => {
    fs.rmSync(tempBaseDir, { recursive: true, force: true });
  });

  it('links and lists projects in the central registry', () => {
    const registry = new ProjectRegistry(registryFile);
    const projPath = path.join(tempBaseDir, 'my-solar-shed');
    fs.mkdirSync(projPath, { recursive: true });

    const record = registry.registerProject('Off-Grid Solar Shed', projPath);
    expect(record.id).toBeDefined();
    expect(record.name).toBe('Off-Grid Solar Shed');
    expect(record.path).toBe(path.resolve(projPath));

    const list = registry.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(record.id);

    registry.setActiveProject(record.id);
    expect(registry.getActiveProject()?.id).toBe(record.id);
  });

  it('initializes, reads, and updates project state on disk', () => {
    const projPath = path.join(tempBaseDir, 'shed-project');
    fs.mkdirSync(projPath, { recursive: true });

    const stateMgr = new ProjectStateManager(projPath);
    const initial = stateMgr.getOrCreateState('shed-1', 'Shed Project');
    expect(initial.currentPhase).toBe('conops');
    expect(initial.artifacts).toEqual([]);

    stateMgr.updateDiscoverySummary('Timber frame shed 12x10 with 3kW array', ['Under 120 sqft']);
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'Concept of Operations',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.0
    });

    const reloaded = stateMgr.getState();
    expect(reloaded.discovery.summary).toContain('Timber frame');
    expect(reloaded.discovery.keyConstraints).toContain('Under 120 sqft');
    expect(reloaded.artifacts).toHaveLength(1);
    expect(reloaded.artifacts[0].id).toBe('CONOPS');
  });

  it('manages intake state across one-by-one interview turns', () => {
    const projPath = path.join(tempBaseDir, 'tractor-project');
    fs.mkdirSync(projPath, { recursive: true });
    const stateMgr = new ProjectStateManager(projPath);
    const initial = stateMgr.getOrCreateState('p1', 'Tractor EV');
    expect(initial.intake.completed).toBe(false);
    expect(initial.intake.currentQuestionIndex).toBe(0);

    stateMgr.recordIntakeAnswer('projectName', 'Electric Tractor Conversion');
    stateMgr.recordIntakeAnswer('projectIntent', 'Mow 2 acres and tow small yard trailers');
    stateMgr.incrementIntakeQuestion();

    const updated = stateMgr.getState();
    expect(updated.intake.answers.projectName).toBe('Electric Tractor Conversion');
    expect(updated.intake.answers.projectIntent).toContain('Mow 2 acres');
    expect(updated.intake.currentQuestionIndex).toBe(1);

    stateMgr.completeIntake();
    expect(stateMgr.getState().intake.completed).toBe(true);
  });

  it('checks if prerequisite artifacts are approved', () => {
    const projPath = path.join(tempBaseDir, 'prereq-project');
    fs.mkdirSync(projPath, { recursive: true });
    const stateMgr = new ProjectStateManager(projPath);
    stateMgr.getOrCreateState('p1', 'Tractor EV');

    expect(stateMgr.isArtifactApproved('CAPABILITIES')).toBe(false);
    expect(stateMgr.isArtifactApproved('REQUIREMENTS')).toBe(false);

    stateMgr.recordArtifact({
      id: 'REQUIREMENTS',
      title: 'System Requirements',
      path: 'docs/REQUIREMENTS.md',
      status: 'approved',
      criticScore: 9.0
    });

    expect(stateMgr.isArtifactApproved('REQUIREMENTS')).toBe(true);
    expect(stateMgr.isArtifactApproved('CAPABILITIES')).toBe(false);
  });

  it('initializes workflow with 7 phases and activePhase set to conops', () => {
    const projPath = path.join(tempBaseDir, 'wf-project');
    fs.mkdirSync(projPath, { recursive: true });
    const stateMgr = new ProjectStateManager(projPath);
    const state = stateMgr.getOrCreateState('p1', 'Tractor EV');
    expect(state.workflow).toBeDefined();
    expect(state.workflow.activePhase).toBe('conops');
    expect(Object.keys(state.workflow.phases)).toEqual(
      expect.arrayContaining(['conops', 'capabilities', 'requirements', 'rtm', 'milestones', 'wbs', 'sow'])
    );
  });

  it('switches active phase and advances to next logical phase upon approval', () => {
    const projPath = path.join(tempBaseDir, 'advance-project');
    fs.mkdirSync(projPath, { recursive: true });
    const stateMgr = new ProjectStateManager(projPath);
    stateMgr.getOrCreateState('p1', 'Tractor EV');

    stateMgr.setActivePhase('conops');
    stateMgr.recordArtifact({
      id: 'CONOPS',
      title: 'CONOPS Document',
      path: 'docs/CONOPS.md',
      status: 'approved',
      criticScore: 9.2
    });

    const nextPhase = stateMgr.advanceToNextPhase();
    expect(nextPhase).toBe('capabilities');
    expect(stateMgr.getState().workflow.activePhase).toBe('capabilities');
    expect(stateMgr.getState().workflow.phases.conops.status).toBe('approved');
  });
});
