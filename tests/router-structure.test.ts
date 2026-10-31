import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHttpServer } from '../src/server/server.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { projectsModule } from '../src/server/routes/projects.js';
import { turnsModule } from '../src/server/routes/turns.js';
import { docsModule } from '../src/server/routes/docs.js';
import { contentModule } from '../src/server/routes/content.js';
import { libraryModule } from '../src/server/routes/library.js';
import { settingsModule } from '../src/server/routes/settings.js';
import { autopilotModule } from '../src/server/routes/autopilot.js';
import { portalModule } from '../src/server/routes/portal.js';
import { voiceModule } from '../src/server/routes/voice.js';

interface Case {
  moduleName: string;
  match: (url: URL, segments: string[]) => boolean;
  ownPaths: string[];
  foreignPaths: string[];
}

const MODULES: Case[] = [
  {
    moduleName: 'projects',
    match: projectsModule.match,
    ownPaths: ['/api/projects', '/api/fs/folders', '/api/projects/switch', '/api/project', '/api/roadmap', '/api/workflow/active-phase', '/api/dashboard'],
    foreignPaths: ['/api/bom', '/api/turns', '/api/transcribe']
  },
  {
    moduleName: 'turns',
    match: turnsModule.match,
    ownPaths: ['/api/turns', '/api/turns/abort', '/api/checkpoints/pending', '/api/checkpoints/decision'],
    foreignPaths: ['/api/project', '/api/bom']
  },
  {
    moduleName: 'docs',
    match: docsModule.match,
    ownPaths: ['/api/docs/bom', '/api/docs/bom/approve', '/api/docs/bom/diff', '/api/docs/fabrication/view'],
    foreignPaths: ['/api/bom', '/api/docs', '/api/turns']
  },
  {
    moduleName: 'content',
    match: contentModule.match,
    ownPaths: ['/api/trade-study', '/api/bom', '/api/bom/items/SS01-01', '/api/actions', '/api/actions/ACTION-03', '/api/actions/ACTION-03/checklist', '/api/actions/ACTION-03/comments', '/api/actions/ACTION-03/flags', '/api/issues', '/api/issues/iss-1/push-to-agent', '/api/artifacts/upload', '/api/artifacts/photo.png', '/api/examples/mech-specialist'],
    foreignPaths: ['/api/project', '/api/library']
  },
  {
    moduleName: 'library',
    match: libraryModule.match,
    ownPaths: ['/api/references', '/api/library', '/api/library/references/spec.pdf', '/api/library/examples/mech/fixture.md'],
    foreignPaths: ['/api/bom', '/api/portal']
  },
  {
    moduleName: 'settings',
    match: settingsModule.match,
    ownPaths: ['/api/settings', '/api/settings/search', '/api/settings/search/probe', '/api/providers/openrouter/models', '/api/providers/openrouter/probe'],
    foreignPaths: ['/api/autopilot', '/api/portal']
  },
  {
    moduleName: 'autopilot',
    match: autopilotModule.match,
    ownPaths: ['/api/autopilot', '/api/autopilot/start', '/api/autopilot/stop', '/api/autopilot/resume', '/api/autopilot/events'],
    foreignPaths: ['/api/portal', '/api/turns']
  },
  {
    moduleName: 'portal',
    match: portalModule.match,
    ownPaths: ['/api/portal', '/api/portal/item-1/answer', '/api/portal/item-1/dismiss'],
    foreignPaths: ['/api/autopilot', '/api/transcribe']
  },
  {
    moduleName: 'voice',
    match: voiceModule.match,
    ownPaths: ['/api/transcribe'],
    foreignPaths: ['/api/portal', '/api/project']
  }
];

function route(urlPath: string): { url: URL; segments: string[] } {
  const url = new URL(urlPath, 'http://localhost');
  return { url, segments: url.pathname.split('/').filter(Boolean) };
}

describe('Route module match guards (Workstream A split)', () => {
  for (const mod of MODULES) {
    describe(`routes/${mod.moduleName}.ts`, () => {
      it('matches every path it owns', () => {
        for (const p of mod.ownPaths) {
          const { url, segments } = route(p);
          expect(mod.match(url, segments), `${p} should match ${mod.moduleName}`).toBe(true);
        }
      });

      it('rejects foreign paths', () => {
        for (const p of mod.foreignPaths) {
          const { url, segments } = route(p);
          expect(mod.match(url, segments), `${p} should NOT match ${mod.moduleName}`).toBe(false);
        }
      });
    });
  }

  it('no two modules claim the same path (dispatcher order is unambiguous)', () => {
    const claims = new Map<string, string[]>();
    for (const mod of MODULES) {
      for (const p of [...mod.ownPaths]) {
        const { url, segments } = route(p);
        if (mod.match(url, segments)) {
          if (!claims.has(p)) claims.set(p, []);
          claims.get(p)!.push(mod.moduleName);
        }
      }
    }
    for (const [p, owners] of claims) {
      expect(owners, `${p} claimed by ${owners.join(', ')}`).toHaveLength(1);
    }
  });
});

describe('Router dispatcher behavior after split', () => {
  let server: http.Server;
  let tmpDir: string;
  let stateManager: ProjectStateManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-structure-'));
    stateManager = new ProjectStateManager(tmpDir);
    stateManager.getOrCreateState('p1', 'Split Test');
    server = createHttpServer({ projectPath: tmpDir, stateManager });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  });

  afterEach(async () => {
    await new Promise(r => server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('unknown /api/nope reaches the exact 404 fallthrough', async () => {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/nope`);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ success: false, data: null, error: 'Unknown API route: GET /api/nope' });
  });

  it('GET /api/docs (missing phase segment) falls through to 404 like the old router', async () => {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/docs`);
    expect(res.status).toBe(404);
  });

  it('CSRF guard fires before route modules: cross-origin POST is rejected with 403', async () => {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/turns/abort`, {
      method: 'POST',
      headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Cross-origin request rejected');
  });

  it('loopback same-site POST passes the CSRF guard and hits the route module', async () => {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/turns/abort`, {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, data: { aborted: false }, error: null });
  });
});