import { PortalItem, PortalItemType, PortalThreadMessage } from '../workspace/types.js';
import { ProjectStateManager, defaultAutopilotState } from '../workspace/state.js';
import { questionSlug } from './open-questions-parser.js';
import { shortResearchTitle } from './research-gate.js';

export type PortalItemInput = Omit<PortalItem, 'id' | 'createdAt' | 'updatedAt' | 'status'>;

export interface PortalListFilter {
  status?: PortalItem['status'];
  type?: PortalItemType;
  phaseId?: string;
  /** ICD-system topic tag on meta.topic (QUESTION_TOPICS values or any normalized tag). */
  topic?: string;
  /** P2 audit flag — when true, upstreamOf-tagged hidden duplicates are included. */
  includeUpstream?: boolean;
}

/**
 * Soft cap on the persisted portal store. When at cap, the oldest still-open
 * item is marked `meta.archived = true` instead of growing the array past it.
 */
const MAX_PORTAL_ITEMS = 500;

/** Board #52 — per-item saved answer history is capped to the most recent entries. */
export const ANSWER_HISTORY_CAP = 20;

/**
 * Max persisted thread ROWS per item (trim the oldest message row, keep the
 * first). `recorded`/`proposal` rows are never dropped but DO occupy rows, so
 * they shrink the number of message rows a thread can hold.
 */
export const THREAD_MESSAGE_CAP = 20;

/**
 * True for rows that are permanent record: a committed answer ('recorded') or
 * a concluded draft ('proposal'). The trim rule never drops these.
 * Tolerant of a null/undefined row (hand-edited or corrupt meta.thread): such
 * a row is treated as trimmable instead of throwing on `row.kind`.
 */
function isPermanentThreadRow(row: PortalThreadMessage | null | undefined): boolean {
  return row != null && (row.kind === 'recorded' || row.kind === 'proposal');
}

/**
 * Pure: appends one thread row and trims back to THREAD_MESSAGE_CAP.
 *
 * Trim rule: the FIRST row is always kept (original question context), then
 * the oldest `message` row is dropped while the thread is over the cap.
 * `recorded`/`proposal` rows are permanent and never dropped, so a thread of
 * permanent rows alone may exceed the cap.
 *
 * @param thread Existing rows (undefined/null treated as empty; never mutated).
 * @param row Row to append.
 * @returns A new array of at most THREAD_MESSAGE_CAP rows unless it is made of
 *   more permanent rows than the cap allows.
 */
export function appendThreadMessage(
  thread: PortalThreadMessage[] | undefined,
  row: PortalThreadMessage
): PortalThreadMessage[] {
  const next = [...(Array.isArray(thread) ? thread : []), row];
  while (next.length > THREAD_MESSAGE_CAP) {
    const oldestTrimmable = next.findIndex((m, i) => i > 0 && !isPermanentThreadRow(m));
    if (oldestTrimmable === -1) {
      break;
    }
    next.splice(oldestTrimmable, 1);
  }
  return next;
}

/**
 * P2 — minimum token-Jaccard similarity for a question to count as a fuzzy
 * cross-doc duplicate of an already-open question (meta.upstreamOf tagging).
 * Tuned high so merely-related questions (sharing 1-2 words) stay separate.
 */
export const SIMILARITY_THRESHOLD = 0.72;

const OPEN_RANK = 0;
const CLOSED_RANK = 1;

function createItemId(): string {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function dedupeKey(item: Pick<PortalItem, 'type' | 'docPath' | 'title'> & { meta?: { originalTitle?: string } }): string {
  // Stable identity: docPath + question slug (wording-variant tolerant, Qn
  // prefix and "Why it matters" text excluded). Type stays in the key so
  // questions never dedupe onto flags/gaps items.
  // Short-title rewrite: a rewritten item dedupes on its ORIGINAL title
  // (meta.originalTitle), so a re-intake of the same wall-of-text question
  // still dedupes onto it instead of creating a short-titled twin.
  return JSON.stringify([item.type, item.docPath ?? '', questionSlug(item.meta?.originalTitle ?? item.title)]);
}

/**
 * Pure: candidate identity keys for the pass-2 (open vs closed) comparison
 * only. Pass 1 keeps the single `dedupeKey` identity.
 *
 * Both the current title and `meta.originalTitle` (the pre-short-title-rewrite
 * wording) are offered, because only ONE side of a twin pair is retitled: the
 * answered side slugs its original long title, the open side slugs the short
 * one, and the single `dedupeKey` string never matches.
 *
 * @param item Any item shaped like PortalItem's type/title/meta.
 * @returns A set of 1-2 keys `[type, slug]` — never throws on odd fields.
 */
function dedupeCandidateKeys(
  item: Pick<PortalItem, 'type' | 'title'> & { meta?: { originalTitle?: string } }
): Set<string> {
  const keys = new Set<string>([JSON.stringify([item.type, questionSlug(item.title)])]);
  const original = item.meta?.originalTitle;
  if (typeof original === 'string' && original.trim() !== '') {
    keys.add(JSON.stringify([item.type, questionSlug(original)]));
  }
  return keys;
}

/**
 * True when the item carries answer text: `PortalItem.answer` (written by
 * answerPortalItem) or at least one non-empty `meta.answerHistory` entry.
 *
 * @param item Any portal item (no throw on missing/odd fields).
 * @returns true only for a non-empty (trimmed) answer string.
 */
function hasAnswer(item: PortalItem): boolean {
  if (typeof item.answer === 'string' && item.answer.trim() !== '') {
    return true;
  }
  const history = item.meta?.answerHistory;
  return Array.isArray(history) && history.some(entry => typeof entry?.text === 'string' && entry.text.trim() !== '');
}

/**
 * When a closed item's answer landed: `updatedAt` (answerPortalItem stamps it)
 * falls back to `createdAt` for legacy rows without one.
 */
function answerTime(item: PortalItem): string {
  return item.updatedAt || item.createdAt;
}

/**
 * Pure: marks open duplicates `meta.archived = true` in two passes.
 *
 * Pass 1 — open vs open: same type + docPath + normalized title, the OLDEST of
 * each group wins.
 * Pass 2 — open vs ALREADY CLOSED: an open item is a stale twin when a
 * non-open item (answered/resolved/dismissed) whose candidate key set
 * intersects the open item's carries a non-empty answer written strictly AFTER
 * the open item's createdAt. When the open item was created after the answer it
 * may be a genuine re-open and is left alone.
 *
 * Nothing is ever deleted, already-archived items are never touched.
 *
 * @param items Portal items, mutated in place (only `meta.archived`).
 * @returns true when at least one item was changed (idempotent: a second call
 *   returns false).
 */
export function dedupeOpenPortalItems(items: PortalItem[]): boolean {
  const open = items
    .filter(item => item.status === 'open' && item.meta?.archived !== true)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const seen = new Set<string>();
  let changed = false;
  for (const item of open) {
    const key = dedupeKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    item.meta = { ...(item.meta || {}), archived: true };
    changed = true;
  }

  // Pass 2 — latest answer time per candidate key among closed items.
  // DocPath is deliberately IGNORED here: the same question answered from a
  // different document (docs/RTM.md open, docs/REQUIREMENTS.md answered) is
  // still stale, so only the type + title identity is compared.
  const answeredAt = new Map<string, string>();
  for (const item of items) {
    if (item.status === 'open' || !hasAnswer(item)) {
      continue;
    }
    const at = answerTime(item);
    for (const key of dedupeCandidateKeys(item)) {
      const prior = answeredAt.get(key);
      if (prior === undefined || prior.localeCompare(at) < 0) {
        answeredAt.set(key, at);
      }
    }
  }
  for (const item of items) {
    if (item.status !== 'open' || item.meta?.archived === true) {
      continue;
    }
    let at: string | undefined;
    for (const key of dedupeCandidateKeys(item)) {
      const answerAt = answeredAt.get(key);
      if (answerAt !== undefined && (at === undefined || at.localeCompare(answerAt) < 0)) {
        at = answerAt;
      }
    }
    // `<= 0` = the open item was created at/after the answer → plausible
    // genuine re-open, never archived.
    if (at === undefined || at.localeCompare(item.createdAt) <= 0) {
      continue;
    }
    item.meta = { ...(item.meta || {}), archived: true };
    changed = true;
  }
  return changed;
}

/** Heals persisted duplicates: archives them and saves state only when something changed. */
export function archiveDuplicateOpenPortalItems(manager: ProjectStateManager): void {
  const state = manager.getState();
  if (dedupeOpenPortalItems(state.portalItems || [])) {
    manager.saveState(state);
  }
}

/**
 * Pure: token-Jaccard similarity between two question titles. Both are
 * normalized via questionSlug (lowercased, punctuation-stripped, 10-word
 * cap) and split into tokens; returns |intersection| / |union|. An empty
 * slug (no tokens) yields 0.
 */
export function questionSimilarity(titleA: string, titleB: string): number {
  const tokensA = questionSlug(titleA).split(' ').filter(Boolean);
  const tokensB = questionSlug(titleB).split(' ').filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

/**
 * Guarded add for model-derived question items (onQuestions hooks, counter-
 * questions). F3 guard: an empty trimmed question title renders as a bare
 * unlabeled button in the panel nav, so such items are skipped — returns
 * undefined without storing anything and without throwing. Any other input
 * delegates to addPortalItem (real storage errors still propagate).
 * Callers count the undefined results and log once.
 */
export function addQuestionItemIfValid(manager: ProjectStateManager, input: PortalItemInput): PortalItem | undefined {
  if (input.type === 'question' && !input.title.trim()) {
    return undefined;
  }
  return addPortalItem(manager, input);
}

/**
 * Adds a portal item (or dedupes onto an existing open item with the same type, docPath and title).
 * Returns the stored PortalItem. Pure store operation: it does not validate
 * titles — model-derived question input should go through addQuestionItemIfValid.
 */
export function addPortalItem(manager: ProjectStateManager, input: PortalItemInput): PortalItem {
  const state = manager.getState();
  if (!state.portalItems) {
    state.portalItems = [];
  }
  if (!state.autopilot) {
    state.autopilot = defaultAutopilotState();
  }

  // Exact dedupe (unchanged): an identical open question (same type, docPath
  // and normalized title) is returned as-is instead of creating a duplicate —
  // across runs too.
  const key = dedupeKey(input);
  const existing = state.portalItems.find(
    item => item.status === 'open' && item.meta?.archived !== true && dedupeKey(item) === key
  );
  if (existing) {
    return existing;
  }

  // P2 fuzzy cross-doc dedupe: a near-verbatim restatement of an already-open
  // QUESTION in a different document (token-Jaccard >= SIMILARITY_THRESHOLD,
  // topic tags compatible) is tagged meta.upstreamOf and still persisted for
  // audit, but hidden from the default open listing by listPortalItems. The
  // canonical is the OLDEST matching item; already-hidden children are
  // skipped so every twin points straight at its canonical. Exact same-doc
  // dedupe above is unchanged; non-question types are never fuzzy-matched.
  let upstreamOf: string | undefined;
  if (input.type === 'question') {
    let best: PortalItem | undefined;
    let bestScore = 0;
    for (const candidate of state.portalItems) {
      if (
        candidate.type !== 'question' ||
        candidate.status !== 'open' ||
        candidate.meta?.archived === true ||
        candidate.meta?.superseded === true ||
        candidate.meta?.upstreamOf !== undefined ||
        candidate.docPath === input.docPath
      ) {
        continue;
      }
      const candidateTopic = candidate.meta?.topic;
      const inputTopic = input.meta?.topic;
      // Topic veto: both tagged → must match; either untagged → allowed.
      if (candidateTopic !== undefined && inputTopic !== undefined && candidateTopic !== inputTopic) {
        continue;
      }
      const score = questionSimilarity(candidate.title, input.title);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best && bestScore >= SIMILARITY_THRESHOLD) {
      upstreamOf = best.id;
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
  if (upstreamOf !== undefined) item.meta = { ...(input.meta || {}), upstreamOf };
  else if (input.meta !== undefined) item.meta = input.meta;

  // Intake-path short-title rewrite: a question created WITH format-v2
  // sections gets the same wall-of-text treatment the research gate applies
  // on enrichment (shortResearchTitle) — short display title, the original
  // preserved in meta.originalTitle, and the original mirrored into an empty
  // detail. Dedupe above already keyed on the pre-rewrite title (same
  // precedent as the gate's rewriteShortTitle). No-op for short titles and
  // non-question types.
  if (item.type === 'question' && item.meta?.sections) {
    const short = shortResearchTitle(item.title);
    if (short !== item.title) {
      const original = item.title;
      // Keep a caller-supplied originalTitle (the parser's raw header): it is
      // the dedupe key, and the pre-rewrite title is already a trimmed form.
      item.meta = { ...(item.meta || {}), originalTitle: item.meta?.originalTitle ?? original };
      item.title = short;
      if (!item.detail) item.detail = original;
    }
  }

  state.portalItems.push(item);
  manager.saveState(state);
  return item;
}

/**
 * Marks a portal item answered, storing the answer text.
 * Optional provenance lands on the saved history entry (research-gate answers).
 */
export function answerPortalItem(manager: ProjectStateManager, id: string, answer: string, provenance?: string): PortalItem {
  const state = manager.getState();
  const item = (state.portalItems || []).find(i => i.id === id);
  if (!item) {
    throw new Error(`Portal item not found: ${id}`);
  }
  item.answer = answer;
  item.status = 'answered';
  item.updatedAt = new Date().toISOString();
  // Board #52 — append the applied answer to the item's saved history so any
  // follow-up question reopened on this thread keeps the full Q&A record.
  // The history is capped to the most recent entries so long threads cannot
  // grow item metadata without bound.
  const priorHistory = Array.isArray(item.meta?.answerHistory) ? item.meta!.answerHistory : [];
  item.meta = {
    ...(item.meta || {}),
    answerHistory: [
      ...priorHistory,
      provenance ? { text: answer, at: item.updatedAt, source: provenance } : { text: answer, at: item.updatedAt }
    ].slice(-ANSWER_HISTORY_CAP)
  };
  // Stable identity — answering one question supersedes any still-open twin
  // (same type + docPath + slug) so the user is never asked the same question
  // twice. Twins are hidden via meta.superseded; their ids stay untouched.
  const key = dedupeKey(item);
  const supersededIds = new Set<string>([item.id]);
  for (const twin of state.portalItems || []) {
    if (twin.id === item.id || twin.status !== 'open' || twin.meta?.archived === true) {
      continue;
    }
    if (dedupeKey(twin) === key) {
      twin.meta = { ...(twin.meta || {}), superseded: true };
      supersededIds.add(twin.id);
    }
  }
  // P2 cascade — every still-open item whose meta.upstreamOf points at the
  // answered item or one of its superseded twins follows them into
  // meta.superseded. Loops until no new child is found so legacy
  // upstreamOf chains (child → child) fully collapse.
  let cascaded = true;
  while (cascaded) {
    cascaded = false;
    for (const child of state.portalItems || []) {
      if (
        child.status !== 'open' ||
        child.meta?.archived === true ||
        child.meta?.superseded === true ||
        child.meta?.upstreamOf === undefined ||
        !supersededIds.has(child.meta.upstreamOf)
      ) {
        continue;
      }
      child.meta = { ...(child.meta || {}), superseded: true };
      supersededIds.add(child.id);
      cascaded = true;
    }
  }
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
 * Lists non-archived portal items, optionally filtered by status/type/phaseId/topic. Sorted with
 * open items first, then by createdAt descending within each status bucket.
 * P2 — items tagged meta.upstreamOf (fuzzy cross-doc duplicates of a canonical
 * open question) are excluded by default; pass includeUpstream to audit them.
 */
export function listPortalItems(manager: ProjectStateManager, filter?: PortalListFilter): PortalItem[] {
  const state = manager.getState();
  let items = (state.portalItems || []).filter(i =>
    i.meta?.archived !== true &&
    i.meta?.superseded !== true &&
    (filter?.includeUpstream === true || i.meta?.upstreamOf === undefined)
  );

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
  if (filter?.topic !== undefined && filter.topic !== '') {
    items = items.filter(i => i.meta?.topic === filter.topic);
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