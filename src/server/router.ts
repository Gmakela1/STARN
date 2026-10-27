import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MUTATING_METHODS, originMatchesHost, fail, MIME_TYPES, RouterDeps, RouteModule } from './routes/kit.js';
import { projectsModule } from './routes/projects.js';
import { turnsModule } from './routes/turns.js';
import { docsModule } from './routes/docs.js';
import { contentModule } from './routes/content.js';
import { libraryModule } from './routes/library.js';
import { settingsModule } from './routes/settings.js';
import { autopilotModule } from './routes/autopilot.js';
import { portalModule } from './routes/portal.js';
import { voiceModule } from './routes/voice.js';

// Re-exported so server.ts's `import { ... RouterDeps } from './router.js'`
// keeps working after the domain code moved to routes/*.
export type { RouterDeps } from './routes/kit.js';

/**
 * Fixed-order dispatch: the old handleApiRequest was one long sequential
 * if-chain; each module below is one contiguous slice of that chain, so the
 * ordering here reproduces the original fall-through semantics exactly.
 */
const ROUTER_REGISTRY: RouteModule[] = [
  projectsModule,
  turnsModule,
  docsModule,
  contentModule,
  libraryModule,
  settingsModule,
  autopilotModule,
  portalModule,
  voiceModule
];

export async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawDeps: RouterDeps
): Promise<void> {
  const deps: RouterDeps = {
    ...rawDeps,
    projectPath: rawDeps.context ? rawDeps.context.path : rawDeps.projectPath,
    stateManager: rawDeps.context ? rawDeps.context.stateManager : rawDeps.stateManager
  };

  const url = new URL(req.url ?? '/', 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = (req.method ?? 'GET').toUpperCase();

  // CSRF defense: fail closed on cross-origin mutations. Browsers attach an
  // Origin header to cross-site requests; curl and scripts omit it and remain
  // allowed (preserving local tooling).
  const origin = req.headers.origin;
  if (origin !== undefined && MUTATING_METHODS.has(method) && !originMatchesHost(origin, req.headers.host)) {
    return fail(res, 403, 'Cross-origin request rejected');
  }

  try {
    // First module that owns the path handles it. A matched module that writes
    // nothing (foreign method on an owned path, e.g. PATCH /api/bom/items)
    // lets dispatch fall through like the old sequential if-chain.
    for (const module of ROUTER_REGISTRY) {
      if (module.match(url, segments)) {
        await module.handle(deps, req, res, url, segments);
        if (res.headersSent || res.writableEnded) return;
      }
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