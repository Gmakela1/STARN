import fs from 'node:fs';
import path from 'node:path';
import { ProjectState, ArtifactRecord, IntakeState, WorkflowState } from './types.js';

export const ORDERED_WORKFLOW_PHASES = [
  { id: 'conops', name: 'CONOPS / User Intent', artifactPath: 'docs/CONOPS.md' },
  { id: 'capabilities', name: 'Product Capabilities', artifactPath: 'docs/CAPABILITIES.md' },
  { id: 'requirements', name: 'System Requirements', artifactPath: 'docs/REQUIREMENTS.md' },
  { id: 'rtm', name: 'Requirements Traceability Matrix (RTM)', artifactPath: 'docs/RTM.md' },
  { id: 'milestones', name: 'Project Milestones & Gating', artifactPath: 'docs/MILESTONES.md' },
  { id: 'testplans', name: 'Test Plans & Procedures', artifactPath: 'docs/TEST_PLANS.md' },
  { id: 'wbs', name: 'Work Breakdown Structure (WBS)', artifactPath: 'docs/WBS.md' },
  { id: 'sow', name: 'Statement of Work (SOW)', artifactPath: 'docs/SOW.md' }
];

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

  public getOrCreateState(projectId: string, name: string): ProjectState {
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

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
    return parsed;
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
    const normalized = id.toUpperCase();
    return state.artifacts.some(
      a => (a.id.toUpperCase() === normalized || (normalized === 'TEST_PLANS' && a.id.toUpperCase() === 'TESTPLANS') || (normalized === 'TESTPLANS' && a.id.toUpperCase() === 'TEST_PLANS')) && a.status === 'approved'
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

    if (index >= 0) {
      state.artifacts[index] = fullRecord;
    } else {
      state.artifacts.push(fullRecord);
    }

    // Update workflow phase status if matching
    const phaseKey = artifact.id.toLowerCase().replace(/_/g, '');
    for (const pKey of Object.keys(state.workflow.phases)) {
      if (pKey === phaseKey || pKey === artifact.id.toLowerCase()) {
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
}
