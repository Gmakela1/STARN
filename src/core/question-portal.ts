import { PortalItem, PortalItemType } from '../workspace/types.js';
import { ProjectStateManager, defaultAutopilotState } from '../workspace/state.js';

export type PortalItemInput = Omit<PortalItem, 'id' | 'createdAt' | 'updatedAt' | 'status'>;

export interface PortalListFilter {
  status?: PortalItem['status'];
  type?: PortalItemType;
  phaseId?: string;
}

/**
 * Soft cap on the persisted portal store. When at cap, the oldest still-open
 * item is marked `meta.archived = true` instead of growing the array past it.
 */
const MAX_PORTAL_ITEMS = 500;

const OPEN_RANK = 0;
const CLOSED_RANK = 1;

function createItemId(): string {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Adds a portal item (or dedupes onto an open item in the same autopilot run).
 * Returns the stored PortalItem.
 */
export function addPortalItem(manager: ProjectStateManager, input: PortalItemInput): PortalItem {
  const state = manager.getState();
  if (!state.portalItems) {
    state.portalItems = [];
  }
  if (!state.autopilot) {
    state.autopilot = defaultAutopilotState();
  }

  // Dedupe: within the same autopilot run, an identical open question for the
  // same docPath+title is returned as-is instead of creating a duplicate.
  if (state.autopilot.running) {
    const existing = state.portalItems.find(
      item =>
        item.status === 'open' &&
        item.meta?.archived !== true &&
        item.docPath === input.docPath &&
        item.title === input.title
    );
    if (existing) {
      return existing;
    }
  }

  // Cap: never grow beyond MAX_PORTAL_ITEMS — archive the oldest open item
  // instead of pushing past the cap.
  if (state.portalItems.length >= MAX_PORTAL_ITEMS) {
    const oldestOpen = state.portalItems
      .filter(item => item.status === 'open' && item.meta?.archived !== true)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (oldestOpen) {
      oldestOpen.meta = { ...(oldestOpen.meta || {}), archived: true };
      manager.saveState(state);
    }
    return oldestOpen || state.portalItems[state.portalItems.length - 1];
  }

  const now = new Date().toISOString();
  const item: PortalItem = {
    id: createItemId(),
    type: input.type,
    severity: input.severity,
    title: input.title,
    status: 'open',
    source: input.source,
    createdAt: now,
    updatedAt: now
  };
  if (input.docPath !== undefined) item.docPath = input.docPath;
  if (input.section !== undefined) item.section = input.section;
  if (input.detail !== undefined) item.detail = input.detail;
  if (input.gaps !== undefined) item.gaps = input.gaps;
  if (input.threadId !== undefined) item.threadId = input.threadId;
  if (input.answer !== undefined) item.answer = input.answer;
  if (input.meta !== undefined) item.meta = input.meta;

  state.portalItems.push(item);
  manager.saveState(state);
  return item;
}

/**
 * Marks a portal item answered, storing the answer text.
 */
export function answerPortalItem(manager: ProjectStateManager, id: string, answer: string): PortalItem {
  const state = manager.getState();
  const item = (state.portalItems || []).find(i => i.id === id);
  if (!item) {
    throw new Error(`Portal item not found: ${id}`);
  }
  item.answer = answer;
  item.status = 'answered';
  item.updatedAt = new Date().toISOString();
  manager.saveState(state);
  return item;
}

/**
 * Marks a portal item dismissed (user declined to act on it).
 */
export function dismissPortalItem(manager: ProjectStateManager, id: string): PortalItem {
  const state = manager.getState();
  const item = (state.portalItems || []).find(i => i.id === id);
  if (!item) {
    throw new Error(`Portal item not found: ${id}`);
  }
  item.status = 'dismissed';
  item.updatedAt = new Date().toISOString();
  manager.saveState(state);
  return item;
}

/**
 * Lists portal items, optionally filtered by status/type/phaseId. Sorted with
 * open items first, then by createdAt descending within each status bucket.
 */
export function listPortalItems(manager: ProjectStateManager, filter?: PortalListFilter): PortalItem[] {
  const state = manager.getState();
  let items = state.portalItems || [];

  if (filter?.status !== undefined) {
    items = items.filter(i => i.status === filter.status);
  }
  if (filter?.type !== undefined) {
    items = items.filter(i => i.type === filter.type);
  }
  if (filter?.phaseId !== undefined && filter.phaseId !== '') {
    const prefix = `docs/${filter.phaseId}.md`.toLowerCase();
    items = items.filter(i => i.docPath !== undefined && i.docPath.toLowerCase().startsWith(prefix));
  }

  return [...items].sort((a, b) => {
    const rankDiff = statusRank(a.status) - statusRank(b.status);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * Marks every open item belonging to the given thread resolved (used when a
 * question thread has been fully answered).
 */
export function clearResolvedThread(manager: ProjectStateManager, threadId: string): void {
  const state = manager.getState();
  let changed = false;
  for (const item of state.portalItems || []) {
    if (item.threadId === threadId && item.status === 'open') {
      item.status = 'resolved';
      item.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    manager.saveState(state);
  }
}

function statusRank(status: PortalItem['status']): number {
  return status === 'open' ? OPEN_RANK : CLOSED_RANK;
}