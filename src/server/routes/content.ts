import fs from 'node:fs';
import path from 'node:path';
import { SpecialistRegistry } from '../../specialists/registry.js';
import { createVersionBackup } from '../../util/version-backup.js';
import { addPortalItem } from '../../core/question-portal.js';
import { parseBomDocument } from '../parsers/bom-parser.js';
import { updateBomItemInMarkdown, BomItemPatch } from '../parsers/bom-updater.js';
import { parseTradeStudyDocument } from '../parsers/trade-study-parser.js';
import { parseWorkInstruction, toggleWorkInstructionStep, postStepComment, toggleStepFlag } from '../parsers/actions-parser.js';
import { saveExample, MAX_FILE_SIZE } from '../../workspace/project-files.js';
import {
  readJsonBody,
  ok,
  fail,
  safeReadFile,
  MIME_TYPES,
  listWorkInstructions,
  findWorkInstructionFile,
  buildIssues,
  buildIssuePrompt,
  RouteModule
} from './kit.js';

export const contentModule: RouteModule = {
  name: 'content',
  match: (url, segments) =>
    ['trade-study', 'bom', 'actions', 'issues', 'artifacts', 'examples'].includes(segments[1]),
  handle: async (deps, req, res, url, segments) => {
    const method = (req.method ?? 'GET').toUpperCase();
    // --- Trade Study --------------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/trade-study') {
      const content = safeReadFile(path.join(deps.projectPath, 'docs', 'TRADE_STUDY.md'));
      if (!content) return ok(res, []);
      return ok(res, parseTradeStudyDocument(content));
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
      const updates: BomItemPatch = {};
      if (body.qty !== undefined) updates.qty = Number(body.qty);
      if (body.tracking !== undefined) updates.tracking = String(body.tracking);
      if (body.status !== undefined) updates.status = String(body.status);
      if (body.actualTotal !== undefined) updates.actualTotal = body.actualTotal === null ? null : Number(body.actualTotal);
      if (body.description !== undefined) updates.description = String(body.description);
      if (body.source !== undefined) updates.source = String(body.source);
      if (body.estUnit !== undefined) updates.estUnit = body.estUnit === null ? null : Number(body.estUnit);
      try {
        const updated = updateBomItemInMarkdown(content, decodeURIComponent(segments[3]), updates);
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


    if (method === 'POST' && segments[0] === 'api' && segments[1] === 'examples' && segments[2]) {
      const specialistId = decodeURIComponent(segments[2]);
      const specRegistry = deps.specialistRegistry ?? new SpecialistRegistry();
      if (!specRegistry.get(specialistId)) {
        return fail(res, 404, `Specialist "${specialistId}" not found`);
      }

      const body = await readJsonBody(req);
      const filename = String(body.filename ?? '').trim();
      const contentBase64 = String(body.contentBase64 ?? '').trim();
      if (!filename || !contentBase64) {
        return fail(res, 400, 'filename and contentBase64 are required');
      }

      const buffer = Buffer.from(contentBase64, 'base64');
      if (buffer.length > MAX_FILE_SIZE) {
        return fail(res, 413, 'File exceeds maximum 10MB limit');
      }

      try {
        const saved = await saveExample(deps.projectPath, specialistId, filename, buffer);
        return ok(res, { path: saved.savedPath, filename: saved.filename });
      } catch (err: any) {
        return fail(res, 400, err?.message ?? 'Failed to save example');
      }
    }

    // --- Action comments & flags -----------------------------------------------
    if (segments[1] === 'actions' && segments.length === 4 && segments[3] === 'comments' && method === 'POST') {
      const actionId = decodeURIComponent(segments[2]);
      const found = findWorkInstructionFile(deps, actionId);
      if (!found) return fail(res, 404, `Work instruction for ${actionId} not found`);

      const body = await readJsonBody(req);
      const stepId = Number(body.stepId);
      const text = String(body.text ?? '').trim();
      if (!Number.isInteger(stepId) || stepId < 0) return fail(res, 400, 'stepId must be a non-negative integer');
      if (!text) return fail(res, 400, 'text is required');

      // Persist the comment into the work instruction's annotations block
      try {
        const updated = postStepComment(found.content, stepId, text);
        createVersionBackup(deps.projectPath, found.filePath);
        fs.writeFileSync(found.filePath, updated, 'utf-8');
        const persisted = parseWorkInstruction(updated);
        return ok(res, { comments: persisted.stepAnnotations?.[String(stepId)]?.comments ?? [] });
      } catch (err: any) {
        return fail(res, 400, err?.message ?? 'Comment failed');
      }
    }

    if (segments[1] === 'actions' && segments.length === 4 && segments[3] === 'flags' && method === 'POST') {
      const actionId = decodeURIComponent(segments[2]);
      const found = findWorkInstructionFile(deps, actionId);
      if (!found) return fail(res, 404, `Work instruction for ${actionId} not found`);

      const body = await readJsonBody(req);
      const stepId = Number(body.stepId);
      const flagged = Boolean(body.flagged);
      if (!Number.isInteger(stepId) || stepId < 0) return fail(res, 400, 'stepId must be a non-negative integer');

      // If flagged, create a portal item first (this saves state)
      if (flagged) {
        addPortalItem(deps.stateManager, {
          type: 'flag',
          severity: 'normal',
          docPath: found.filePath,
          title: `Flag: ${actionId} Step ${stepId + 1}`,
          detail: body.reason || 'Flagged on shop floor',
          source: 'shop-floor'
        });
      }

      // Persist the flag into the work instruction's annotations block
      try {
        const updated = toggleStepFlag(found.content, stepId, flagged);
        createVersionBackup(deps.projectPath, found.filePath);
        fs.writeFileSync(found.filePath, updated, 'utf-8');
        return ok(res, { flagged, stepId });
      } catch (err: any) {
        return fail(res, 400, err?.message ?? 'Flag update failed');
      }
    }
  }
};
