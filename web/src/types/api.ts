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

export const BOM_STATUSES = ['Identified', 'Ordered', 'Shipped', 'Received', 'Bench Tested', 'Consumed'] as const;

export interface CharterSection {
  heading: string;
  body: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
}

export interface ProjectsResponse {
  projects: ProjectRecord[];
  activeId: string;
}

export interface FolderEntry {
  name: string;
  path: string;
  isProject: boolean;
}

export interface FolderListingResponse {
  currentPath: string;
  parentPath: string | null;
  folders: FolderEntry[];
}

export interface LibraryFileEntry {
  name: string;
  size: number;
  modified: string;
}

export interface LibraryListing {
  references: LibraryFileEntry[];
  examples: Record<string, LibraryFileEntry[]>;
}

export interface ProjectInfo {
  id: string;
  name: string;
  activePhase: string;
  summary: string;
  summarySource: 'conops' | 'intake' | 'none';
  charter?: CharterSection[];
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

export interface StepComment {
  text: string;
  at: string;
  author?: string;
}

export interface StepAnnotations {
  [stepId: string]: {
    comments?: StepComment[];
    flagged?: boolean;
  };
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
  stepAnnotations?: StepAnnotations;
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

export interface PortalAnswerHistoryEntry {
  text: string;
  at: string;
}

/**
 * Free-form metadata map on a portal item. Mirrors src/workspace/types.ts
 * (web does not import core sources); keep the two definitions in sync.
 */
export interface PortalItemMeta extends Record<string, unknown> {
  archived?: boolean;
  /** §3 board #52 — saved answers, appended server-side each time an answer applies. */
  answerHistory?: PortalAnswerHistoryEntry[];
  /** Board #53B — answer is pending in the server answer queue (in-memory only). */
  answerQueued?: boolean;
}

export interface PortalItem {
  id: string;
  type: 'question' | 'parked' | 'flag' | 'nonconformance';
  severity: 'blocking' | 'normal';
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
  meta?: PortalItemMeta;
}

export interface AutopilotStatusResponse {
  enabled: boolean;
  running: boolean;
  currentPhaseId?: string;
  docStatus: Record<string, string>;
  blocks: number;
  passedCount: number;
  totalPhases: number;
}

export interface PortalListResponse {
  items: PortalItem[];
}

/** POST /api/portal/:id/answer — 200 {applied} when idle, 202 {queued} when busy. */
export type PortalAnswerResult = { queued: true } | { applied: true };

/** Per-item answer-queue state machine (§1.2). Shared by DevelopmentView + QuestionPanel. */
export type AnswerPhase = 'queued' | 'applying' | 'applied' | 'failed';
export interface AnswerState {
  phase: AnswerPhase;
  error?: string;
}

export interface DashboardData {
  project: ProjectInfo;
  roadmap: RoadmapPhase[];
  issues: ProjectIssue[];
  recentActions: string[];
  documents: Array<{ phaseId: string; path: string; sizeBytes: number; modifiedAt: string }>;
  portalSummary?: {
    blocking: number;
    parked: number;
    questions: number;
    flags: number;
    topItems: PortalItem[];
  };
}

export interface DocData {
  phaseId: string;
  path: string;
  content: string;
  status: string;
}

/** GET /api/docs/:phaseId/diff — raw approved-vs-current strings for the
 * revised-doc diff view (hunks computed client-side). */
export interface DocDiff {
  phaseId: string;
  approved: string | null;
  current: string;
  approvedAvailable: boolean;
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

export type ModelRole = 'drafting' | 'critic' | 'classifier' | 'compaction' | 'transcriber';

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

export type SearchProvider = 'openrouter' | 'tavily' | 'brave';

export interface SearchSettings {
  provider: SearchProvider;
  hasTavilyKey: boolean;
  hasBraveKey: boolean;
}

/** Speech-to-text model option (voice dictation). */
export interface TranscriptionModel {
  id: string;
  name: string;
  description?: string;
  pricingFormatted?: string;
}

export interface Settings {
  providers: ProviderView[];
  assignments: Assignments;
  transcriptionEnabled: boolean;
  /** Speech-to-text model for voice dictation. */
  voiceInputModel?: string;
  autopilotEnabled: boolean;
  port: number;
  projectPath: string;
  search?: SearchSettings;
  probe?: { ok: boolean; detail: string };
}

export interface SettingsUpdate {
  providers?: ProviderInput[];
  assignments?: Partial<Assignments>;
  transcriptionEnabled?: boolean;
  voiceInputModel?: string;
  autopilotEnabled?: boolean;
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
  | { event: 'error'; data: { message: string } }
  | { event: 'autopilot'; data: { status: AutopilotStatusResponse } }
  | { event: 'question'; data: { item: PortalItem } };
