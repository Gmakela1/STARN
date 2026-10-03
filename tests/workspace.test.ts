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

  it('initializes, reads, and updates project state on disk and scaffolds docs, reference, and examples directories', () => {
    const projPath = path.join(tempBaseDir, 'shed-project');
    fs.mkdirSync(projPath, { recursive: true });

    const stateMgr = new ProjectStateManager(projPath);
    const initial = stateMgr.getOrCreateState('shed-1', 'Shed Project');
    expect(initial.currentPhase).toBe('conops');
    expect(initial.artifacts).toEqual([]);

    // Verify scaffolding directories exist
    expect(fs.existsSync(path.join(projPath, 'docs'))).toBe(true);
    expect(fs.existsSync(path.join(projPath, 'reference'))).toBe(true);
    expect(fs.existsSync(path.join(projPath, 'examples'))).toBe(true);
    expect(fs.existsSync(path.join(projPath, 'examples', 'conops'))).toBe(true);

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

  it('initializes workflow with 13 phases and activePhase set to conops', () => {
    const projPath = path.join(tempBaseDir, 'wf-project');
    fs.mkdirSync(projPath, { recursive: true });
    const stateMgr = new ProjectStateManager(projPath);
    const state = stateMgr.getOrCreateState('p1', 'Tractor EV');
    expect(state.workflow).toBeDefined();
    expect(state.workflow.activePhase).toBe('conops');
    expect(Object.keys(state.workflow.phases)).toEqual(
      expect.arrayContaining(['conops', 'architecture', 'icd', 'capabilities', 'requirements', 'bom', 'rtm', 'milestones', 'risk-register', 'build-sequence', 'work-instructions', 'testplans', 'sow'])
    );
    expect(Object.keys(state.workflow.phases).length).toBe(13);
  });

  it('scaffolds docs/work_instructions and artifacts directories', () => {
    const projPath = path.join(tempBaseDir, 'scaffold-dirs-project');
    fs.mkdirSync(projPath, { recursive: true });
    const stateMgr = new ProjectStateManager(projPath);
    stateMgr.getOrCreateState('p1', 'Tractor EV');

    expect(fs.existsSync(path.join(projPath, 'docs', 'work_instructions'))).toBe(true);
    expect(fs.existsSync(path.join(projPath, 'artifacts'))).toBe(true);
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
    expect(nextPhase).toBe('architecture');
    expect(stateMgr.getState().workflow.activePhase).toBe('architecture');
    expect(stateMgr.getState().workflow.phases.conops.status).toBe('approved');
  });

  it('fails manual approval if artifact file does not exist on disk', () => {
    const projPath = path.join(tempBaseDir, 'manual-app-fail');
    fs.mkdirSync(projPath, { recursive: true });
    const stateMgr = new ProjectStateManager(projPath);
    stateMgr.getOrCreateState('p1', 'Tractor EV');

    const res = stateMgr.manualApproveArtifact('conops');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Document not found');
  });

  it('approves artifact and sets content hash when file exists', () => {
    const projPath = path.join(tempBaseDir, 'manual-app-pass');
    fs.mkdirSync(projPath, { recursive: true });
    const docsDir = path.join(projPath, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'CONOPS.md'), '# CONOPS\nSystem definition', 'utf-8');

    const stateMgr = new ProjectStateManager(projPath);
    stateMgr.getOrCreateState('p1', 'Tractor EV');

    const res = stateMgr.manualApproveArtifact('conops');
    expect(res.success).toBe(true);
    expect(res.artifact?.status).toBe('approved');
    expect(res.artifact?.approvedContentHash).toBeDefined();

    const state = stateMgr.getState();
    expect(state.workflow?.phases.conops.status).toBe('approved');
  });
});
