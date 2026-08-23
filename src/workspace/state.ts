import fs from 'node:fs';
import path from 'node:path';
import { ProjectState, ArtifactRecord, IntakeState } from './types.js';

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
      if (!state.intake) {
        state.intake = {
          completed: state.artifacts.some(a => a.id === 'CONOPS' && a.status === 'approved'),
          currentQuestionIndex: 0,
          answers: {}
        };
        this.saveState(state);
      }
      return state;
    }

    const initialState: ProjectState = {
      projectId,
      name,
      currentPhase: 'discovery',
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
    return parsed;
  }

  public saveState(state: ProjectState): void {
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
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
    return state.artifacts.some(a => a.id.toUpperCase() === id.toUpperCase() && a.status === 'approved');
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
