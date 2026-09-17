import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { ProjectStateManager } from '../src/workspace/state.js';

describe('state_update risk storage', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'starn-risk-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('test', 'Test');
    registry = new ToolRegistry();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addPendingRisk stores a structured PendingRisk in state.pendingRisks', async () => {
    const res = await registry.execute('state_update', {
      addPendingRisk: {
        source: 'BOM.md',
        section: 'SS-02',
        risk: 'No 72V controller under $800 found'
      }
    }, { projectPath: tmpDir, stateManager: stateMgr }, ['state_update']);

    expect(res.success).toBe(true);
    const state = stateMgr.getState();
    expect(state.pendingRisks).toHaveLength(1);
    expect(state.pendingRisks![0]).toEqual({
      source: 'BOM.md',
      section: 'SS-02',
      risk: 'No 72V controller under $800 found'
    });
  });

  it('rejects addPendingRisk with missing fields via Zod', async () => {
    const res = await registry.execute('state_update', {
      addPendingRisk: { source: 'BOM.md' } // missing section, risk
    }, { projectPath: tmpDir, stateManager: stateMgr }, ['state_update']);

    expect(res.success).toBe(false);
    expect(res.error).toContain('addPendingRisk');
  });

  it('migrates legacy openRisks strings into pendingRisks on state load', () => {
    // Write a state file with legacy openRisks and no pendingRisks
    const statePath = path.join(tmpDir, '.starn', 'state.json');
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    raw.openRisks = ['Legacy wind load risk', 'Legacy rust risk'];
    delete raw.pendingRisks;
    fs.writeFileSync(statePath, JSON.stringify(raw, null, 2), 'utf-8');

    // Reload — migration should fire
    const state = stateMgr.getState();
    expect(state.pendingRisks).toHaveLength(2);
    expect(state.pendingRisks![0].source).toBe('legacy');
    expect(state.pendingRisks![0].section).toBe('unknown');
    expect(state.pendingRisks![0].risk).toBe('Legacy wind load risk');
    // openRisks is now empty (migrated)
    expect(state.openRisks).toEqual([]);
  });

  it('migrates idempotently (re-loading does not duplicate)', () => {
    const statePath = path.join(tmpDir, '.starn', 'state.json');
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    raw.openRisks = ['Legacy risk'];
    delete raw.pendingRisks;
    fs.writeFileSync(statePath, JSON.stringify(raw, null, 2), 'utf-8');

    const first = stateMgr.getState();
    const firstCount = first.pendingRisks!.length;

    // getState again — should not duplicate
    const second = stateMgr.getState();
    expect(second.pendingRisks).toHaveLength(firstCount);
  });

  it('phase param syncs workflow.activePhase and phase status map', async () => {
    await registry.execute('state_update', {
      phase: 'architecture'
    }, { projectPath: tmpDir, stateManager: stateMgr }, ['state_update']);

    const state = stateMgr.getState();
    expect(state.currentPhase).toBe('architecture');
    expect(state.workflow.activePhase).toBe('architecture');
    expect(state.workflow.phases['architecture'].status).toBe('in_progress');
  });

  it('rejects invalid phase id via Zod', async () => {
    const res = await registry.execute('state_update', {
      phase: 'not-a-real-phase'
    }, { projectPath: tmpDir, stateManager: stateMgr }, ['state_update']);

    expect(res.success).toBe(false);
    expect(res.error).toContain('phase');
  });
});
