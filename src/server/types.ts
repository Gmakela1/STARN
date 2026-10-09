import { CriticResult } from '../core/critic.js';
import { BomFinancials, BomItem } from './parsers/bom-parser.js';
import { ParsedWorkInstruction } from './parsers/actions-parser.js';
import { ProjectIssue } from './parsers/issues-parser.js';

/** Uniform JSON envelope returned by every /api endpoint. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface ProjectInfoResponse {
  id: string;
  name: string;
  activePhase: string;
  summary: string;
  openQuestionsCount: number;
  openRisksCount: number;
  models: {
    agent: string;
    critic?: string;
    compaction?: string;
    digitalTwin?: string;
  };
  financials: BomFinancials;
}

export interface RoadmapPhaseResponse {
  id: string;
  name: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'PENDING_REVIEW' | 'PENDING' | 'LOCKED';
  artifactPath: string;
  contentHash: string | null;
  criticScore?: number;
  docExists: boolean;
  openQuestions: number;
}

export interface DashboardResponse {
  project: ProjectInfoResponse;
  roadmap: RoadmapPhaseResponse[];
  issues: ProjectIssue[];
  recentActions: string[];
  documents: Array<{ phaseId: string; path: string; sizeBytes: number; modifiedAt: string }>;
}

export interface BomResponse {
  items: BomItem[];
  financials: BomFinancials;
  tradeStudy: string | null;
}

export interface DocResponse {
  phaseId: string;
  path: string;
  content: string;
  status: string;
}

export interface PendingCheckpointResponse {
  specialistId: string;
  specialistName: string;
  output: string;
  criticResult?: CriticResult;
  createdAt: string;
}

export interface ActionSummaryResponse extends ParsedWorkInstruction {
  /** Relative path of the backing file, e.g. docs/work_instructions/... */
  filePath: string;
}

export interface SettingsResponse {
  agentModel: string;
  criticModel?: string;
  compactionModel?: string;
  digitalTwinModel?: string;
  digitalTwinProvider?: 'openrouter' | 'local';
  digitalTwinBaseUrl?: string;
  port: number;
  projectPath: string;
}
