import fs from 'node:fs';
import path from 'node:path';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES } from '../workspace/state.js';
import { PortalItem } from '../workspace/types.js';
import { approveArtifact } from './approvals.js';
import { addPortalItem, answerPortalItem, ANSWER_HISTORY_CAP } from './question-portal.js';

export interface AnswerApplierDeps {
  stateManager: ProjectStateManager;
  projectPath: string;
  executeTurn: (opts: {
    userPrompt: string;
    forceSpecialistId: string;
    signal?: AbortSignal;
    onQuestions?: (items: Array<{
      type: 'question';
      severity: 'normal';
      docPath: string;
      title: string;
      detail?: string;
      source: 'autopilot';
    }>) => void;
  }) => Promise<import('./runner.js').TurnResult>;
  /**
   * Optional callback that runs change-impact for the affected phase.
   * The server/CLI adapter populates this; if absent, affectedDocs stays empty.
   */
  runChangeImpact?: (phaseId: string) => Promise<string[]>;
  /**
   * True while the owning session is mid-chain (a turn or autopilot chain is
   * running). When set and true, applyAnswer takes the plain-edit path: the
   * answer is inserted into the doc as a pending edit and incorporation is
   * deferred to the next normal turn — no draft+critic turn runs mid-chain.
   */
  isBusy?: () => boolean;
}

/**
 * Extract the question number from the item's title. Supports:
 * - "Q3. What bus voltage?" → 3
 * - "Q1: Some question" → 1
 * - anything else → 1 (default)
 */
function extractQuestionNumber(title: string): number {
  const m = title.match(/^Q(\d+)[\.:\)]\s*/);
  if (m) {
    return parseInt(m[1], 10);
  }
  return 1;
}

/**
 * Saved context injected alongside the current answer so the specialist never
 * re-asks what the user already answered.
 */
export interface UserAnswersContext {
  /** Saved history entries for THIS question (most recent last). */
  priorHistory?: Array<{ text: string }>;
  /** Other ANSWERED questions on the same document (id + title + latest answer). */
  otherAnswered?: Array<{ id: string; title: string; answer: string }>;
}

/** Cap on how many other answered questions the answer-apply prompt carries. */
const OTHER_ANSWERED_CAP = 6;

/**
 * Build the standard USER ANSWERS prompt block that the specialist will see
 * alongside the existing baseline document. Mirrors the CLI's pre-turn block
 * at src/index.ts:582. With `context`, the block also carries the answer
 * memory: this question's saved history plus other answered questions for the
 * same document, with a do-not-re-ask rule.
 */
export function buildUserAnswersBlock(
  item: PortalItem,
  answerText: string,
  context?: UserAnswersContext
): string {
  const number = extractQuestionNumber(item.title);
  // Strip the Qn. prefix from title for display in the block — the CLI format
  // uses the raw question text, not the Q-prefixed version. Check the CLI:
  // `Q${i + 1}: ${qa.question.slice(0,150)}` where qa.question is raw text.
  // Our title may already be "What is the max voltage?" (no Q prefix) or
  // "Q3. What bus voltage?" (with prefix). We show the title as-is but number
  // from extractQuestionNumber.
  const displayTitle = item.title.replace(/^Q\d+[\.:\)]\s*/, '');
  let block = `\n\nUSER ANSWERS TO OPEN QUESTIONS (incorporate per your instructions):\nQ${number}. ${displayTitle}\nAnswer: ${answerText}\n`;
  const hasHistory = !!context?.priorHistory?.length;
  const hasOther = !!context?.otherAnswered?.length;
  if (hasHistory || hasOther) {
    block += `\nPREVIOUSLY ANSWERED — these decisions are settled: do NOT re-ask, re-open, or restate them as open questions; incorporate them into the relevant sections. Only genuinely NEW unresolved items may appear in the Open Questions section.\n`;
    if (hasHistory) {
      block += context!.priorHistory!.map(h => `Q${number} earlier answer: ${h.text}`).join('\n') + '\n';
    }
    if (hasOther) {
      block += context!.otherAnswered!.map(a => `Q?. ${a.title}\nAnswer: ${a.answer}`).join('\n') + '\n';
    }
  }
  return block;
}

/**
 * Derive the phase id from a docPath like "docs/CONOPS.md".
 * Validates against ORDERED_WORKFLOW_PHASES.
 */
function phaseIdFromDocPath(docPath: string): string {
  const m = docPath.match(/^docs\/(.+)\.md$/i);
  if (!m) {
    throw new Error(`Cannot derive phase from docPath: ${docPath}`);
  }
  const raw = m[1].toLowerCase();
  // Normalize: try exact match first, then normalized
  for (const p of ORDERED_WORKFLOW_PHASES) {
    if (p.id.toLowerCase() === raw) {
      return p.id;
    }
  }
  throw new Error(`Unknown phase derived from docPath: ${docPath}`);
}

/**
 * Apply an answer to a portal question: build the USER ANSWERS block, run a
 * targeted follow-up executeTurn on the originating document (via
 * forceSpecialistId), detect counter-questions, auto-approve if the critic
 * passes, and return affected docs from change-impact.
 */
export async function applyAnswer(
  deps: AnswerApplierDeps,
  itemId: string,
  answerText: string
): Promise<{
  updatedItem: PortalItem;
  affectedDocs: string[];
  counterQuestions: PortalItem[];
}> {
  const { stateManager, projectPath } = deps;

  // 1. Look up the item by itemId
  const state = stateManager.getState();
  const item = (state.portalItems || []).find(i => i.id === itemId);
  if (!item) {
    throw new Error(`Portal item not found: ${itemId}`);
  }
  // Freshness check: a queued answer that lands after the item was already
  // answered/dismissed must not rewrite the portal (prevents double-apply of
  // stale queue entries).
  if (item.status !== 'open') {
    throw new Error(`Portal item no longer open (${item.status})`);
  }
  if (!item.docPath) {
    throw new Error(`Portal item ${itemId} has no docPath`);
  }

  // 2. Determine originating phase from docPath
  const phaseId = phaseIdFromDocPath(item.docPath);

  // 3. Read the current doc content from disk
  const docFilePath = path.join(projectPath, 'docs', `${phaseId.toUpperCase()}.md`);
  let existingContent = '';
  try {
    existingContent = fs.readFileSync(docFilePath, 'utf-8');
  } catch {
    // If doc doesn't exist yet, use empty string (the turn will create it)
    existingContent = '';
  }

  // 3b. Mid-chain answers (FIX): while the session is busy running the chain,
  // do NOT burn a full draft+critic turn. Insert the answer as a plain doc
  // edit and mark the item answered; the next normal turn incorporates it
  // (it sees the answer via the PREVIOUSLY ANSWERED context).
  if (deps.isBusy?.()) {
    if (existingContent.trim()) {
      const displayTitle = item.title.replace(/^Q\d+[\.:\)]\s*/, '');
      const pendingBlock = `${existingContent.trimEnd()}\n\n## User Answers (Pending Incorporation)\n\n**${displayTitle}**\nAnswer: ${answerText}\n`;
      fs.writeFileSync(docFilePath, pendingBlock, 'utf-8');
    }
    // If the doc is missing/empty there is nothing to edit in place; the
    // answer still lands on the item and reaches the next turn via context.
    const answeredItem = answerPortalItem(stateManager, itemId, answerText);
    return { updatedItem: answeredItem, affectedDocs: [], counterQuestions: [] };
  }

  // 4. Build userPrompt — with answer memory (this item's history + other
  // answered questions on the same doc) so the specialist never re-asks.
  const allItems = state.portalItems || [];
  const otherAnswered = allItems
    .filter(i =>
      i.id !== itemId &&
      i.docPath === item.docPath &&
      i.status === 'answered' &&
      typeof i.answer === 'string' && i.answer.trim() !== '')
    .sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''))
    .slice(-OTHER_ANSWERED_CAP)
    .map(i => ({ id: i.id, title: i.title, answer: i.answer as string }));
  const priorHistory = Array.isArray(item.meta?.answerHistory)
    ? item.meta!.answerHistory.slice(-ANSWER_HISTORY_CAP)
    : [];
  const answerBlock = buildUserAnswersBlock(item, answerText, { priorHistory, otherAnswered });
  const userPrompt = `${existingContent}${answerBlock}\n\nUpdate the document in place per the Section 6 answer handling instructions. Do NOT regenerate the entire document.`;

  // 5. Call executeTurn with forceSpecialistId and onQuestions hook
  const counterQuestionItems: Array<{
    type: 'question';
    severity: 'normal';
    docPath: string;
    title: string;
    detail?: string;
    source: 'autopilot';
  }> = [];

  const result = await deps.executeTurn({
    userPrompt,
    forceSpecialistId: phaseId,
    onQuestions: (items) => {
      for (const q of items) {
        counterQuestionItems.push(q);
      }
    }
  });

  // 6. Post-turn: if critic passed, auto-approve; if failed, throw
  if (result.requiresReview && result.criticFailed) {
    throw new Error(
      `Cannot auto-answer question — critic still fails for ${phaseId}. ` +
      `Feedback: ${result.criticResult?.summary || 'No feedback available'}`
    );
  }

  // 7. Approve artifact (writes the post-turn doc and runs change-impact)
  // Read the post-turn doc from disk
  const postTurnContent = fs.readFileSync(docFilePath, 'utf-8');

  let affectedDocs: string[] = [];
  if (result.requiresReview && !result.criticFailed) {
    const approveResult = await approveArtifact({
      projectPath,
      stateManager,
      specialistId: phaseId,
      content: postTurnContent,
      runChangeImpact: deps.runChangeImpact
        ? async (id: string) => deps.runChangeImpact!(id)
        : undefined,
      advance: false // The applier does NOT advance the workflow
    });
    affectedDocs = approveResult.affectedDocs;
  }

  // 8. Mark the item answered
  const updatedItem = answerPortalItem(stateManager, itemId, answerText);

  // 9. Add counter-questions as new portal items
  const counterQuestions: PortalItem[] = [];
  const threadId = item.threadId || item.id;
  for (const q of counterQuestionItems) {
    const newItem = addPortalItem(stateManager, {
      type: 'question',
      severity: 'normal',
      docPath: q.docPath,
      title: q.title,
      detail: q.detail,
      source: 'autopilot',
      threadId
    });
    counterQuestions.push(newItem);
  }

  // 10. Board #52 — follow-up questions reopened after this answer inherit the
  // item's full answer history, so the thread keeps its saved Q&A record.
  // NOTE: getState() re-parses the store, so re-read fresh before saving —
  // saving the earlier snapshot would wipe answerPortalItem's history append.
  if (counterQuestions.length > 0) {
    const history = updatedItem.meta?.answerHistory;
    if (Array.isArray(history)) {
      // Cap on inherit too, so a follow-up thread can never carry more saved
      // answers than an in-place append would.
      const capped = history.slice(-ANSWER_HISTORY_CAP);
      const fresh = stateManager.getState();
      const byId = new Map((fresh.portalItems || []).map(i => [i.id, i]));
      for (const cq of counterQuestions) {
        // Answer history stays scoped: only follow-ups on the SAME document
        // inherit the thread's saved answers — unrelated documents must not
        // inherit decisions they have nothing to do with.
        if (cq.docPath !== item.docPath) {
          continue;
        }
        cq.meta = { ...(cq.meta || {}), answerHistory: capped };
        const stored = byId.get(cq.id);
        if (stored) {
          stored.meta = { ...(stored.meta || {}), answerHistory: capped };
        }
      }
      stateManager.saveState(fresh);
    }
  }

  return { updatedItem, affectedDocs, counterQuestions };
}
