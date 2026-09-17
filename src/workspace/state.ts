import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProjectState, ArtifactRecord, IntakeState, WorkflowState, PendingRisk } from './types.js';

export interface WorkflowPhaseDef {
  id: string;
  name: string;
  artifactPath: string;
}

export const ORDERED_WORKFLOW_PHASES: WorkflowPhaseDef[] = [
  { id: 'conops', name: 'CONOPS / User Intent', artifactPath: 'docs/CONOPS.md' },
  { id: 'architecture', name: 'System Architecture & Subsystems', artifactPath: 'docs/ARCHITECTURE.md' },
  { id: 'icd', name: 'Interface Control Document (ICD)', artifactPath: 'docs/ICD.md' },
  { id: 'capabilities', name: 'Product Capabilities', artifactPath: 'docs/CAPABILITIES.md' },
  { id: 'requirements', name: 'System Requirements', artifactPath: 'docs/REQUIREMENTS.md' },
  { id: 'bom', name: 'Bill of Materials (BOM)', artifactPath: 'docs/BOM.md' },
  { id: 'rtm', name: 'Requirements Traceability Matrix (RTM)', artifactPath: 'docs/RTM.md' },
  { id: 'milestones', name: 'Project Milestones & Gating', artifactPath: 'docs/MILESTONES.md' },
  { id: 'risk-register', name: 'Risk Register', artifactPath: 'docs/RISK_REGISTER.md' },
  { id: 'build-sequence', name: 'Build Sequence & Assembly Planning', artifactPath: 'docs/build_sequences/BUILD_SEQUENCE_{GATE}.md' },
  { id: 'testplans', name: 'Test Plans & Procedures', artifactPath: 'docs/TEST_PLANS.md' },
  { id: 'sow', name: 'Statement of Work (SOW)', artifactPath: 'docs/SOW.md' }
];

/**
 * Resolves a phase's artifactPath (which may contain a {GATE} template,
 * e.g. build sequences) to concrete file paths within the project.
 */
export function resolveArtifactPaths(projectPath: string, artifactPath: string): string[] {
  const full = path.join(projectPath, artifactPath);
  if (!artifactPath.includes('{GATE}')) return [full];

  // Template path — glob the directory for concrete build sequence files
  const dir = path.dirname(full);
  const prefix = path.basename(full).split('{GATE}')[0];
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.md'))
      .sort()
      .map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Resolves a user-supplied phase reference (number, id, or name fragment)
 * to a workflow phase definition. Returns null if no match.
 * Examples: "3" -> icd, "bom" -> bom, "risk" -> risk-register
 */
export function resolvePhaseRef(ref: string): WorkflowPhaseDef | null {
  const trimmed = ref.trim().toLowerCase();
  if (!trimmed) return null;

  // Numeric reference (1-based index into the ordered phases)
  const asNum = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(asNum) && String(asNum) === trimmed) {
    if (asNum >= 1 && asNum <= ORDERED_WORKFLOW_PHASES.length) {
      return ORDERED_WORKFLOW_PHASES[asNum - 1];
    }
    return null;
  }

  // Exact id match
  const exact = ORDERED_WORKFLOW_PHASES.find(p => p.id === trimmed);
  if (exact) return exact;

  // Name fragment match
  const fragment = ORDERED_WORKFLOW_PHASES.find(p =>
    p.name.toLowerCase().includes(trimmed) || p.id.includes(trimmed)
  );
  return fragment || null;
}

function createDefaultWorkflow(artifacts: ArtifactRecord[] = []): WorkflowState {
  const phasesMap: Record<string, any> = {};
  for (let i = 0; i < ORDERED_WORKFLOW_PHASES.length; i++) {
    const p = ORDERED_WORKFLOW_PHASES[i];
    const isApproved = artifacts.some(
      a => (a.id.toUpperCase() === p.id.toUpperCase() || (p.id === 'testplans' && a.id.toUpperCase() === 'TEST_PLANS')) && a.status === 'approved'
    );
    phasesMap[p.id] = {
      id: p.id,
      name: p.name,
      status: isApproved ? 'approved' : (i === 0 ? 'in_progress' : 'pending'),
      artifactPath: p.artifactPath,
      updatedAt: null
    };
  }

  // Find the first non-approved phase
  const firstUnapproved = ORDERED_WORKFLOW_PHASES.find(
    p => phasesMap[p.id].status !== 'approved'
  );

  return {
    activePhase: firstUnapproved ? firstUnapproved.id : 'conops',
    phases: phasesMap
  };
}

export class ProjectStateManager {
  private projectPath: string;
  private stateFilePath: string;

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
    this.stateFilePath = path.join(this.projectPath, '.starn', 'state.json');
  }

  public scaffoldProjectDirectories(): void {
    const docsDir = path.join(this.projectPath, 'docs');
    const refDir = path.join(this.projectPath, 'reference');
    const examplesDir = path.join(this.projectPath, 'examples');

    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    if (!fs.existsSync(refDir)) {
      fs.mkdirSync(refDir, { recursive: true });
      const refReadme = path.join(refDir, 'README.md');
      if (!fs.existsSync(refReadme)) {
        fs.writeFileSync(
          refReadme,
          `# Project Reference Documents\n\nDrop any user-provided reference files here:\n- Component spec sheets & datasheets\n- Interface Control Documents (ICDs)\n- Donor vehicle / machine manuals & schematics\n- Engineering calculations & CAD notes\n\nSTARN will automatically discover and inspect these files when assisting you.\n`,
          'utf-8'
        );
      }
    }

    if (!fs.existsSync(examplesDir)) fs.mkdirSync(examplesDir, { recursive: true });
    for (const p of ORDERED_WORKFLOW_PHASES) {
      const subExDir = path.join(examplesDir, p.id);
      if (!fs.existsSync(subExDir)) {
        fs.mkdirSync(subExDir, { recursive: true });
      }
    }
  }

  public getOrCreateState(projectId: string, name: string): ProjectState {
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.scaffoldProjectDirectories();

    if (fs.existsSync(this.stateFilePath)) {
      const state = this.getState();
      let changed = false;
      if (!state.intake) {
        state.intake = {
          completed: state.artifacts.some(a => a.id === 'CONOPS' && a.status === 'approved'),
          currentQuestionIndex: 0,
          answers: {}
        };
        changed = true;
      }
      if (!state.workflow) {
        state.workflow = createDefaultWorkflow(state.artifacts || []);
        changed = true;
      }
      const migrated = this.migrateLegacyRisks(state);
      if (migrated) {
        changed = true;
      }
      if (changed) {
        this.saveState(state);
      }
      return state;
    }

    const initialState: ProjectState = {
      projectId,
      name,
      currentPhase: 'conops',
      discovery: {
        lastScanned: null,
        summary: '',
        keyConstraints: []
      },
      intake: {
        completed: false,
        currentQuestionIndex: 0,
        answers: {}
      },
      workflow: createDefaultWorkflow([]),
      artifacts: [],
      openRisks: [],
      recentActions: []
    };

    this.saveState(initialState);
    return initialState;
  }

  public getState(): ProjectState {
    if (!fs.existsSync(this.stateFilePath)) {
      throw new Error(`Project state not found at ${this.stateFilePath}`);
    }
    const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as ProjectState;
    if (!parsed.intake) {
      parsed.intake = {
        completed: parsed.artifacts?.some(a => a.id === 'CONOPS' && a.status === 'approved') || false,
        currentQuestionIndex: 0,
        answers: {}
      };
    }
    if (!parsed.workflow) {
      parsed.workflow = createDefaultWorkflow(parsed.artifacts || []);
    }
    this.migrateLegacyRisks(parsed);
    return parsed;
  }

  /**
   * Migrates legacy `openRisks: string[]` entries into the structured
   * `pendingRisks: PendingRisk[]` store. Idempotent: only migrates risks
   * not already present (matched by risk text). Returns true if any
   * migration occurred. Clears `openRisks` after migration.
   */
  private migrateLegacyRisks(state: ProjectState): boolean {
    let changed = false;
    if (state.openRisks && state.openRisks.length > 0) {
      if (!state.pendingRisks) {
        state.pendingRisks = [];
      }
      const existingRisks = new Set((state.pendingRisks || []).map(r => r.risk));
      for (const legacyRisk of state.openRisks) {
        if (!existingRisks.has(legacyRisk)) {
          state.pendingRisks.push({
            source: 'legacy',
            section: 'unknown',
            risk: legacyRisk
          });
          changed = true;
        }
      }
      state.openRisks = [];
      changed = true;
    }
    if (!state.pendingRisks) {
      state.pendingRisks = [];
    }
    return changed;
  }

  public addPendingRisk(risk: PendingRisk): void {
    const state = this.getState();
    if (!state.pendingRisks) {
      state.pendingRisks = [];
    }
    state.pendingRisks.push(risk);
    this.saveState(state);
  }

  public saveState(state: ProjectState): void {
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  public setActivePhase(phaseId: string): void {
    const state = this.getState();
    if (state.workflow.phases[phaseId]) {
      state.workflow.activePhase = phaseId;
      state.currentPhase = phaseId;
      if (state.workflow.phases[phaseId].status === 'pending') {
        state.workflow.phases[phaseId].status = 'in_progress';
      }
      this.saveState(state);
    }
  }

  public advanceToNextPhase(): string | null {
    const state = this.getState();
    const currentIdx = ORDERED_WORKFLOW_PHASES.findIndex(p => p.id === state.workflow.activePhase);
    if (currentIdx === -1 || currentIdx >= ORDERED_WORKFLOW_PHASES.length - 1) {
      return null;
    }

    const next = ORDERED_WORKFLOW_PHASES[currentIdx + 1];
    state.workflow.activePhase = next.id;
    state.currentPhase = next.id;
    if (state.workflow.phases[next.id].status === 'pending') {
      state.workflow.phases[next.id].status = 'in_progress';
    }
    this.saveState(state);
    return next.id;
  }

  public recordIntakeAnswer(key: string, answer: string): void {
    const state = this.getState();
    state.intake.answers[key] = answer;
    this.saveState(state);
  }

  public incrementIntakeQuestion(): void {
    const state = this.getState();
    state.intake.currentQuestionIndex += 1;
    this.saveState(state);
  }

  public completeIntake(): void {
    const state = this.getState();
    state.intake.completed = true;
    this.saveState(state);
  }

  public isArtifactApproved(id: string): boolean {
    const state = this.getState();
    const normalized = id.toUpperCase().replace(/_/g, '').replace(/-/g, '');
    return state.artifacts.some(
      a => a.id.toUpperCase().replace(/_/g, '').replace(/-/g, '') === normalized && a.status === 'approved'
    );
  }

  public updateDiscoverySummary(summary: string, keyConstraints: string[] = []): void {
    const state = this.getState();
    state.discovery = {
      lastScanned: new Date().toISOString(),
      summary,
      keyConstraints
    };
    this.saveState(state);
  }

  public recordArtifact(artifact: Omit<ArtifactRecord, 'updatedAt'>): void {
    const state = this.getState();
    const index = state.artifacts.findIndex(a => a.id === artifact.id);
    const fullRecord: ArtifactRecord = {
      ...artifact,
      updatedAt: new Date().toISOString()
    };

    // On approval, compute and store a SHA-256 content hash so re-approvals
    // can detect whether the document actually changed.
    if (artifact.status === 'approved') {
      const hash = this.computeContentHash(this.projectPath, artifact.path);
      if (hash) {
        fullRecord.approvedContentHash = hash;
      }
    }

    if (index >= 0) {
      state.artifacts[index] = fullRecord;
    } else {
      state.artifacts.push(fullRecord);
    }

    // Update workflow phase status if matching
    const phaseKey = artifact.id.toLowerCase().replace(/_/g, '').replace(/-/g, '');
    for (const pKey of Object.keys(state.workflow.phases)) {
      const normalizedPKey = pKey.replace(/_/g, '').replace(/-/g, '');
      if (normalizedPKey === phaseKey) {
        state.workflow.phases[pKey].status = artifact.status === 'approved' ? 'approved' : 'in_progress';
        state.workflow.phases[pKey].updatedAt = fullRecord.updatedAt;
      }
    }

    state.recentActions.push(`Updated artifact ${artifact.id} (${artifact.status})`);
    this.saveState(state);
  }

  public addAction(action: string): void {
    const state = this.getState();
    state.recentActions.push(action);
    if (state.recentActions.length > 50) {
      state.recentActions.shift();
    }
    this.saveState(state);
  }

  /**
   * Computes a SHA-256 hash of the file at the given artifact path.
   * Returns null if the file does not exist.
   */
  private computeContentHash(projectPath: string, artifactPath: string): string | null {
    const full = path.join(projectPath, artifactPath);
    if (!fs.existsSync(full)) return null;
    const content = fs.readFileSync(full, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Reverts an approved artifact back to draft and re-locks all downstream
   * workflow phases (transitive closure). The document stays on disk so the
   * user can revise it. Used by the /goto reopen flow.
   */
  public revertArtifactToDraft(artifactId: string): void {
    const state = this.getState();
    const art = state.artifacts.find(a => a.id.toUpperCase() === artifactId.toUpperCase());
    if (!art) return;

    art.status = 'draft';
    art.updatedAt = new Date().toISOString();

    // Revert this phase to in_progress and set it active
    const phaseKey = artifactId.toLowerCase().replace(/_/g, '').replace(/-/g, '');
    if (state.workflow.phases[phaseKey]) {
      state.workflow.phases[phaseKey].status = 'in_progress';
      state.workflow.phases[phaseKey].updatedAt = art.updatedAt;
    }
    state.workflow.activePhase = phaseKey;
    state.currentPhase = phaseKey;

    // Re-lock all downstream phases (transitive closure)
    const idx = ORDERED_WORKFLOW_PHASES.findIndex(p => p.id === phaseKey);
    if (idx !== -1) {
      for (let i = idx + 1; i < ORDERED_WORKFLOW_PHASES.length; i++) {
        const downstreamId = ORDERED_WORKFLOW_PHASES[i].id;
        if (state.workflow.phases[downstreamId]) {
          state.workflow.phases[downstreamId].status = 'pending';
          state.workflow.phases[downstreamId].updatedAt = null;
        }
      }
    }

    state.recentActions.push(`Reverted ${artifactId} to draft (downstream re-locked)`);
    this.saveState(state);
  }

  /**
   * Returns true if the document on disk differs from the content hash
   * stored at the time of the last approval. Used to detect re-approvals
   * with actual content changes (triggers auto change-impact).
   */
  public hasContentChangedSinceApproval(artifactId: string): boolean {
    const state = this.getState();
    const art = state.artifacts.find(a => a.id.toUpperCase() === artifactId.toUpperCase());
    if (!art || !art.approvedContentHash) return false;
    const currentHash = this.computeContentHash(this.projectPath, art.path);
    if (!currentHash) return false;
    return currentHash !== art.approvedContentHash;
  }
}
