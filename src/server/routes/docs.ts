import fs from 'node:fs';
import path from 'node:path';
import { resolvePhaseRef, resolveArtifactPaths } from '../../workspace/state.js';
import { createVersionBackup } from '../../util/version-backup.js';
import { approveArtifact } from '../../core/approvals.js';
import { readJsonBody, ok, fail, safeReadFile, RouteModule } from './kit.js';
import { findApprovedBackup } from '../approved-snapshot.js';

export const docsModule: RouteModule = {
  name: 'docs',
  match: (url, segments) => segments[1] === 'docs' && segments.length >= 3,
  handle: async (deps, req, res, url, segments) => {
    const method = (req.method ?? 'GET').toUpperCase();
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

      // Revised-doc diff view: raw strings only, hunks computed client-side.
      if (method === 'GET' && segments[3] === 'diff') {
        const current = docPath ? safeReadFile(docPath) : null;
        if (current === null) return fail(res, 404, `No document on disk for phase ${phase.id}`);
        const artifact = deps.stateManager.getState().artifacts.find(a => a.id === phase.id.toUpperCase());
        const docName = path.basename(phase.artifactPath, path.extname(phase.artifactPath));
        const approved = findApprovedBackup(deps.projectPath, docName, artifact?.approvedContentHash);
        return ok(res, {
          phaseId: phase.id,
          approved,
          current,
          approvedAvailable: approved !== null
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
        // Read the current doc content from disk, then route through the shared
        // core approval primitive: hash detection, change-impact run, and phase
        // advance (web approval parity with the CLI re-approval flow).
        const content = docPath ? safeReadFile(docPath) : null;
        if (content === null) {
          return fail(res, 409, `Document not found on disk at ${phase.artifactPath}. Create or draft it first.`);
        }
        await approveArtifact({
          projectPath: deps.projectPath,
          stateManager: deps.stateManager,
          specialistId: phase.id,
          content,
          runChangeImpact: deps.session
            ? phaseId => deps.session!.runChangeImpactForApproval(phaseId)
            : undefined
        });
        // Design §6 — the autopilot docStatus marker ('passed'|'auto-approved')
        // is the web's "completed, needs approval" signal. User approval
        // resolves that state: clear the marker so the UI shows plain
        // approved. Chain gating is unaffected (prereqs use artifact approval).
        // Board #57 — only re-save when the marker value actually changes;
        // 'idle' or an absent marker is already plain approved (no-op write
        // skipped). Mutate-fresh-then-save is the codebase pattern (getState()
        // re-reads from disk each call; see core/autopilot.ts).
        const postState = deps.stateManager.getState();
        const docStatus = postState.autopilot?.docStatus;
        const marker = docStatus?.[phase.id];
        if (marker === 'passed' || marker === 'auto-approved') {
          docStatus![phase.id] = 'idle';
          deps.stateManager.saveState(postState);
        }
        const artifact = deps.stateManager.getState().artifacts.find(a => a.id === phase.id.toUpperCase());
        return ok(res, { artifact });
      }
    }

  }
};
