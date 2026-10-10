/**
 * Typed API models mirroring src/server/types.ts on the backend.
 * The web UI communicates strictly through these JSON contracts.
 */

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface BomFinancials {
  totalEstimated: number;
  totalActual: number;
  netVariance: number;
  procurementProgressPercent: number;
}

export interface BomItem {
  id: string;
  description: string;
  subsystem: string;
  qty: number;
  source: string;
  tracking: string;
  status: string;
  estUnit: number | null;
  estTotal: number | null;
  actualTotal: number | null;
  variance: number | null;
}

export const BOM_STATUSES = ['Identified', 'Ordered', 'Shipped', 'Received', 'Bench Tested'] as const;

export interface ProjectInfo {
  id: string;
  name: string;
  activePhase: string;
  summary: string;
  summarySource: 'conops' | 'intake' | 'none';
  openQuestionsCount: number;
  openRisksCount: number;
  models: {
    agent: string;
    critic?: string;
    compaction?: string;
  };
  financials: BomFinancials;
}

export type RoadmapStatus = 'COMPLETED' | 'IN_PROGRESS' | 'PENDING_REVIEW' | 'PENDING' | 'LOCKED';

export interface RoadmapPhase {
  id: string;
  name: string;
  status: RoadmapStatus;
  artifactPath: string;
  contentHash: string | null;
  criticScore?: number;
  docExists: boolean;
  openQuestions: number;
}

export interface CriticResult {
  passed: boolean;
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  actionableGuidance: string;
}

export interface PendingCheckpoint {
  specialistId: string;
  specialistName: string;
  output: string;
  criticResult?: CriticResult;
  createdAt: string;
}

export interface WorkInstructionStep {
  index: number;
  label: string;
  text: string;
  checked: boolean;
  gated: boolean;
  line: number;
}

export interface NonConformanceLog {
  flagStatus: string;
  defectDescription: string;
  defectEvidence: string;
  recommendation: string;
}

export interface WorkInstruction {
  actionId: string;
  title: string;
  status: string;
  milestoneGate: string;
  subsystem: string;
  steps: WorkInstructionStep[];
  artifacts: string[];
  nonConformance: NonConformanceLog;
  fileName?: string;
  filePath: string;
  content?: string;
}

export interface ProjectIssue {
  id: string;
  type: 'non_conformance' | 'open_question';
  title: string;
  description: string;
  source: string;
  evidence?: string;
  subsystem?: string;
  actionId?: string;
}

export interface IssuesSummary {
  issues: ProjectIssue[];
  nonConformanceCount: number;
  openQuestionCount: number;
}

export interface DashboardData {
  project: ProjectInfo;
  roadmap: RoadmapPhase[];
  issues: ProjectIssue[];
  recentActions: string[];
  documents: Array<{ phaseId: string; path: string; sizeBytes: number; modifiedAt: string }>;
}

export interface DocData {
  phaseId: string;
  path: string;
  content: string;
  status: string;
}

export interface BomData {
  items: BomItem[];
  financials: BomFinancials;
  tradeStudy: string | null;
}

export interface TradeStudyCandidate {
  candidate: string;
  specs: string;
  satisfies: 'compliant' | 'warning' | 'non_compliant';
  leadTime: string;
  source: string;
  estPrice: number | null;
}

export interface SubsystemTradeStudy {
  subsystemId: string;
  subsystemName: string;
  requirements: string[];
  candidates: TradeStudyCandidate[];
  rationale: string;
}

export type ModelRole = 'drafting' | 'critic' | 'classifier' | 'compaction';

export interface RoleAssignment {
  providerId: string;
  model: string;
}

export type Assignments = Record<ModelRole, RoleAssignment>;

/** Provider as returned by the API. Keys are never returned. */
export interface ProviderView {
  id: string;
  name: string;
  baseUrl: string;
  hasKey: boolean;
  builtIn: boolean;
}

/** Provider as sent to the API. Omit apiKey to keep the stored key; '' clears it. */
export interface ProviderInput {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
}

export interface Settings {
  providers: ProviderView[];
  assignments: Assignments;
  port: number;
  projectPath: string;
  probe?: { ok: boolean; detail: string };
}

export interface SettingsUpdate {
  providers?: ProviderInput[];
  assignments?: Partial<Assignments>;
}

export interface CheckpointDecisionResult {
  status: 'approved' | 'revision_requested' | 'discarded';
  savedPath?: string;
  revisionPrompt?: string;
}

/** SSE event payloads streamed from POST /api/turns */
export type TurnEvent =
  | { event: 'status'; data: { status: string } }
  | { event: 'tool_call'; data: { tool: string; args: unknown } }
  | { event: 'checkpoint'; data: PendingCheckpoint }
  | {
      event: 'complete';
      data: {
        specialistId: string;
        specialistName: string;
        output: string;
        criticResult?: CriticResult;
        requiresReview: boolean;
        aborted: boolean;
      };
    }
  | { event: 'error'; data: { message: string } };
