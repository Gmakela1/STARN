import fs from 'node:fs';
import path from 'node:path';
import { ProjectStateManager, ORDERED_WORKFLOW_PHASES } from '../workspace/state.js';
import { harvestDecisionLog } from './decision-log.js';

export interface ApproveArtifactInput {
  projectPath: string;
  stateManager: ProjectStateManager;
  specialistId: string;
  /** Full doc text to write to docs/{specialistId.toUpperCase()}.md. */
  content: string;
  /** Returns affected phase ids (used to re-draft downstream docs). */
  runChangeImpact?: (phaseId: string) => Promise<string[]>;
  /** Friendly artifact title. Defaults to `${ID} Document`. */
  title?: string;
  /** Critic score to store on the artifact record. */
  criticScore?: number;
  /**
   * Whether approveArtifact advances the workflow to the next phase when the
   * artifact's phase is the active phase. The CLI passes `false` because the
   * caller (src/index.ts) advances after the checkpoint returns; the web
   * adapters rely on the core advance. Defaults to `true`.
   */
  advance?: boolean;
}

export interface ApproveArtifactResult {
  changedSinceApproval: boolean;
  affectedDocs: string[];
  decisionCount: number;
}

/**
 * Extracts `docs/<ID>.md` document references from a change-impact report and
 * maps them to canonical workflow phase ids (normalized: underscores/hyphens
 * ignored). Returns phase ids in report order, deduplicated.
 */
export function parseAffectedPhaseIds(report: string): string[] {
  const affected: string[] = [];
  if (!report) return affected;
  const seen = new Set<string>();
  const docRefRe = /docs\/([A-Z0-9_\-]+)\.md/g;
  let m: RegExpExecArray | null;
  while ((m = docRefRe.exec(report)) !== null) {
    const raw = m[1].replace(/_/g, '').replace(/-/g, '').toLowerCase();
    for (const p of ORDERED_WORKFLOW_PHASES) {
      if (p.id.replace(/-/g, '').toLowerCase() === raw && !seen.has(p.id)) {
        seen.add(p.id);
        affected.push(p.id);
      }
    }
  }
  return affected;
}

function normalizePhaseKey(id: string): string {
  return id.toLowerCase().replace(/_/g, '').replace(/-/g, '');
}

/**
 * Shared approval primitive for all adapters: writes the deliverable to
 * docs/{ID}.md, records the approved artifact (content hash stored), harvests
 * design decisions, runs change-impact when the content changed since the last
 * approval, and advances the workflow when the artifact's phase is the active
 * phase.
 */
export async function approveArtifact(input: ApproveArtifactInput): Promise<ApproveArtifactResult> {
  const { projectPath, stateManager, specialistId, content } = input;
  const artifactId = specialistId.toUpperCase();

  // Detect re-approval with content changes BEFORE recordArtifact overwrites
  // the approved hash (mirrors cli/checkpoint.ts accept behavior). A first
  // approval has no prior hash baseline, so it counts as "changed" too — this
  // is what keeps change-impact running for the web/autopilot paths.
  const wasPreviouslyApproved = stateManager.isArtifactApproved(artifactId);
  const changedSinceApproval =
    !wasPreviouslyApproved || stateManager.hasContentChangedSinceApproval(artifactId);

  // Write the authoritative deliverable (same write style as the CLI accept path)
  const docsDir = path.join(projectPath, 'docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  const outPath = path.join(docsDir, `${artifactId}.md`);
  fs.writeFileSync(outPath, content, 'utf-8');

  stateManager.recordArtifact({
    id: artifactId,
    title: input.title ?? `${artifactId} Document`,
    path: path.relative(projectPath, outPath).replace(/\\/g, '/'),
    status: 'approved',
    criticScore: input.criticScore
  });

  // Harvest Design Decisions section into the centralized decision log
  const decisionCount = harvestDecisionLog(projectPath, specialistId);

  let affectedDocs: string[] = [];
  if (changedSinceApproval && input.runChangeImpact) {
    affectedDocs = await input.runChangeImpact(specialistId);
  }

  // Advance only when the artifact's phase is still the active phase — do NOT
  // advance when the active phase already moved past it (e.g. /goto reopen),
  // which would skip an in-progress phase.
  if (input.advance !== false) {
    const state = stateManager.getState();
    if (normalizePhaseKey(state.workflow.activePhase) === normalizePhaseKey(artifactId)) {
      stateManager.advanceToNextPhase();
    }
  }

  return { changedSinceApproval, affectedDocs, decisionCount };
}