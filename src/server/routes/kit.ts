import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES, resolveArtifactPaths } from '../../workspace/state.js';
import { ProjectContext } from '../../workspace/project-context.js';
import { ServerSessionManager } from '../session.js';
import { SpecialistRegistry } from '../../specialists/registry.js';
import { OPENROUTER_PROVIDER_ID, ProviderConfig, loadConfig, autopilotEnabled as configAutopilotEnabled } from '../../config.js';
import { allProviders } from '../../models/role-clients.js';
import { extractConopsOverview, extractConopsCharter, CharterSection } from '../../core/conops-overview.js';
import { countOpenQuestions, parseOpenQuestionsFromContent } from '../../core/open-questions-parser.js';
import { parseBomDocument } from '../parsers/bom-parser.js';
import { parseWorkInstruction, ParsedWorkInstruction } from '../parsers/actions-parser.js';
import { aggregateProjectIssues, OpenQuestionGroup, ProjectIssue } from '../parsers/issues-parser.js';
import type {
  ApiEnvelope,
  ProjectInfoResponse,
  RoadmapPhaseResponse,
  ActionSummaryResponse,
  SettingsResponse,
  SearchSettingsResponse
} from '../types.js';export interface RouterDeps {
  projectPath: string;
  stateManager: ProjectStateManager;
  context?: ProjectContext;
  session?: ServerSessionManager;
  specialistRegistry?: SpecialistRegistry;
  /** Static assets directory (built web UI). Optional. */
  webDistPath?: string;
  /** Called when settings are saved, so the host can persist them. */
  onSettingsSaved?: (settings: { providers: ProviderConfig[]; assignments: SettingsResponse['assignments']; transcriptionEnabled?: boolean; autopilotEnabled?: boolean; voiceInputModel?: string }) => void;
  port?: number;
  /** Autopilot enabled toggle (from config). */
  autopilotEnabled?: boolean;
}

const MAX_BODY_BYTES = 30 * 1024 * 1024; // 30 MB (base64 photo uploads)

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4'
};

export function sendJson<T>(res: http.ServerResponse, statusCode: number, envelope: ApiEnvelope<T>): void {
  const body = JSON.stringify(envelope);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

export function ok<T>(res: http.ServerResponse, data: T): void {
  sendJson(res, 200, { success: true, data, error: null });
}

export function fail(res: http.ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { success: false, data: null, error: message });
}

// ---------------------------------------------------------------------------
// Cross-origin (CSRF) guard
// ---------------------------------------------------------------------------

/** Methods that mutate state; browsers attach an Origin header to cross-site ones. */
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Hostname portion of a Host header like "host:port" / "127.0.0.1:port" / "[::1]:port". */
function hostHeaderHostname(hostHeader: string): string {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * localhost / 127.0.0.1 / [::1] are the same loopback site: the UI can be
 * opened over any of them, so alias them to one identity before comparing.
 */
function isLoopbackAlias(site: string): boolean {
  const normalized = site.replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

/**
 * True when a browser-provided Origin refers to the same site as the request
 * Host. Unparseable or mismatched Origins are rejected (fail closed); absent
 * Origins (curl, scripts) are allowed by the caller.
 */
export function originMatchesHost(origin: string, hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  let originSite: string;
  try {
    originSite = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  const hostSite = hostHeaderHostname(hostHeader);
  if (!hostSite) return false;
  if (originSite === hostSite) return true;
  return isLoopbackAlias(originSite) && isLoopbackAlias(hostSite);
}

export async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Multipart form parser (no external dependencies)
// ---------------------------------------------------------------------------

interface MultipartFile {
  filename: string;
  buffer: Buffer;
  contentType: string;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
}

export function parseMultipartBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=([^;\s]+)/i);
  return match ? match[1] : null;
}

async function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function parseMultipartBody(req: http.IncomingMessage, boundary: string): Promise<MultipartBody> {
  const raw = await readRawBody(req);
  const delimiter = Buffer.from(`--${boundary}`);
  const closing = Buffer.from(`--${boundary}--`);
  const result: MultipartBody = { fields: {}, files: {} };

  let pos = 0;
  while (pos < raw.length) {
    const startIdx = raw.indexOf(delimiter, pos);
    if (startIdx === -1) break;
    const partStart = startIdx + delimiter.length;

    // Check for closing delimiter
    if (raw.slice(partStart, partStart + 2).toString() === '--') break;

    // Find next delimiter
    const endIdx = raw.indexOf(delimiter, partStart);
    if (endIdx === -1) break;

    const part = raw.slice(partStart, endIdx);
    pos = endIdx;

    // Remove trailing \r\n before header section
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;

    const headerBlock = part.subarray(0, headerEnd).toString('utf-8');
    const bodyStart = headerEnd + 4;
    // Strip trailing \r\n from body
    let bodyEnd = part.length;
    if (bodyEnd >= 2 && part[bodyEnd - 1] === 0x0a && part[bodyEnd - 2] === 0x0d) {
      bodyEnd -= 2;
    }
    const partBody = part.subarray(bodyStart, bodyEnd);

    // Parse Content-Disposition
    const dispMatch = headerBlock.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (!dispMatch) continue;

    const fieldName = dispMatch[1];
    const filename = dispMatch[2];
    const contentTypeMatch = headerBlock.match(/Content-Type:\s*(\S+)/i);
    const contentType = contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream';

    if (filename !== undefined) {
      result.files[fieldName] = { filename, buffer: partBody, contentType };
    } else {
      result.fields[fieldName] = partBody.toString('utf-8');
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Data assembly helpers
// ---------------------------------------------------------------------------

export function safeReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function getBomFinancials(projectPath: string) {
  const content = safeReadFile(path.join(projectPath, 'docs', 'BOM.md'));
  if (!content) {
    return { totalEstimated: 0, totalActual: 0, netVariance: 0, procurementProgressPercent: 0 };
  }
  return parseBomDocument(content).financials;
}

export function buildSettings(deps: RouterDeps): SettingsResponse {
  const session = deps.session;
  const providers = session
    ? allProviders(session.apiKey, session.providers).map(p => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        hasKey: Boolean(p.apiKey),
        builtIn: p.id === OPENROUTER_PROVIDER_ID
      }))
    : [];
  let search: SearchSettingsResponse | undefined;
  try {
    const config = loadConfig();
    search = {
      provider: config.search?.provider || 'openrouter',
      hasTavilyKey: Boolean(config.search?.tavilyApiKey),
      hasBraveKey: Boolean(config.search?.braveApiKey)
    };
  } catch {}

  let transcriptionEnabled = true;
  try {
    transcriptionEnabled = loadConfig().transcriptionEnabled;
  } catch {}

  let voiceInputModel: string | undefined;
  try {
    voiceInputModel = loadConfig().voiceInputModel;
  } catch {}
  if (session) voiceInputModel = session.voiceInputModel;

  let autopilotEnabledVal = deps.autopilotEnabled ?? true;
  if (session) {
    autopilotEnabledVal = session.autopilotEnabled;
  } else {
    try {
      autopilotEnabledVal = configAutopilotEnabled({});
    } catch {}
  }

  return {
    providers,
    assignments: session ? session.assignments : ({} as SettingsResponse['assignments']),
    port: deps.port ?? 3000,
    projectPath: deps.projectPath,
    search,
    transcriptionEnabled,
    voiceInputModel,
    autopilotEnabled: autopilotEnabledVal
  };
}

function buildSummary(
  projectPath: string,
  intakeProjectAnswer: string | undefined
): Pick<ProjectInfoResponse, 'summary' | 'summarySource'> {
  const conops = safeReadFile(path.join(projectPath, 'docs', 'CONOPS.md'));
  const overview = conops ? extractConopsOverview(conops) : null;
  if (overview) return { summary: overview, summarySource: 'conops' };
  if (intakeProjectAnswer?.trim()) return { summary: intakeProjectAnswer.trim(), summarySource: 'intake' };
  return { summary: '', summarySource: 'none' };
}

export function buildProjectInfo(deps: RouterDeps): ProjectInfoResponse {
  const state = deps.stateManager.getState();
  let openQuestionsCount = 0;
  for (const phase of ORDERED_WORKFLOW_PHASES) {
    for (const docPath of resolveArtifactPaths(deps.projectPath, phase.artifactPath)) {
      openQuestionsCount += countOpenQuestions(docPath);
    }
  }

  const conopsPath = path.join(deps.projectPath, 'docs', 'CONOPS.md');
  let charter: CharterSection[] = [];
  if (fs.existsSync(conopsPath)) {
    try {
      charter = extractConopsCharter(fs.readFileSync(conopsPath, 'utf-8'));
    } catch {}
  }

  return {
    id: state.projectId,
    name: state.name,
    activePhase: state.workflow?.activePhase || 'conops',
    ...buildSummary(deps.projectPath, state.intake?.answers?.projectName),
    charter,
    openQuestionsCount,
    openRisksCount: (state.openRisks || []).length,
    models: {
      agent: deps.session?.model ?? '',
      compaction: deps.session?.compactionModel
    },
    financials: getBomFinancials(deps.projectPath)
  };
}

export function buildRoadmap(deps: RouterDeps): RoadmapPhaseResponse[] {
  const state = deps.stateManager.getState();
  const phases = state.workflow?.phases || {};
  const activePhase = state.workflow?.activePhase || 'conops';

  return ORDERED_WORKFLOW_PHASES.map(def => {
    const info = phases[def.id];
    const artifact = state.artifacts.find(a => a.id === def.id.toUpperCase());
    const docPaths = resolveArtifactPaths(deps.projectPath, def.artifactPath);

    let docExists = false;
    let openQuestions = 0;
    for (const p of docPaths) {
      openQuestions += countOpenQuestions(p);
      const content = safeReadFile(p);
      if (content && content.trim().length > 0) docExists = true;
    }

    let status: RoadmapPhaseResponse['status'];
    if (info?.status === 'approved') status = 'COMPLETED';
    else if (docExists) status = 'PENDING_REVIEW';
    else if (def.id === activePhase) status = 'IN_PROGRESS';
    else if (info?.status === 'locked') status = 'LOCKED';
    else status = 'PENDING';

    return {
      id: def.id,
      name: def.name,
      status,
      artifactPath: def.artifactPath,
      contentHash: artifact?.approvedContentHash ?? null,
      criticScore: artifact?.criticScore,
      docExists,
      openQuestions
    };
  });
}

export function listWorkInstructions(deps: RouterDeps): ActionSummaryResponse[] {
  const dir = path.join(deps.projectPath, 'docs', 'work_instructions');
  if (!fs.existsSync(dir)) return [];
  const out: ActionSummaryResponse[] = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const content = safeReadFile(path.join(dir, file));
    if (!content) continue;
    const parsed = parseWorkInstruction(content, file);
    out.push({ ...parsed, filePath: `docs/work_instructions/${file}` });
  }
  return out;
}

export function findWorkInstructionFile(deps: RouterDeps, actionId: string): { filePath: string; content: string } | null {
  const dir = path.join(deps.projectPath, 'docs', 'work_instructions');
  if (!fs.existsSync(dir)) return null;
  const normalized = actionId.toUpperCase();
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    if (file.toUpperCase().startsWith(normalized + '-') || file.toUpperCase().startsWith(normalized + '.')) {
      const content = safeReadFile(path.join(dir, file));
      if (content) return { filePath: path.join(dir, file), content };
    }
  }
  return null;
}

function collectOpenQuestionGroups(deps: RouterDeps): OpenQuestionGroup[] {
  const groups: OpenQuestionGroup[] = [];
  for (const phase of ORDERED_WORKFLOW_PHASES) {
    for (const docPath of resolveArtifactPaths(deps.projectPath, phase.artifactPath)) {
      const content = safeReadFile(docPath);
      if (!content) continue;
      const questions = parseOpenQuestionsFromContent(content);
      if (questions.length === 0) continue;
      groups.push({
        phase: phase.id.toUpperCase(),
        file: path.relative(deps.projectPath, docPath).replace(/\\/g, '/'),
        questions
      });
    }
  }
  return groups;
}

export function buildIssues(deps: RouterDeps) {
  const workInstructions: ParsedWorkInstruction[] = listWorkInstructions(deps);
  return aggregateProjectIssues(workInstructions, collectOpenQuestionGroups(deps));
}

export function buildIssuePrompt(issue: ProjectIssue): string {
  if (issue.type === 'non_conformance') {
    return [
      `A hardware non-conformance has been flagged during shop floor execution of ${issue.actionId ?? issue.source}.`,
      ``,
      `Defect description: ${issue.description}`,
      issue.subsystem ? `Affected subsystem: ${issue.subsystem}` : '',
      issue.evidence ? `Evidence photo: ${issue.evidence}` : '',
      `Source work instruction: ${issue.source}`,
      ``,
      `Perform an impact analysis of this defect against the program baseline (ICD interfaces, requirements, risk register) and author the corrective shop repair procedure. If physical rework is required, draft a new versioned work instruction for the rework and update the non-conformance log with your recommendation.`
    ].filter(Boolean).join('\n');
  }
  return [
    `Please help resolve this open builder question from ${issue.source}:`,
    ``,
    `${issue.description}`,
    ``,
    `Provide a clear recommendation and update the document's Open Questions section once resolved.`
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Route module contract (Workstream A)
// ---------------------------------------------------------------------------

export type RouteHandler = (
  deps: RouterDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  segments: string[]
) => Promise<void> | void;

/**
 * A dispatcher slot. match() decides whether the module owns the path; handle()
 * mirrors the old router's sequential if-blocks for that domain and writes a
 * response only for paths it really handled (the dispatcher falls through to
 * the 404 when a matched module writes nothing).
 */
export type RouteModule = { name: string; match: (url: URL, segments: string[]) => boolean; handle: RouteHandler };
