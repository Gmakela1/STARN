/**
 * Tests for the standardized open-questions system:
 * - Generalized parser (any doc with "## Open Questions", numeric prefix optional)
 * - Document status scanning for the roadmap panel (drafted / open questions / approved)
 * - Slash commands: /help, /goto, /questions
 * - Shared open-questions rules injected into every specialist package
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseOpenQuestionsFromContent,
  parseSection6Questions,
  countOpenQuestions
} from '../src/cli/section6-resolver.js';
import {
  formatWorkflowRoadmap,
  formatHelp,
  formatOpenQuestionsReport
} from '../src/cli/ui.js';
import {
  ORDERED_WORKFLOW_PHASES,
  resolveArtifactPaths,
  resolvePhaseRef,
  ProjectStateManager
} from '../src/workspace/state.js';
import { ProjectState } from '../src/workspace/types.js';
import { SpecialistRegistry } from '../src/specialists/registry.js';

// ── Parser generalization ─────────────────────────────────────────────────────

describe('parseOpenQuestionsFromContent — generalized heading matching', () => {
  it('parses CONOPS-style numbered heading (backward compatible)', () => {
    const doc = `# CONOPS\n\n## 6. Open Questions & Items for Clarification\n\n**Q1. Mower deck drive path.** Not confirmed.\n\n**Q2. Charge time.** Not confirmed.\n\n## Design Decisions\nD-001: x`;
    const qs = parseOpenQuestionsFromContent(doc);
    expect(qs).toHaveLength(2);
    expect(qs[0]).toContain('Mower deck');
  });

  it('parses unnumbered "## Open Questions" heading', () => {
    const doc = `# Architecture\n\n## Open Questions\n\n**Q1. System voltage.** 48V or 72V?\n**Why it matters:** affects motor choice.\n\n## 4. Key Design Decisions\nD-001: x`;
    const qs = parseOpenQuestionsFromContent(doc);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toContain('System voltage');
  });

  it('parses other numbered variants like "## 4. Open Questions"', () => {
    const doc = `# ICD\n\n## 4. Open Questions\n\n**Q1. Connector standard?** TBD.\n\n## 5. Next Section\ncontent`;
    expect(parseOpenQuestionsFromContent(doc)).toHaveLength(1);
  });

  it('returns empty for doc without an open questions section', () => {
    const doc = `# Doc\n\n## 1. Stuff\nContent only.`;
    expect(parseOpenQuestionsFromContent(doc)).toHaveLength(0);
  });

  it('parseSection6Questions delegates to the generalized parser', () => {
    const doc = `# Doc\n\n## Open Questions\n\n**Q1. Anything?** Yes.\n`;
    expect(parseSection6Questions(doc)).toHaveLength(1);
  });

  it('stops at the next ## heading even when unnumbered', () => {
    const doc = `# Doc\n\n## Open Questions\n\n**Q1. Real question?** Yes.\n\n## Design Decisions\nD-001: This is not a question.`;
    const qs = parseOpenQuestionsFromContent(doc);
    expect(qs).toHaveLength(1);
    expect(qs[0]).not.toContain('Design Decisions');
  });
});

describe('countOpenQuestions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-oq-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('counts questions in a file with an open questions section', () => {
    const docPath = path.join(tmpDir, 'docs', 'BOM.md');
    fs.writeFileSync(docPath, `# BOM\n\n## Open Questions\n\n**Q1. Voltage?** TBD.\n\n**Q2. Chemistry?** TBD.\n`);
    expect(countOpenQuestions(docPath)).toBe(2);
  });

  it('returns 0 for missing file or doc without questions', () => {
    expect(countOpenQuestions(path.join(tmpDir, 'docs', 'MISSING.md'))).toBe(0);
    const docPath = path.join(tmpDir, 'docs', 'EMPTY.md');
    fs.writeFileSync(docPath, `# Doc\n\n## 1. Section\nNo questions.`);
    expect(countOpenQuestions(docPath)).toBe(0);
  });
});

// ── Artifact path resolution ──────────────────────────────────────────────────

describe('resolveArtifactPaths', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-paths-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the single concrete path for plain artifact paths', () => {
    const [p] = resolveArtifactPaths(tmpDir, 'docs/CONOPS.md');
    expect(p).toBe(path.join(tmpDir, 'docs', 'CONOPS.md'));
  });

  it('expands {GATE} template paths to existing build sequence files', () => {
    const seqDir = path.join(tmpDir, 'docs', 'build_sequences');
    fs.mkdirSync(seqDir, { recursive: true });
    fs.writeFileSync(path.join(seqDir, 'BUILD_SEQUENCE_MVC.md'), '# MVC');
    fs.writeFileSync(path.join(seqDir, 'BUILD_SEQUENCE_IOC.md'), '# IOC');

    const paths = resolveArtifactPaths(tmpDir, 'docs/build_sequences/BUILD_SEQUENCE_{GATE}.md');
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('BUILD_SEQUENCE_IOC.md'); // sorted
    expect(paths[1]).toContain('BUILD_SEQUENCE_MVC.md');
  });

  it('returns empty for {GATE} template with no matching files', () => {
    expect(resolveArtifactPaths(tmpDir, 'docs/build_sequences/BUILD_SEQUENCE_{GATE}.md')).toHaveLength(0);
  });
});

describe('resolvePhaseRef', () => {
  it('resolves 1-based numeric references', () => {
    expect(resolvePhaseRef('1')?.id).toBe('conops');
    expect(resolvePhaseRef('6')?.id).toBe('bom');
  });

  it('resolves exact phase ids', () => {
    expect(resolvePhaseRef('bom')?.id).toBe('bom');
    expect(resolvePhaseRef('risk-register')?.id).toBe('risk-register');
  });

  it('resolves name fragments', () => {
    expect(resolvePhaseRef('risk')?.id).toBe('risk-register');
    expect(resolvePhaseRef('CONOPS')?.id).toBe('conops');
  });

  it('returns null for unknown or empty references', () => {
    expect(resolvePhaseRef('nonexistent')).toBeNull();
    expect(resolvePhaseRef('')).toBeNull();
    expect(resolvePhaseRef('999')).toBeNull();
  });
});

// ── Roadmap panel status display ──────────────────────────────────────────────

function makeState(phaseStatuses: Record<string, string>): ProjectState {
  const phases: any = {};
  for (const p of ORDERED_WORKFLOW_PHASES) {
    phases[p.id] = {
      id: p.id,
      name: p.name,
      status: phaseStatuses[p.id] || 'pending',
      artifactPath: p.artifactPath,
      updatedAt: null
    };
  }
  return {
    id: 'test',
    name: 'Test Project',
    workflow: { activePhase: phaseStatuses['__active__'] || 'conops', phases },
    artifacts: [],
    intake: {} as any
  } as ProjectState;
}

describe('formatWorkflowRoadmap with document scanning', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-roadmap-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shows DRAFTED for a phase with a saved (unapproved) doc', () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), `# CONOPS\n\n## 1. Summary\nDone.`);
    const out = formatWorkflowRoadmap(makeState({ conops: 'in_progress' }), tmpDir);
    expect(out).toContain('DRAFTED');
  });

  it('flags open questions count on the drafted doc', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'CONOPS.md'),
      `# CONOPS\n\n## Open Questions\n\n**Q1. Mower deck drive path?** TBD.\n\n**Q2. Charger placement?** TBD.\n\n**Q3. Display scope?** TBD.`
    );
    const out = formatWorkflowRoadmap(makeState({ conops: 'in_progress' }), tmpDir);
    expect(out).toContain('3 OPEN QUESTIONS');
  });

  it('uses singular for one open question', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'CONOPS.md'),
      `# CONOPS\n\n## Open Questions\n\n**Q1. Mower deck drive path?** TBD.`
    );
    const out = formatWorkflowRoadmap(makeState({ conops: 'in_progress' }), tmpDir);
    expect(out).toContain('1 OPEN QUESTION ');
  });

  it('shows APPROVED for approved phases and PENDING for untouched ones', () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), `# CONOPS\nDone.`);
    const out = formatWorkflowRoadmap(
      makeState({ conops: 'approved', __active__: 'architecture' }),
      tmpDir
    );
    expect(out).toContain('APPROVED');
    expect(out).toContain('PENDING');
  });

  it('keeps legacy rendering (no DRAFTED state) when no projectPath is given', () => {
    const out = formatWorkflowRoadmap(makeState({ conops: 'in_progress' }));
    expect(out).not.toContain('DRAFTED');
    expect(out).toContain('IN PROGRESS');
  });

  it('footer lists the real commands', () => {
    const out = formatWorkflowRoadmap(makeState({}), tmpDir);
    expect(out).toContain('/plan');
    expect(out).toContain('/questions');
    expect(out).toContain('/goto');
    expect(out).toContain('/help');
    expect(out).not.toContain('/next');
  });
});

// ── Help & open-questions report ──────────────────────────────────────────────

describe('formatHelp', () => {
  it('lists all slash commands with explanations', () => {
    const out = formatHelp();
    for (const cmd of ['/plan', '/roadmap', '/status', '/questions', '/goto', '/help', '/voice']) {
      expect(out).toContain(cmd);
    }
    expect(out).toContain('roadmap');
    expect(out).toContain('open questions');
  });
});

describe('formatOpenQuestionsReport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-report-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists open questions grouped by document', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'CONOPS.md'),
      `# CONOPS\n\n## Open Questions\n\n**Q1. Deck drive path choice?** TBD.`
    );
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'BOM.md'),
      `# BOM\n\n## Open Questions\n\n**Q1. System voltage conflict?** TBD.\n\n**Q2. Battery chemistry choice?** TBD.`
    );

    const out = formatOpenQuestionsReport(makeState({ conops: 'in_progress' }), tmpDir);
    expect(out).toContain('CONOPS / User Intent');
    expect(out).toContain('Q1. Deck drive path choice?');
    expect(out).toContain('Q1. System voltage conflict?');
    expect(out).toContain('Q2. Battery chemistry choice?');
    expect(out).toContain('Total: 3 open question(s)');
  });

  it('shows a clean empty state when no open questions exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'CONOPS.md'), `# CONOPS\n\n## 1. Summary\nComplete.`);
    const out = formatOpenQuestionsReport(makeState({}), tmpDir);
    expect(out).toContain('No open questions found');
  });
});

// ── Specialist registry rules injection ───────────────────────────────────────

describe('Open Questions rules injection', () => {
  it('every document specialist except conops and general includes the shared rules', () => {
    const registry = new SpecialistRegistry();
    for (const pkg of registry.listSpecialists()) {
      if (pkg.id === 'general' || pkg.id === 'conops') continue;
      expect(pkg.systemPrompt, `specialist ${pkg.id} missing Open Questions rules`).toContain('## Open Questions');
      expect(pkg.systemPrompt).toContain('USER ANSWERS TO OPEN QUESTIONS');
    }
  });

  it('CONOPS retains its own richer Section 6 rules and does not get the generic block duplicated', () => {
    const registry = new SpecialistRegistry();
    const conops = registry.get('conops')!;
    expect(conops.systemPrompt).toContain('Open Questions');
    // conops has its own rules with the Q1/Q2 numbered-list instruction
    expect(conops.systemPrompt).toContain('Section 6');
  });

  it('Architecture and BOM use the canonical Open Questions convention', () => {
    const registry = new SpecialistRegistry();
    const arch = registry.get('architecture')!;
    const bom = registry.get('bom')!;
    expect(arch.systemPrompt).toContain('## Open Questions');
    expect(arch.systemPrompt).not.toContain('Key Design Decisions (Open)');
    expect(bom.systemPrompt).toContain('## Open Questions');
    expect(bom.systemPrompt).not.toContain('Design Decisions Required');
  });
});

// ── State manager /goto integration ───────────────────────────────────────────

describe('setActivePhase via /goto flow', () => {
  let tmpDir: string;
  let manager: ProjectStateManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-goto-'));
    manager = new ProjectStateManager(tmpDir);
    manager.getOrCreateState('proj1', 'Test');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('switches the active phase and marks it in_progress', () => {
    manager.setActivePhase('bom');
    const state = manager.getState();
    expect(state.workflow?.activePhase).toBe('bom');
    expect(state.workflow?.phases['bom']?.status).toBe('in_progress');
  });
});
