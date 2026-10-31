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
  approvedContentHash?: string;
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

export interface PendingRisk {
  source: string;
  section: string;
  risk: string;
}

export type PortalItemType = 'question' | 'parked' | 'flag' | 'nonconformance';

export type PortalItemSeverity = 'blocking' | 'normal';

/** Board #52 — one applied answer in an item's saved history. */
export interface PortalAnswerHistoryEntry {
  text: string;
  at: string;
}

export interface PortalItem {
  id: string;
  type: PortalItemType;
  severity: PortalItemSeverity;
  docPath?: string;
  section?: string;
  title: string;
  detail?: string;
  gaps?: string[];
  threadId?: string;
  status: 'open' | 'answered' | 'dismissed' | 'resolved';
  answer?: string;
  source: 'autopilot' | 'studio' | 'shop-floor';
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

export interface AutopilotState {
  running: boolean;
  startedAt?: string;
  stoppedAt?: string;
  currentPhaseId?: string;
  docStatus: Record<string, string>;
  revisionsUsed: Record<string, number>;
  blocks: number;
  lastError?: string;
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
  pendingRisks?: PendingRisk[];
  portalItems?: PortalItem[];
  autopilot?: AutopilotState;
}
