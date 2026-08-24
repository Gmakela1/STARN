export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface RegistryData {
  activeProjectId: string | null;
  defaultModel: string;
  projects: ProjectRecord[];
}

export interface ArtifactRecord {
  id: string;
  title: string;
  path: string;
  status: 'draft' | 'approved' | 'rejected';
  criticScore?: number;
  updatedAt: string;
}

export interface DiscoveryState {
  lastScanned: string | null;
  summary: string;
  keyConstraints: string[];
}

export interface IntakeState {
  completed: boolean;
  currentQuestionIndex: number;
  answers: Record<string, string>;
}

export type PhaseStatus = 'pending' | 'in_progress' | 'approved' | 'locked';

export interface WorkflowPhaseInfo {
  id: string;
  name: string;
  status: PhaseStatus;
  artifactPath: string;
  updatedAt: string | null;
}

export interface WorkflowState {
  activePhase: string;
  phases: Record<string, WorkflowPhaseInfo>;
}

export interface ProjectState {
  projectId: string;
  name: string;
  currentPhase: string;
  discovery: DiscoveryState;
  intake: IntakeState;
  workflow: WorkflowState;
  artifacts: ArtifactRecord[];
  openRisks: string[];
  recentActions: string[];
}
