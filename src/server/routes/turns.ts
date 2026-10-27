import { ORDERED_WORKFLOW_PHASES } from '../../workspace/state.js';
import { readJsonBody, ok, fail, RouteModule } from './kit.js';

export const turnsModule: RouteModule = {
  name: 'turns',
  match: (url, segments) => ['turns', 'checkpoints'].includes(segments[1]),
  handle: async (deps, req, res, url, segments) => {
    const method = (req.method ?? 'GET').toUpperCase();
    // --- Turns (SSE) ---------------------------------------------------------
    if (method === 'POST' && url.pathname === '/api/turns') {
      if (!deps.session) return fail(res, 503, 'Agent session unavailable');
      if (deps.session.busy) return fail(res, 409, 'A turn is already in progress');

      const body = await readJsonBody(req);
      const prompt = String(body.prompt ?? '').trim();
      if (!prompt) return fail(res, 400, 'Missing "prompt"');

      if (body.activePhase) {
        const targetPhase = String(body.activePhase).trim().toLowerCase();
        if (ORDERED_WORKFLOW_PHASES.some(p => p.id === targetPhase)) {
          deps.stateManager.setActivePhase(targetPhase);
        }
      }

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
        const result = await deps.session.resolveCheckpoint(decision as any, body.feedback);
        return ok(res, result);
      } catch (err: any) {
        return fail(res, 409, err?.message ?? 'No pending checkpoint');
      }
    }
  }
};
