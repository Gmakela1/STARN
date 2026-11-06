/**
 * Shared incorporation-turn prompt directives and the pending-answers block
 * marker/strip helper. Used by BOTH the autopilot chain (pre-phase
 * incorporation) and the answer applier (idle incorporation when the last
 * open question for a document is answered) so the two paths cannot drift.
 */
import type { PortalItem, PortalThreadMessage, ProjectState } from '../workspace/types.js';

/** Heading of the advisory-conversation block appended to incorporation prompts. */
export const THREAD_CONTEXT_HEADING = '## Advisory conversation with the user';

/** Framing line that tells the specialist how to weigh the conversation. */
export const THREAD_CONTEXT_FRAMING =
  "This is the user's reasoning from chat. Inform the rewrite; do NOT contradict the explicit answers above.";

/** Hard cap on the assembled advisory block (heading + framing + rows). */
export const THREAD_CONTEXT_CHAR_CAP = 3000;

/** Only the most recent rows of a thread reach the prompt. */
const THREAD_CONTEXT_MAX_ROWS = 8;

/** Specialist replies are cut at this many chars (user text is kept whole). */
const THREAD_SPECIALIST_TRUNCATE = 400;

/**
 * The slice of ProjectStateManager this module needs. Kept structural so core
 * stays free of the concrete store implementation.
 */
export interface ThreadContextStateStore {
  /** Reads the persisted project state. */
  getState(): ProjectState;
  /** Persists project state (used only to stamp thread watermarks). */
  saveState(state: ProjectState): void;
}

/** Marker block that answer-applier appends for answers not yet incorporated. */
export const PENDING_INCORPORATION_MARKER = '## User Answers (Pending Incorporation)';

/**
 * Extracts the '## User Answers (Pending Incorporation)' block from doc
 * content: the marker heading and everything up to the next heading of any
 * level (or end of document). Returns null when no block is present. Inverse
 * companion of stripPendingBlock — used by the autopilot incorporation flow
 * to snapshot the block before a turn so a failed turn that consumed it can
 * re-append the snapshot (preserve-answers guarantee).
 *
 * @param content Full document content.
 * @returns The block text (starting with the marker heading), or null.
 */
export function extractPendingBlock(content: string): string | null {
  const idx = content.indexOf(PENDING_INCORPORATION_MARKER);
  if (idx < 0) {
    return null;
  }
  const tail = content.slice(idx);
  const nl = tail.indexOf('\n');
  if (nl < 0) {
    // Marker is the last line of the document.
    return tail;
  }
  const body = tail.slice(nl + 1);
  const nextHeading = body.match(/^#{1,6} /m);
  if (nextHeading && nextHeading.index !== undefined) {
    return tail.slice(0, nl + 1 + nextHeading.index);
  }
  // No later heading: the block extends to end of document.
  return tail;
}

/**
 * Removes a '## User Answers (Pending Incorporation)' block from doc content:
 * the marker heading and everything up to the next heading of any level (or
 * end of document). Used as the deterministic guard when a specialist turn
 * fails to strip the block itself.
 */
export function stripPendingBlock(content: string): string {
  const idx = content.indexOf(PENDING_INCORPORATION_MARKER);
  if (idx < 0) {
    return content;
  }
  const head = content.slice(0, idx);
  let tail = content.slice(idx);
  const nl = tail.indexOf('\n');
  if (nl >= 0) {
    tail = tail.slice(nl + 1);
    const nextHeading = tail.match(/^#{1,6} /m);
    if (nextHeading && nextHeading.index !== undefined) {
      return (head + tail.slice(nextHeading.index)).trimEnd() + '\n';
    }
  }
  // No later heading: the block extends to end of document.
  return head.trimEnd() + '\n';
}

/**
 * Builds the specialist userPrompt for one incorporation turn: revise the
 * document's normative text per the pending block, then remove the block.
 *
 * @param phaseId Workflow phase id (e.g. 'conops') — derives docs/ID.md.
 * @param threadContext Optional rendered advisory conversation
 *   (see collectThreadContext). When absent/empty the prompt is byte-identical
 *   to the prompt without conversation support.
 * @returns The full userPrompt string for executeTurn.
 */
export function buildIncorporationPrompt(phaseId: string, threadContext?: string): string {
  const base = `USER ANSWERS PENDING INCORPORATION detected in docs/${phaseId.toUpperCase()}.md.

User answers below are pending incorporation: revise the document's normative text to incorporate them per your answer-handling instructions, then REMOVE the '## User Answers (Pending Incorporation)' block once incorporated.

You MUST write the complete updated document to docs/${phaseId.toUpperCase()}.md using fs_write (or apply the edits with fs_edit). Your response must be the complete document content starting with a heading.`;
  if (!threadContext) {
    return base;
  }
  return `${base}\n\n${THREAD_CONTEXT_HEADING}\n\n${THREAD_CONTEXT_FRAMING}\n\n${threadContext}`;
}

/**
 * Minimal heading/fence strip for one thread row, mirroring the discipline of
 * research-preflight's sanitizeResearchLine. Not imported from there: that
 * module already imports this one, so importing back would create a runtime
 * cycle.
 *
 * @param line One line of model/user text.
 * @returns The line with markdown headings defused and fence markers broken.
 */
function sanitizeThreadLine(line: string): string {
  const stripped = line.replace(/^#+/, '');
  if (/^[=\-]+$/.test(stripped.trim())) {
    return '___';
  }
  return stripped.replace(/<{3}/g, '«««');
}

/**
 * Renders one thread row as a single prompt line. Recorded answers and
 * proposals are labelled so the specialist cannot mistake a draft for a
 * decision; specialist replies are truncated.
 *
 * @param row One advisory thread row.
 * @returns The rendered, sanitized single-line row.
 */
function renderThreadRow(row: PortalThreadMessage): string {
  const text = row.text.replace(/\s+/g, ' ').trim();
  if (row.kind === 'recorded') {
    return `ANSWER (recorded): ${sanitizeThreadLine(text)}`;
  }
  if (row.kind === 'proposal') {
    return `PROPOSAL (not recorded): ${sanitizeThreadLine(text)}`;
  }
  if (row.role === 'user') {
    return `USER: ${sanitizeThreadLine(text)}`;
  }
  const clipped =
    text.length > THREAD_SPECIALIST_TRUNCATE
      ? `${text.slice(0, THREAD_SPECIALIST_TRUNCATE).trimEnd()} …`
      : text;
  return `SPECIALIST: ${sanitizeThreadLine(clipped)}`;
}

/**
 * Collects the advisory conversations attached to the portal items of one
 * document and renders them for the incorporation prompt ONLY — never for the
 * document's pending block (the UNDO byte contract).
 *
 * Watermark: each injected item gets `meta.threadConsumedBy =
 * '<phaseId>:<lastRowTs>'`, so the same conversation is not injected twice for
 * the same phase. Items whose watermark already equals that marker are skipped.
 *
 * @param stateManager Project state store (read + watermark write).
 * @param phaseId Workflow phase id (e.g. 'rtm') — matches docs/ID.md.
 * @returns The rendered rows (no heading/framing), or undefined when there is
 *   nothing new to inject.
 */
export function collectThreadContext(stateManager: ThreadContextStateStore, phaseId: string): string | undefined {
  const docPath = `docs/${phaseId.toUpperCase()}.md`;
  const state = stateManager.getState();
  const items = (state.portalItems || []).filter(
    item => item.docPath === docPath && (item.status === 'open' || item.status === 'answered') && (item.meta?.thread?.length ?? 0) > 0
  );
  const fresh: PortalItem[] = [];
  const rows: PortalThreadMessage[] = [];
  for (const item of items) {
    const thread = item.meta!.thread!;
    const marker = `${phaseId}:${thread[thread.length - 1].ts}`;
    if (item.meta!.threadConsumedBy === marker) {
      continue;
    }
    fresh.push(item);
    rows.push(...thread);
  }
  if (rows.length === 0) {
    return undefined;
  }
  const ordered = rows.slice().sort((a, b) => a.ts - b.ts).slice(-THREAD_CONTEXT_MAX_ROWS);
  const prefixLength = `${THREAD_CONTEXT_HEADING}\n\n${THREAD_CONTEXT_FRAMING}\n\n`.length;
  // Drop whole rows from the oldest end until the assembled block fits the cap.
  while (ordered.length > 0) {
    const body = ordered.map(renderThreadRow).join('\n');
    if (prefixLength + body.length <= THREAD_CONTEXT_CHAR_CAP) {
      for (const item of fresh) {
        const thread = item.meta!.thread!;
        item.meta!.threadConsumedBy = `${phaseId}:${thread[thread.length - 1].ts}`;
      }
      stateManager.saveState(state);
      return body;
    }
    ordered.shift();
  }
  return undefined;
}

/**
 * Hybrid critic directive (from 62b4726) threaded to the critic for
 * incorporation turns: scopes grading to incorporation accuracy plus a
 * mandatory full-doc consistency scan, not the full phase rubric.
 */
export const INCORPORATION_CRITIC_FOCUS = 'Grade the incorporation turn on: (1) PRIMARY — each pending user answer accurately incorporated into normative text, no invented facts, block handled per instructions; (2) MANDATORY FULL-DOC CONSISTENCY SCAN — read the entire document and fail (score < 8.0) if the incorporation introduced any NEW contradiction, regression, or damage in ANY section; (3) baseline-binding and anti-fabrication guards apply in full. Do NOT deduct for imperfections that pre-date this turn and were not touched by the incorporation — those belong to the approved baseline and the normal phase flow, not this gate. Pass >= 8.0 when incorporation is accurate, complete, and the full-doc scan finds no new damage.';
