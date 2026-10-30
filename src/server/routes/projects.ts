import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ORDERED_WORKFLOW_PHASES, resolveArtifactPaths } from '../../workspace/state.js';
import { listFolders } from '../../workspace/folder-browser.js';
import { readJsonBody, ok, fail, buildProjectInfo, buildRoadmap, buildIssues, RouteModule } from './kit.js';

export const projectsModule: RouteModule = {
  name: 'projects',
  match: (url, segments) =>
    ['projects', 'fs', 'project', 'roadmap', 'workflow', 'dashboard'].includes(segments[1]),
  handle: async (deps, req, res, url, segments) => {
    const method = (req.method ?? 'GET').toUpperCase();
    // --- Projects & Filesystem Browsing ---------------------------------------
    if (method === 'GET' && url.pathname === '/api/projects') {
      if (!deps.context) {
        return ok(res, {
          projects: [{ id: 'current', name: path.basename(deps.projectPath), path: deps.projectPath }],
          activeId: 'current'
        });
      }
      return ok(res, {
        projects: deps.context.registry.listProjects(),
        activeId: deps.context.record.id
      });
    }

    if (method === 'GET' && url.pathname === '/api/fs/folders') {
      const targetDir = url.searchParams.get('path') || os.homedir();
      const q = url.searchParams.get('q') || undefined;
      try {
        const listing = listFolders(targetDir, q);
        return ok(res, listing);
      } catch (err: any) {
        return fail(res, 400, err?.message ?? 'Failed to list folders');
      }
    }

    if (method === 'POST' && url.pathname === '/api/projects/switch') {
      if (!deps.context) return fail(res, 501, 'Project switching not configured on server');
      if (deps.session?.busy || deps.session?.getPendingCheckpoint()) {
        return fail(res, 409, 'Cannot switch projects while an agent turn is running or pending review.');
      }
      const body = await readJsonBody(req);
      const projectId = body.projectId ? String(body.projectId).trim() : undefined;
      const targetPath = body.path ? String(body.path).trim() : undefined;

      if (!projectId && !targetPath) {
        return fail(res, 400, 'Either projectId or path is required');
      }

      try {
        if (projectId) {
          const project = deps.context.registry.listProjects().find(p => p.id === projectId);
          if (!project) return fail(res, 404, `Project with id "${projectId}" not found`);
          deps.context.switchTo(project);
        } else if (targetPath) {
          if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
            return fail(res, 400, `Directory does not exist or is not a folder: ${targetPath}`);
          }
          deps.context.switchToPath(targetPath);
        }
        if (deps.session) {
          deps.session.switchProject(deps.context.path, deps.context.stateManager, deps.context.logger);
        }
        return ok(res, buildProjectInfo({
          ...deps,
          projectPath: deps.context.path,
          stateManager: deps.context.stateManager
        }));
      } catch (err: any) {
        return fail(res, 400, err?.message ?? 'Failed to switch project');
      }
    }
    // --- Project & dashboard -------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/project') {
      return ok(res, buildProjectInfo(deps));
    }

    if (method === 'GET' && url.pathname === '/api/roadmap') {
      return ok(res, buildRoadmap(deps));
    }

    if (method === 'POST' && url.pathname === '/api/workflow/active-phase') {
      const body = await readJsonBody(req);
      const phaseId = String(body.phaseId ?? '').trim().toLowerCase();
      const valid = ORDERED_WORKFLOW_PHASES.some(p => p.id === phaseId);
      if (!valid) {
        return fail(res, 400, `Invalid phaseId: "${phaseId}". Expected one of: ${ORDERED_WORKFLOW_PHASES.map(p => p.id).join(', ')}`);
      }
      deps.stateManager.setActivePhase(phaseId);
      return ok(res, { activePhase: phaseId });
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

      // Portal summary for dashboard
      const portalItems = (state.portalItems || []).filter(i => i.meta?.archived !== true);
      const portalSummary = {
        blocking: portalItems.filter(i => i.severity === 'blocking' && i.status === 'open').length,
        parked: portalItems.filter(i => i.type === 'parked' && i.status === 'open').length,
        questions: portalItems.filter(i => i.type === 'question' && i.status === 'open').length,
        flags: portalItems.filter(i => i.type === 'flag' && i.status === 'open').length,
        topItems: portalItems.filter(i => i.status === 'open').slice(0, 10)
      };

      return ok(res, {
        project: buildProjectInfo(deps),
        roadmap,
        issues: buildIssues(deps).issues,
        recentActions: state.recentActions || [],
        documents,
        portalSummary
      });
    }

  }
};
