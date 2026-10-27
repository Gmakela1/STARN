import { CriticResult, enrichFeedbackWithCritic } from './critic.js';
import { ApproveArtifactInput } from './approvals.js';

export type CheckpointDecision = 'approve' | 'revise' | 'discard';

export interface PendingCheckpoint {
  specialistId: string;
  specialistName: string;
  output: string;
  criticResult?: CriticResult;
  createdAt: string;
}

/**
 * The approval fields the checkpoint resolution owns. The caller's injected
 * `approve` closure binds the execution context (projectPath, stateManager,
 * runChangeImpact) so this leaf stays pure and I/O-agnostic.
 */
export type CheckpointApprovalInput = Pick<ApproveArtifactInput, 'specialistId' | 'content' | 'title' | 'criticScore'>;

/**
 * Execution context injected by the caller. All fs/path/state access goes
 * through these hooks — the leaf never touches node:fs, node:path, or the
 * workspace state directly.
 */
export interface CheckpointResolutionDeps {
  /** Absolute path of the target artifact document (docs/<SPECIALIST>.md), built by the caller. */
  outPath: string;
  /** Reads the on-disk artifact: trimmed content when '# '-headed, else null (fallback to turn output). */
  readDiskArtifact: (outPath: string) => string | null;
  /** Returns workflow.activePhase — must be read AFTER approval resolves. */
  readActivePhase: () => string;
  /** Normalizes an absolute path to a repo-relative savedPath (forward slashes). */
  normalizeSavedPath: (absolutePath: string) => string;
  /** Applies the core approval mechanics with the caller-bound execution context. */
  approve: (args: CheckpointApprovalInput) => Promise<void>;
}

export type CheckpointOutcome =
  | { status: 'discarded' }
  | { status: 'revision_requested'; revisionPrompt: string }
  | { status: 'approved'; savedPath: string; nextPhase: string };

/**
 * Resolves a pending critic checkpoint.
 * - discard: cleared by the caller; nothing else happens.
 * - revise: cleared; returns a critic-enriched revision prompt.
 * - approve: prefers a '# '-headed on-disk artifact over the turn output,
 *   runs the core approval mechanics, then reads the next workflow phase.
 */
export async function resolvePendingCheckpoint(
  pending: PendingCheckpoint,
  decision: CheckpointDecision,
  feedback: string | undefined,
  deps: CheckpointResolutionDeps
): Promise<CheckpointOutcome> {
  if (decision === 'discard') {
    return { status: 'discarded' };
  }

  if (decision === 'revise') {
    const revisionPrompt = enrichFeedbackWithCritic(feedback ?? 'Please revise the deliverable.', pending.criticResult);
    return { status: 'revision_requested', revisionPrompt };
  }

  // approve — prefer the disk file (authoritative; written via fs_write)
  const content = deps.readDiskArtifact(deps.outPath) ?? pending.output;

  await deps.approve({
    specialistId: pending.specialistId,
    content,
    title: `${pending.specialistName} Document`,
    criticScore: pending.criticResult?.score
  });

  const nextPhase = deps.readActivePhase();
  const savedPath = deps.normalizeSavedPath(deps.outPath);
  return { status: 'approved', savedPath, nextPhase };
}