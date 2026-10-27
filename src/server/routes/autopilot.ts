import { readJsonBody, ok, fail, sendJson, RouteModule } from './kit.js';

export const autopilotModule: RouteModule = {
  name: 'autopilot',
  match: (url, segments) => segments[1] === 'autopilot',
  handle: async (deps, req, res, url, segments) => {
    const method = (req.method ?? 'GET').toUpperCase();
    // --- Autopilot -------------------------------------------------------------
    if (segments[1] === 'autopilot' && segments.length === 2 && method === 'GET') {
      const session = deps.session;
      const state = deps.stateManager.getState();
      const autopilotState = state.autopilot || { running: false, docStatus: {}, revisionsUsed: {}, blocks: 0 };
      const docStatus = autopilotState.docStatus || {};
      const passedCount = Object.values(docStatus).filter(v => v === 'passed').length;
      return ok(res, {
        enabled: deps.autopilotEnabled ?? true,
        running: autopilotState.running ?? false,
        docStatus,
        blocks: autopilotState.blocks ?? 0,
        currentPhaseId: autopilotState.currentPhaseId,
        passedCount,
        totalPhases: 13
      });
    }

    if (segments[1] === 'autopilot' && segments.length === 3 && segments[2] === 'start' && method === 'POST') {
      if (!deps.session) return fail(res, 503, 'Agent session unavailable');
      try {
        deps.session.autopilotStart();
        return sendJson(res, 202, { success: true, data: { status: 'started' }, error: null });
      } catch (err: any) {
        return fail(res, 409, err?.message ?? 'Failed to start autopilot');
      }
    }

    if (segments[1] === 'autopilot' && segments.length === 3 && segments[2] === 'stop' && method === 'POST') {
      if (!deps.session) return fail(res, 503, 'Agent session unavailable');
      deps.session.autopilotStop();
      return ok(res, { status: 'stopped' });
    }

    if (segments[1] === 'autopilot' && segments.length === 3 && segments[2] === 'resume' && method === 'POST') {
      if (!deps.session) return fail(res, 503, 'Agent session unavailable');
      const body = await readJsonBody(req);
      try {
        deps.session.autopilotResume(body?.docId);
        return ok(res, { status: 'resumed' });
      } catch (err: any) {
        return fail(res, 409, err?.message ?? 'Failed to resume autopilot');
      }
    }

    if (segments[1] === 'autopilot' && segments.length === 3 && segments[2] === 'events' && method === 'GET') {
      if (!deps.session) return fail(res, 503, 'Agent session unavailable');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive'
      });

      // Backfill recent events
      const recent = deps.session.getRecentAutopilotEvents();
      for (const ev of recent) {
        if (!res.writableEnded) {
          if (ev.kind === 'question') {
            res.write(`event: question\ndata: ${JSON.stringify({ item: ev.item })}\n\n`);
          } else if (ev.kind === 'status') {
            res.write(`event: status\ndata: ${JSON.stringify({ message: ev.message })}\n\n`);
          } else if (ev.kind === 'tool_call') {
            res.write(`event: tool_call\ndata: ${JSON.stringify({ tool: ev.tool, args: ev.args })}\n\n`);
          } else {
            res.write(`event: autopilot\ndata: ${JSON.stringify({ status: ev })}\n\n`);
          }
        }
      }

      const emit = (ev: any) => {
        if (!res.writableEnded) {
          if (ev.kind === 'question') {
            res.write(`event: question\ndata: ${JSON.stringify({ item: ev.item })}\n\n`);
          } else if (ev.kind === 'status') {
            res.write(`event: status\ndata: ${JSON.stringify({ message: ev.message })}\n\n`);
          } else if (ev.kind === 'tool_call') {
            res.write(`event: tool_call\ndata: ${JSON.stringify({ tool: ev.tool, args: ev.args })}\n\n`);
          } else {
            res.write(`event: autopilot\ndata: ${JSON.stringify({ status: ev })}\n\n`);
          }
        }
      };

      deps.session.addSubscriber(emit);

      req.on('close', () => {
        deps.session?.removeSubscriber(emit);
        if (!res.writableEnded) res.end();
      });
      return; // Keep the connection open
    }

  }
};
