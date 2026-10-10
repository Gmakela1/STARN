import type { Assignments } from '../config.js';
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
  /** Human-readable overview: CONOPS Section 1 prose, else intake answer, else empty. */
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

export interface ProviderView {
  id: string;
  name: string;
  baseUrl: string;
  /** True when an API key is stored. Keys are never returned. */
  hasKey: boolean;
  builtIn: boolean;
}

export interface SettingsResponse {
  providers: ProviderView[];
  assignments: Assignments;
  port: number;
  projectPath: string;
  /** Present when the drafting assignment changed: tool-calling probe result. */
  probe?: { ok: boolean; detail: string };
}
