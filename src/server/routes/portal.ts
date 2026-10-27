import { listPortalItems, dismissPortalItem } from '../../core/question-portal.js';
import { readJsonBody, ok, fail, sendJson, RouteModule } from './kit.js';

export const portalModule: RouteModule = {
  name: 'portal',
  match: (url, segments) => segments[1] === 'portal',
  handle: async (deps, req, res, url, segments) => {
    const method = (req.method ?? 'GET').toUpperCase();
    // --- Portal ----------------------------------------------------------------
    if (segments[1] === 'portal' && segments.length === 2 && method === 'GET') {
      const status = url.searchParams.get('status') as any || undefined;
      const type = url.searchParams.get('type') as any || undefined;
      const phaseId = url.searchParams.get('phaseId') || undefined;
      const items = listPortalItems(deps.stateManager, { status, type, phaseId });
      return ok(res, { items });
    }

    if (segments[1] === 'portal' && segments.length === 4 && segments[3] === 'answer' && method === 'POST') {
      const itemId = decodeURIComponent(segments[2]);
      const body = await readJsonBody(req);
      const answerText = String(body?.answer ?? '');
      if (!answerText.trim()) return fail(res, 400, 'Missing "answer"');
      if (answerText.trim().length > 4096) return fail(res, 400, 'Answer too long (max 4096 chars)');
      try {
        const session = deps.session;
        if (!session) return fail(res, 503, 'No active session');
        // Queue the answer in the session. Idle → applied immediately; a turn
        // in progress → queued and applied between phases via the session's
        // answer queue (drained from makeExecuteTurn / runTurn).
        const queued = await session.queueAnswer(itemId, answerText.trim());
        if (queued.queued) {
          sendJson(res, 202, { success: true, data: { queued: true }, error: null });
        } else {
          ok(res, { applied: true });
        }
      } catch (err: any) {
        const message = err?.message ?? String(err);
        if (message.includes('queue is full')) {
          return fail(res, 429, message);
        }
        if (message.includes('not found') || message.includes('Invalid')) {
          return fail(res, 404, message);
        }
        return fail(res, 500, message);
      }
    }

    if (segments[1] === 'portal' && segments.length === 4 && segments[3] === 'dismiss' && method === 'POST') {
      const itemId = decodeURIComponent(segments[2]);
      try {
        const item = dismissPortalItem(deps.stateManager, itemId);
        return ok(res, { item });
      } catch (err: any) {
        return fail(res, 404, err?.message ?? 'Portal item not found');
      }
    }

  }
};
