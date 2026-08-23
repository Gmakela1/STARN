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
    expect(initial.currentPhase).toBe('discovery');
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
});
