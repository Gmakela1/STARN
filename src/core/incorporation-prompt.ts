/**
 * Shared incorporation-turn prompt directives and the pending-answers block
 * marker/strip helper. Used by BOTH the autopilot chain (pre-phase
 * incorporation) and the answer applier (idle incorporation when the last
 * open question for a document is answered) so the two paths cannot drift.
 */

/** Marker block that answer-applier appends for answers not yet incorporated. */
export const PENDING_INCORPORATION_MARKER = '## User Answers (Pending Incorporation)';

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
 * @returns The full userPrompt string for executeTurn.
 */
export function buildIncorporationPrompt(phaseId: string): string {
  return `USER ANSWERS PENDING INCORPORATION detected in docs/${phaseId.toUpperCase()}.md.

User answers below are pending incorporation: revise the document's normative text to incorporate them per your answer-handling instructions, then REMOVE the '## User Answers (Pending Incorporation)' block once incorporated.

You MUST write the complete updated document to docs/${phaseId.toUpperCase()}.md using fs_write (or apply the edits with fs_edit). Your response must be the complete document content starting with a heading.`;
}

/**
 * Hybrid critic directive (from 62b4726) threaded to the critic for
 * incorporation turns: scopes grading to incorporation accuracy plus a
 * mandatory full-doc consistency scan, not the full phase rubric.
 */
export const INCORPORATION_CRITIC_FOCUS = 'Grade the incorporation turn on: (1) PRIMARY — each pending user answer accurately incorporated into normative text, no invented facts, block handled per instructions; (2) MANDATORY FULL-DOC CONSISTENCY SCAN — read the entire document and fail (score < 8.0) if the incorporation introduced any NEW contradiction, regression, or damage in ANY section; (3) baseline-binding and anti-fabrication guards apply in full. Do NOT deduct for imperfections that pre-date this turn and were not touched by the incorporation — those belong to the approved baseline and the normal phase flow, not this gate. Pass >= 8.0 when incorporation is accurate, complete, and the full-doc scan finds no new damage.';
