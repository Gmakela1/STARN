import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES, resolveArtifactPaths, resolvePhaseRef } from '../workspace/state.js';
import { countOpenQuestions, parseOpenQuestionsFromContent } from '../core/open-questions-parser.js';
import { createVersionBackup } from '../util/version-backup.js';
import { parseBomDocument, updateBomRow, BomItemUpdate } from './parsers/bom-parser.js';
import { parseWorkInstruction, toggleWorkInstructionStep, ParsedWorkInstruction } from './parsers/actions-parser.js';
import { aggregateProjectIssues, OpenQuestionGroup, ProjectIssue } from './parsers/issues-parser.js';
import { ServerSessionManager } from './session.js';
import {
  ApiEnvelope,
  ProjectInfoResponse,
  RoadmapPhaseResponse,
  ActionSummaryResponse,
  SettingsResponse
} from './types.js';

export interface RouterDeps {
  projectPath: string;
  stateManager: ProjectStateManager;
  session?: ServerSessionManager;
  /** Static assets directory (built web UI). Optional. */
  webDistPath?: string;
  /** Called when settings are saved, so the host can persist them. */
  onSettingsSaved?: (settings: Partial<SettingsResponse>) => void;
  port?: number;
}

const MAX_BODY_BYTES = 30 * 1024 * 1024; // 30 MB (base64 photo uploads)

const MIME_TYPES: Record<string, string> = {
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

function sendJson<T>(res: http.ServerResponse, statusCode: number, envelope: ApiEnvelope<T>): void {
  const body = JSON.stringify(envelope);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function ok<T>(res: http.ServerResponse, data: T): void {
  sendJson(res, 200, { success: true, data, error: null });
}

function fail(res: http.ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { success: false, data: null, error: message });
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
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
// Data assembly helpers
// ---------------------------------------------------------------------------

function safeReadFile(filePath: string): string | null {
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

function buildProjectInfo(deps: RouterDeps): ProjectInfoResponse {
  const state = deps.stateManager.getState();
  let openQuestionsCount = 0;
  for (const phase of ORDERED_WORKFLOW_PHASES) {
    for (const docPath of resolveArtifactPaths(deps.projectPath, phase.artifactPath)) {
      openQuestionsCount += countOpenQuestions(docPath);
    }
  }
  return {
    id: state.projectId,
    name: state.name,
    activePhase: state.workflow?.activePhase || 'conops',
    summary: state.discovery?.summary || '',
    openQuestionsCount,
    openRisksCount: (state.openRisks || []).length,
    models: {
      agent: deps.session?.model ?? '',
      compaction: deps.session?.compactionModel
    },
    financials: getBomFinancials(deps.projectPath)
  };
}

function buildRoadmap(deps: RouterDeps): RoadmapPhaseResponse[] {
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

function listWorkInstructions(deps: RouterDeps): ActionSummaryResponse[] {
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

function findWorkInstructionFile(deps: RouterDeps, actionId: string): { filePath: string; content: string } | null {
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

function buildIssues(deps: RouterDeps) {
  const workInstructions: ParsedWorkInstruction[] = listWorkInstructions(deps);
  return aggregateProjectIssues(workInstructions, collectOpenQuestionGroups(deps));
}

function buildIssuePrompt(issue: ProjectIssue): string {
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
// Route handling
// ---------------------------------------------------------------------------

export async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: RouterDeps
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = (req.method ?? 'GET').toUpperCase();

  try {
    // --- Project & dashboard -------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/project') {
      return ok(res, buildProjectInfo(deps));
    }

    if (method === 'GET' && url.pathname === '/api/roadmap') {
      return ok(res, buildRoadmap(deps));
    }

    if (method === 'GET' && url.pathname === '/api/dashboard') {
      const state = deps.stateManager.getState();
      const roadmap = buildRoadmap(deps);
      const documents = roadmap
        .filter(p => p.docExists)
        .flatMap(p => resolveArtifactPaths(deps.projectPath, p.artifactPath)
          .filter(f => fs.existsSync(f))
          .map(f => {
            const stat = fs.statSync(f);
            return {
              phaseId: p.id,
              path: path.relative(deps.projectPath, f).replace(/\\/g, '/'),
              sizeBytes: stat.size,
              modifiedAt: stat.mtime.toISOString()
            };
          }));
      return ok(res, {
        project: buildProjectInfo(deps),
        roadmap,
        issues: buildIssues(deps).issues,
        recentActions: state.recentActions || [],
        documents
      });
    }

    // --- Turns (SSE) ---------------------------------------------------------
    if (method === 'POST' && url.pathname === '/api/turns') {
      if (!deps.session) return fail(res, 503, 'Agent session unavailable');
      if (deps.session.busy) return fail(res, 409, 'A turn is already in progress');

      const body = await readJsonBody(req);
      const prompt = String(body.prompt ?? '').trim();
      if (!prompt) return fail(res, 400, 'Missing "prompt"');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive'
      });

      const emit = (event: string, data: unknown) => {
        if (!res.writableEnded) {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      };

      // Abort the turn if the browser drops the SSE connection.
      req.on('close', () => {
        if (!res.writableEnded) deps.session?.abortActiveTurn();
      });

      try {
        await deps.session.runTurn(prompt, emit);
      } catch (err: any) {
        emit('error', { message: err?.message ?? 'Turn failed' });
      }
      res.end();
      return;
    }

    if (method === 'POST' && url.pathname === '/api/turns/abort') {
      const aborted = deps.session?.abortActiveTurn() ?? false;
      return ok(res, { aborted });
    }

    // --- Checkpoints ----------------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/checkpoints/pending') {
      return ok(res, deps.session?.getPendingCheckpoint() ?? null);
    }

    if (method === 'POST' && url.pathname === '/api/checkpoints/decision') {
      if (!deps.session) return fail(res, 503, 'Agent session unavailable');
      const body = await readJsonBody(req);
      const decision = String(body.decision ?? '');
      if (!['approve', 'revise', 'discard'].includes(decision)) {
        return fail(res, 400, 'decision must be approve | revise | discard');
      }
      try {
        const result = deps.session.resolveCheckpoint(decision as any, body.feedback);
        return ok(res, result);
      } catch (err: any) {
        return fail(res, 409, err?.message ?? 'No pending checkpoint');
      }
    }

    // --- Documents -----------------------------------------------------------
    if (segments[0] === 'api' && segments[1] === 'docs' && segments.length >= 3) {
      const phase = resolvePhaseRef(segments[2]);
      if (!phase) return fail(res, 404, `Unknown phase: ${segments[2]}`);
      const docPaths = resolveArtifactPaths(deps.projectPath, phase.artifactPath);
      const docPath = docPaths.find(p => fs.existsSync(p)) ?? docPaths[0];

      if (method === 'GET' && segments.length === 3) {
        const content = docPath ? safeReadFile(docPath) : null;
        if (content === null) return fail(res, 404, `No document on disk for phase ${phase.id}`);
        const state = deps.stateManager.getState();
        const artifact = state.artifacts.find(a => a.id === phase.id.toUpperCase());
        return ok(res, {
          phaseId: phase.id,
          path: path.relative(deps.projectPath, docPath).replace(/\\/g, '/'),
          content,
          status: artifact?.status ?? 'draft'
        });
      }

      if (method === 'PUT' && segments.length === 3) {
        if (!docPath) return fail(res, 400, `Phase ${phase.id} has no writable document path`);
        const body = await readJsonBody(req);
        const content = String(body.content ?? '');
        if (!content.trim()) return fail(res, 400, 'Missing "content"');
        fs.mkdirSync(path.dirname(docPath), { recursive: true });
        if (fs.existsSync(docPath)) createVersionBackup(deps.projectPath, docPath);
        fs.writeFileSync(docPath, content, 'utf-8');
        return ok(res, { path: path.relative(deps.projectPath, docPath).replace(/\\/g, '/') });
      }

      if (method === 'POST' && segments[3] === 'approve') {
        const result = deps.stateManager.manualApproveArtifact(phase.id.toUpperCase());
        if (!result.success) return fail(res, 409, result.error ?? 'Approval failed');
        return ok(res, { artifact: result.artifact });
      }
    }

    // --- BOM -----------------------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/bom') {
      const content = safeReadFile(path.join(deps.projectPath, 'docs', 'BOM.md'));
      if (!content) return fail(res, 404, 'docs/BOM.md not found');
      const parsed = parseBomDocument(content);
      const tradeStudy = safeReadFile(path.join(deps.projectPath, 'docs', 'TRADE_STUDY.md'));
      return ok(res, { ...parsed, tradeStudy });
    }

    if (method === 'PATCH' && segments[0] === 'api' && segments[1] === 'bom' && segments[2] === 'items' && segments[3]) {
      const bomPath = path.join(deps.projectPath, 'docs', 'BOM.md');
      const content = safeReadFile(bomPath);
      if (!content) return fail(res, 404, 'docs/BOM.md not found');
      const body = await readJsonBody(req);
      const updates: BomItemUpdate = {};
      if (body.qty !== undefined) updates.qty = Number(body.qty);
      if (body.tracking !== undefined) updates.tracking = String(body.tracking);
      if (body.status !== undefined) updates.status = String(body.status);
      if (body.actualTotal !== undefined) updates.actualTotal = body.actualTotal === null ? null : Number(body.actualTotal);
      try {
        const updated = updateBomRow(content, decodeURIComponent(segments[3]), updates);
        createVersionBackup(deps.projectPath, bomPath);
        fs.writeFileSync(bomPath, updated, 'utf-8');
        return ok(res, parseBomDocument(updated));
      } catch (err: any) {
        return fail(res, 404, err?.message ?? 'Update failed');
      }
    }

    // --- Actions (work instructions) -----------------------------------------
    if (method === 'GET' && url.pathname === '/api/actions') {
      return ok(res, listWorkInstructions(deps));
    }

    if (segments[0] === 'api' && segments[1] === 'actions' && segments[2]) {
      const actionId = decodeURIComponent(segments[2]);

      if (method === 'GET' && segments.length === 3) {
        const found = findWorkInstructionFile(deps, actionId);
        if (!found) return fail(res, 404, `Work instruction for ${actionId} not found`);
        const parsed = parseWorkInstruction(found.content, path.basename(found.filePath));
        return ok(res, {
          ...parsed,
          filePath: path.relative(deps.projectPath, found.filePath).replace(/\\/g, '/'),
          content: found.content
        });
      }

      if (method === 'PATCH' && segments[3] === 'checklist') {
        const found = findWorkInstructionFile(deps, actionId);
        if (!found) return fail(res, 404, `Work instruction for ${actionId} not found`);
        const body = await readJsonBody(req);
        const stepIndex = Number(body.stepIndex);
        const checked = Boolean(body.checked);
        if (!Number.isInteger(stepIndex) || stepIndex < 0) return fail(res, 400, 'stepIndex must be a non-negative integer');
        try {
          const updated = toggleWorkInstructionStep(found.content, stepIndex, checked);
          createVersionBackup(deps.projectPath, found.filePath);
          fs.writeFileSync(found.filePath, updated, 'utf-8');
          return ok(res, parseWorkInstruction(updated, path.basename(found.filePath)));
        } catch (err: any) {
          return fail(res, 400, err?.message ?? 'Toggle failed');
        }
      }
    }

    // --- Issues ----------------------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/issues') {
      return ok(res, buildIssues(deps));
    }

    if (method === 'POST' && segments[0] === 'api' && segments[1] === 'issues' && segments[3] === 'push-to-agent') {
      const issueId = decodeURIComponent(segments[2]);
      const summary = buildIssues(deps);
      const issue = summary.issues.find(i => i.id === issueId);
      if (!issue) return fail(res, 404, `Issue ${issueId} not found`);
      return ok(res, { prompt: buildIssuePrompt(issue), issue });
    }

    // --- Artifacts -------------------------------------------------------------
    if (method === 'POST' && url.pathname === '/api/artifacts/upload') {
      const body = await readJsonBody(req);
      const filename = String(body.filename ?? '');
      const contentBase64 = String(body.contentBase64 ?? '');
      if (!filename || !contentBase64) return fail(res, 400, 'filename and contentBase64 are required');
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return fail(res, 400, 'Invalid filename');
      }
      const artifactsDir = path.join(deps.projectPath, 'artifacts');
      fs.mkdirSync(artifactsDir, { recursive: true });
      const outPath = path.join(artifactsDir, filename);
      fs.writeFileSync(outPath, Buffer.from(contentBase64, 'base64'));
      return ok(res, { path: `artifacts/${filename}` });
    }

    if (method === 'GET' && segments[0] === 'api' && segments[1] === 'artifacts' && segments[2]) {
      const filename = decodeURIComponent(segments[2]);
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return fail(res, 400, 'Invalid filename');
      }
      const filePath = path.join(deps.projectPath, 'artifacts', filename);
      if (!fs.existsSync(filePath)) return fail(res, 404, 'Artifact not found');
      const ext = path.extname(filename).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // --- Settings ---------------------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/settings') {
      return ok(res, {
        agentModel: deps.session?.model ?? '',
        compactionModel: deps.session?.compactionModel,
        port: deps.port ?? 3000,
        projectPath: deps.projectPath
      });
    }

    if (method === 'POST' && url.pathname === '/api/settings') {
      const body = await readJsonBody(req);
      if (body.agentModel && deps.session) deps.session.setModel(String(body.agentModel));
      if (body.compactionModel && deps.session) deps.session.setCompactionModel(String(body.compactionModel));
      deps.onSettingsSaved?.(body);
      return ok(res, {
        agentModel: deps.session?.model ?? '',
        compactionModel: deps.session?.compactionModel,
        port: deps.port ?? 3000,
        projectPath: deps.projectPath
      });
    }

    return fail(res, 404, `Unknown API route: ${method} ${url.pathname}`);
  } catch (err: any) {
    if (!res.headersSent) {
      return fail(res, 500, err?.message ?? 'Internal server error');
    }
    res.end();
  }
}

/** Serves the compiled web UI with an SPA index.html fallback. */
export function handleStaticRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  webDistPath: string
): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let relPath = decodeURIComponent(url.pathname);
  if (relPath === '/' || relPath === '') relPath = '/index.html';

  const resolved = path.resolve(webDistPath, '.' + relPath);
  if (!resolved.startsWith(path.resolve(webDistPath))) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  const target = fs.existsSync(resolved) && fs.statSync(resolved).isFile()
    ? resolved
    : path.join(webDistPath, 'index.html'); // SPA fallback

  if (!fs.existsSync(target)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Web UI not built. Run: npm run build:web');
    return;
  }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
}
