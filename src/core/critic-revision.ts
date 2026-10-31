/**
 * Pure builders for critic revision guidance and the session critic note.
 *
 * Extracted verbatim from the core runner (behavior-preserving refactor):
 *  - `buildRevisionGuidance` reproduces both branches of the runner's revision
 *    prompt literal, byte-identically, then appends the REVISION SCOPE &
 *    MANDATE block (scope-only fix mandate + tool-grounded research +
 *    baseline-conflict escape hatch).
 *  - `buildCriticNote` reproduces the runner's critic note assembly, byte-identically.
 */
import type { CriticResult } from './critic.js';

/**
 * The REVISION SCOPE & MANDATE block appended to both revision branches.
 *
 * Scopes the specialist's revision turn to exactly the critic-flagged issues,
 * authorizes tool-grounded research (web_search, doc_transcribe, fs_read), and
 * routes any fix that would touch an approved upstream baseline figure to the
 * baseline-conflict protocol instead of a silent change.
 */
const REVISION_SCOPE_MANDATE =
  'REVISION SCOPE & MANDATE: Address ONLY the issues the critic flagged, in the sections named. ' +
  'You are authorized and expected to think through each flagged item and use your tools to ground the fix — ' +
  'web_search for sourcing/market data, doc_transcribe for image-only datasheets in reference/, ' +
  'fs_read for baseline context. Do NOT restructure or rewrite unrelated sections. ' +
  'If a flagged fix would require changing an approved upstream baseline figure (DD/ICD/requirements value), ' +
  'do NOT change it: apply the baseline-conflict protocol instead — keep the approved figure binding, ' +
  'mark affected rows/items pending reconciliation, and record the conflict as an Open Question.';

/**
 * Build the auto-revision prompt sent back to the drafting loop when the critic
 * does not pass.
 *
 * @param result       the critic result for this revision pass
 * @param isDeltaReview true → targeted-edit (fs_edit) revision branch;
 *                      false → plain full-draft revision branch
 * @param docId        the deliverable id (uppercased specialist id), used to
 *                     build `docs/<docId>.md` in the targeted-edit branch
 * @returns the revision prompt: existing guidance text (untouched) followed by
 *          a blank line and the REVISION SCOPE & MANDATE block
 */
export function buildRevisionGuidance(
  result: CriticResult,
  isDeltaReview: boolean,
  docId: string
): string {
  const weaknesses = (result.weaknesses || []).map(w => `- ${w}`).join('\n');
  const guidance = result.actionableGuidance || 'Fix weaknesses';
  if (isDeltaReview) {
    return (
      `The Critic evaluated your targeted edits to docs/${docId}.md and found the following issues:\n` +
      `${weaknesses}\n\n` +
      `Actionable Guidance:\n${guidance}\n\n` +
      `INSTRUCTION: Use the fs_edit tool to surgically resolve these specific issues in the document. Do NOT rewrite or regenerate the entire document.\n\n` +
      REVISION_SCOPE_MANDATE
    );
  }
  return (
    `The Critic evaluated your draft and found the following weaknesses:\n${weaknesses}\n\n` +
    `Actionable Guidance:\n${guidance}\n\n` +
    `Please revise the deliverable to resolve all weaknesses while maintaining rigorous physical engineering standards and program alignment.\n\n` +
    REVISION_SCOPE_MANDATE
  );
}

/**
 * Build the `[Critic Review for X]: Score: ...` session note appended to the
 * conversation after a critic pass.
 *
 * The note format is byte-identical to the runner's inline assembly: score
 * always, then optional Summary / Weaknesses / Actionable Guidance lines.
 * `passed` is accepted for call-site symmetry but is not encoded in the note.
 */
export function buildCriticNote(
  specialistName: string,
  result: CriticResult | undefined,
  passed: boolean
): string {
  if (!result) {
    return '';
  }
  let criticNote = `[Critic Review for ${specialistName}]: Score: ${result.score.toFixed(1)}/10.`;
  if (result.summary) {
    criticNote += `\nSummary: ${result.summary}`;
  }
  if (result.weaknesses && result.weaknesses.length > 0) {
    criticNote += `\nWeaknesses:\n${result.weaknesses.map(w => `- ${w}`).join('\n')}`;
  }
  if (result.actionableGuidance) {
    criticNote += `\nActionable Guidance: ${result.actionableGuidance}`;
  }
  return criticNote;
}