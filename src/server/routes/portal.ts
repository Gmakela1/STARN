import { archiveDuplicateOpenPortalItems, listPortalItems, dismissPortalItem } from '../../core/question-portal.js';
import { clearProposal, undoAutoApplied, isAutoAppliedIncorporated } from '../../core/research-gate.js';
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
      const topic = url.searchParams.get('topic') || undefined;
      // Heal duplicates persisted by earlier runs before listing.
      archiveDuplicateOpenPortalItems(deps.stateManager);
      const items = listPortalItems(deps.stateManager, { status, type, phaseId, topic });
      // Board #53B — answers still pending in the session's answer queue are
      // surfaced as item meta so a reload renders the queued chip from data
      // (answer frames are excluded from SSE backfill). Decorated copies only:
      // the pending marker is in-memory queue bookkeeping, never persisted.
      const queuedIds = deps.session ? deps.session.queuedAnswerItemIds() : [];
      const queuedSet = new Set(queuedIds);
      let decorated = items.map(item =>
        queuedSet.has(item.id)
          ? { ...item, meta: { ...(item.meta ?? {}), answerQueued: true } }
          : item
      );
      // Research gate — an auto-applied item whose appended answer has left
      // the doc (incorporated into normative text) gets an in-memory marker so
      // the panel stops offering UNDO (answerQueued decoration precedent:
      // point-in-time, never persisted). Uses the SAME incorporated signal as
      // the undo route (isAutoAppliedIncorporated) so the two cannot drift.
      decorated = decorated.map(item => {
        const auto = item.meta?.autoApplied;
        if (!auto || auto.incorporated === true) return item;
        return isAutoAppliedIncorporated(deps.projectPath, item)
          ? { ...item, meta: { ...(item.meta ?? {}), autoApplied: { ...auto, incorporated: true } } }
          : item;
      });
      return ok(res, { items: decorated });
    }

    if (segments[1] === 'portal' && segments.length === 3 && segments[2] === 'research-all' && method === 'POST') {
      // Busy guard: research-all never overlaps a running autopilot chain.
      if (deps.stateManager.getState().autopilot?.running) {
        return fail(res, 409, 'Autopilot chain is running — research-all is unavailable');
      }
      const session = deps.session;
      if (!session) return fail(res, 503, 'No active session');
      return ok(res, session.startResearchBackfill());
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

    if (segments[1] === 'portal' && segments.length === 4 && segments[3] === 'confirm-proposal' && method === 'POST') {
      const itemId = decodeURIComponent(segments[2]);
      const body = await readJsonBody(req);
      const state = deps.stateManager.getState();
      const item = (state.portalItems || []).find(i => i.id === itemId);
      if (!item) return fail(res, 404, `Portal item not found: ${itemId}`);
      const proposal = item.meta?.proposedAnswer;
      if (!proposal || item.status !== 'open') {
        return fail(res, 409, 'No research proposal pending on this item');
      }
      // Empty body → the proposal text as-is; a non-empty answer → edited text.
      const edited = typeof body?.answer === 'string' ? body.answer.trim() : '';
      const answerText = edited || String(proposal.answer ?? '');
      if (!answerText.trim()) return fail(res, 400, 'No answer text to apply');
      if (answerText.length > 4096) return fail(res, 400, 'Answer too long (max 4096 chars)');
      const session = deps.session;
      if (!session) return fail(res, 503, 'No active session');
      try {
        await session.applyConfirmedProposal(itemId, answerText);
      } catch (err: any) {
        const message = err?.message ?? String(err);
        if (message.includes('not found')) return fail(res, 404, message);
        if (message.includes('no longer open')) return fail(res, 409, message);
        return fail(res, 500, message);
      }
      clearProposal(deps.stateManager, itemId);
      return ok(res, { applied: true });
    }

    if (segments[1] === 'portal' && segments.length === 4 && segments[3] === 'reject-proposal' && method === 'POST') {
      const itemId = decodeURIComponent(segments[2]);
      const cleared = clearProposal(deps.stateManager, itemId);
      if (!cleared) return fail(res, 409, 'No research proposal pending on this item');
      return ok(res, { rejected: true });
    }

    if (segments[1] === 'portal' && segments.length === 4 && segments[3] === 'undo-auto' && method === 'POST') {
      const itemId = decodeURIComponent(segments[2]);
      try {
        const item = deps.session
          ? await deps.session.undoAutoAppliedAnswer(itemId)
          : await undoAutoApplied({ stateManager: deps.stateManager, projectPath: deps.projectPath }, itemId);
        return ok(res, { item });
      } catch (err: any) {
        const message = err?.message ?? String(err);
        if (message.includes('not found')) return fail(res, 404, message);
        if (message.includes('already incorporated') || message.includes('no auto-applied') || message.includes('not answered')) {
          return fail(res, 409, message);
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
