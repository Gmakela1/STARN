import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../src/workspace/state.js';
import { approveArtifact, parseAffectedPhaseIds } from '../src/core/approvals.js';
import { harvestDecisionLog } from '../src/core/decision-log.js';

describe('approveArtifact', () => {
  let tmpDir: string;
  let stateMgr: ProjectStateManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-approvals-'));
    stateMgr = new ProjectStateManager(tmpDir);
    stateMgr.getOrCreateState('p1', 'Tractor Conversion');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const runChangeImpactSpy = () => vi.fn(async (_phaseId: string) => ['icd', 'requirements']);

  function docPath(id: string): string {
    return path.join(tmpDir, 'docs', `${id.toUpperCase()}.md`);
  }

  it('writes docs/{ID}.md, records an approved artifact with hash, and advances the phase', async () => {
    const result = await approveArtifact({
      projectPath: tmpDir,
      stateManager: stateMgr,
      specialistId: 'conops',
      content: '# CONOPS\n\n## 1. Executive Summary\nPlain text\n'
    });

    expect(fs.existsSync(docPath('conops'))).toBe(true);
    expect(fs.readFileSync(docPath('conops'), 'utf-8')).toContain('# CONOPS');

    const state = stateMgr.getState();
    const artifact = state.artifacts.find(a => a.id === 'CONOPS');
    expect(artifact?.status).toBe('approved');
    expect(artifact?.approvedContentHash).toBeTruthy();
    expect(artifact?.path).toBe('docs/CONOPS.md');

    // Artifact's phase was the active phase → advanced to the next unapproved phase
    expect(state.workflow.activePhase).toBe('architecture');
    expect(state.workflow.phases['conops'].status).toBe('approved');
    expect(result.decisionCount).toBe(0);
  });

  it('first approval reports changedSinceApproval=true (no prior hash) and runs change-impact', async () => {
    const runChangeImpact = runChangeImpactSpy();
    const result = await approveArtifact({
      projectPath: tmpDir,
      stateManager: stateMgr,
      specialistId: 'conops',
      content: '# CONOPS\nfirst draft\n',
      runChangeImpact
    });

    expect(result.changedSinceApproval).toBe(true);
    expect(runChangeImpact).toHaveBeenCalledTimes(1);
    expect(runChangeImpact).toHaveBeenCalledWith('conops');
    expect(result.affectedDocs).toEqual(['icd', 'requirements']);
  });

  it('re-approval with identical content reports changedSinceApproval=false and skips change-impact', async () => {
    const content = '# CONOPS\nstable content\n';
    await approveArtifact({ projectPath: tmpDir, stateManager: stateMgr, specialistId: 'conops', content });

    const runChangeImpact = runChangeImpactSpy();
    const result = await approveArtifact({
      projectPath: tmpDir,
      stateManager: stateMgr,
      specialistId: 'conops',
      content,
      runChangeImpact
    });

    expect(result.changedSinceApproval).toBe(false);
    expect(runChangeImpact).not.toHaveBeenCalled();
    expect(result.affectedDocs).toEqual([]);
  });

  it('re-approval with changed content reports changedSinceApproval=true and returns affected docs', async () => {
    await approveArtifact({
      projectPath: tmpDir,
      stateManager: stateMgr,
      specialistId: 'conops',
      content: '# CONOPS\nv1\n'
    });

    // Simulate a downstream edit on disk between approvals (re-approval hash detection)
    fs.writeFileSync(docPath('conops'), '# CONOPS\nv2 changed\n', 'utf-8');

    const runChangeImpact = runChangeImpactSpy();
    const result = await approveArtifact({
      projectPath: tmpDir,
      stateManager: stateMgr,
      specialistId: 'conops',
      content: '# CONOPS\nv2 changed\n',
      runChangeImpact
    });

    expect(result.changedSinceApproval).toBe(true);
    expect(runChangeImpact).toHaveBeenCalledTimes(1);
    expect(result.affectedDocs).toEqual(['icd', 'requirements']);
  });

  it('harvests Design Decisions into docs/DECISIONS.md', async () => {
    const withDecisions = [
      '# Architecture',
      '## 1. Block Diagram',
      '...',
      '## Design Decisions',
      '### D-501: 72V Nominal DC Bus',
      '- **Decision:** 72V nominal DC bus voltage',
      '- **Rationale:** Motor and controller availability',
      '- **Status:** ✅ Final',
      '## 2. Next Section',
      'something else'
    ].join('\n');

    const result = await approveArtifact({
      projectPath: tmpDir,
      stateManager: stateMgr,
      specialistId: 'architecture',
      content: withDecisions
    });

    expect(result.decisionCount).toBe(1);
    const decisionsPath = path.join(tmpDir, 'docs', 'DECISIONS.md');
    expect(fs.existsSync(decisionsPath)).toBe(true);
    const decisions = fs.readFileSync(decisionsPath, 'utf-8');
    expect(decisions).toContain('D-501');
    expect(decisions).toContain('72V nominal DC bus voltage');
    expect(decisions).not.toContain('Next Section');
  });

  it('does not advance when the active phase already moved past the artifact (goto/reopen case)', async () => {
    // Simulate /goto: the user moved active phase to architecture, then re-approves CONOPS
    stateMgr.setActivePhase('architecture');
    fs.writeFileSync(docPath('conops'), '# CONOPS\nreopened\n', 'utf-8');

    await approveArtifact({
      projectPath: tmpDir,
      stateManager: stateMgr,
      specialistId: 'conops',
      content: '# CONOPS\nreopened\n'
    });

    const state = stateMgr.getState();
    expect(state.workflow.activePhase).toBe('architecture');
    expect(state.workflow.phases['architecture'].status).toBe('in_progress');
  });

  it('does not advance when advance:false is passed (CLI advances after checkpoint accept)', async () => {
    await approveArtifact({
      projectPath: tmpDir,
      stateManager: stateMgr,
      specialistId: 'conops',
      content: '# CONOPS\ncli draft\n',
      advance: false
    });

    expect(stateMgr.getState().workflow.activePhase).toBe('conops');
  });
});

describe('harvestDecisionLog moved to core', () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts Design Decisions from docs/{ID}.md into DECISIONS.md', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-core-decision-'));
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, 'ICD.md'),
      '# ICD\n## Design Decisions\n### D-700: CAN Bus\n- **Decision:** CAN at 500kbps\n## 2.\nnext\n',
      'utf-8'
    );

    expect(harvestDecisionLog(tmpDir, 'icd')).toBe(1);
    const content = fs.readFileSync(path.join(docsDir, 'DECISIONS.md'), 'utf-8');
    expect(content).toContain('D-700');
  });
});

describe('parseAffectedPhaseIds', () => {
  it('extracts docs/*.md references from a change-impact report into canonical phase ids', () => {
    const report = [
      '## Change Impact Analysis',
      '',
      '**Affected documents:**',
      '| Document | Status | Action Needed |',
      '|---|---|---|',
      '| docs/ARCHITECTURE.md | ✅ Up to date | No change |',
      '| docs/ICD.md | ❌ Needs update | Interfaces changed |',
      '| docs/REQUIREMENTS.md | ❌ Needs update | Thresholds changed |',
      '| docs/RISK_REGISTER.md | ⚠ Review | Risk wording |',
      ''
    ].join('\n');

    expect(parseAffectedPhaseIds(report)).toEqual(['architecture', 'icd', 'requirements', 'risk-register']);
  });

  it('returns an empty array for a report without doc references', () => {
    expect(parseAffectedPhaseIds('Everything up to date.')).toEqual([]);
  });
});