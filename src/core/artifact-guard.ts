/**
 * Pure, I/O-agnostic drafting-artifact guard.
 *
 * Reproduces the skip-critic + surface-error decision tree that the core runner
 * applies before the critic while-loop. Extracted verbatim from the runner's
 * guard block (behavior-preserving refactor; byte-identical messages).
 */

export type ArtifactClassification =
  | { kind: 'document'; artifact: string }
  | { kind: 'commentary'; artifact: string }
  | { kind: 'none'; reason: 'no-tool-calls-no-document' | 'empty' };

/**
 * Classify the turn's artifact before critic evaluation.
 *
 * Decision tree (matches the runner's exact guard logic):
 *  1. Model made no tool calls, wrote nothing to disk, and its response contains
 *     no markdown heading (`# `) → the drafting model produced no document at all.
 *  2. The artifact (possibly recovered from disk) is empty → 'none'/'empty'.
 *  3. The artifact's first (non-whitespace) character is not `#` → the model
 *     returned commentary instead of a deliverable (d7246e9 rule: the artifact
 *     passes only if the first line starts with '#').
 *  4. Otherwise → a valid document, safe to send to the critic.
 *
 * When the drafting model wrote the file to disk but replied with commentary,
 * the caller recovers the on-disk content and passes it as `raw`; it classifies
 * as 'document' and the critic runs against the on-disk artifact.
 */
export function classifyTurnArtifact(
  raw: string | null | undefined,
  madeToolCalls: boolean,
  wroteToDisk: boolean
): ArtifactClassification {
  const text = raw ?? '';

  // Guard: the drafting model made no tool calls and neither wrote nor returned
  // a document. Common with local models that lack tool calling.
  if (!madeToolCalls && !wroteToDisk && !text.includes('# ')) {
    return { kind: 'none', reason: 'no-tool-calls-no-document' };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: 'none', reason: 'empty' };
  }

  // Guard: even when tool calls were made, the artifact must be a valid
  // markdown document (first line starts with '#'). Prose like "I have drafted
  // the document..." is commentary, not a deliverable.
  if (!trimmed.startsWith('#')) {
    return { kind: 'commentary', artifact: text };
  }

  return { kind: 'document', artifact: text };
}

/**
 * Byte-identical to the runner's no-document guard message body. The caller
 * appends `\n\nModel reply:\n<reply>` when a model reply exists.
 */
export function buildNoDocumentError(model: string, providerName: string): string {
  return `Drafting model "${model}" on "${providerName}" produced no document. ` +
    `It may not support tool calling. Reassign drafting in Settings or /models.`;
}