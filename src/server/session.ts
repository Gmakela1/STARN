import fs from 'node:fs';
import path from 'node:path';
import { CoreRunner, TurnResult } from '../core/runner.js';
import { CriticResult, enrichFeedbackWithCritic } from '../core/critic.js';
import { ChatMessage } from '../openrouter/types.js';
import { OpenRouterClient } from '../openrouter/client.js';
import { ProjectStateManager } from '../workspace/state.js';
import { ToolRegistry } from '../tools/registry.js';
import { SpecialistRegistry } from '../specialists/registry.js';
import { Logger } from '../util/logger.js';

export interface SessionDeps {
  projectPath: string;
  stateManager: ProjectStateManager;
  client: OpenRouterClient;
  model: string;
  toolRegistry: ToolRegistry;
  specialistRegistry: SpecialistRegistry;
  compactionModel?: string;
  compressionThreshold?: number;
  keepRecentTokens?: number;
  logger?: Logger;
}

export interface PendingCheckpoint {
  specialistId: string;
  specialistName: string;
  output: string;
  criticResult?: CriticResult;
  createdAt: string;
}

export type TurnEmitter = (event: string, data: unknown) => void;

export type CheckpointDecision = 'approve' | 'revise' | 'discard';

/**
 * Coordinates agent turn execution for the web adapter: a single serialized
 * turn at a time, SSE event emission, abort support, and the pending critic
 * checkpoint that survives browser reconnects (in-memory only — critic
 * findings are never persisted to state.json).
 */
export class ServerSessionManager {
  private deps: SessionDeps;
  private sessionMessages: ChatMessage[] = [];
  private pending: PendingCheckpoint | null = null;
  private activeAbort: AbortController | null = null;

  constructor(deps: SessionDeps) {
    this.deps = deps;
  }

  get busy(): boolean {
    return this.activeAbort !== null;
  }

  get model(): string {
    return this.deps.model;
  }

  setModel(model: string): void {
    this.deps.model = model;
  }

  setCompactionModel(model: string): void {
    this.deps.compactionModel = model;
  }

  get compactionModel(): string | undefined {
    return this.deps.compactionModel;
  }

  getPendingCheckpoint(): PendingCheckpoint | null {
    return this.pending;
  }

  /** Aborts the in-flight turn, if any. Returns true when something was aborted. */
  abortActiveTurn(): boolean {
    if (!this.activeAbort) return false;
    this.activeAbort.abort();
    return true;
  }

  /**
   * Runs one agent turn, emitting SSE-style events through the emitter:
   * status, tool_call, checkpoint, complete, error.
   */
  async runTurn(prompt: string, emit: TurnEmitter): Promise<TurnResult> {
    if (this.busy) {
      throw new Error('A turn is already in progress');
    }
    const abort = new AbortController();
    this.activeAbort = abort;

    try {
      const result = await CoreRunner.executeTurn({
        userPrompt: prompt,
        projectPath: this.deps.projectPath,
        stateManager: this.deps.stateManager,
        client: this.deps.client,
        model: this.deps.model,
        toolRegistry: this.deps.toolRegistry,
        specialistRegistry: this.deps.specialistRegistry,
        sessionMessages: this.sessionMessages,
        compactionModel: this.deps.compactionModel,
        compressionThreshold: this.deps.compressionThreshold,
        keepRecentTokens: this.deps.keepRecentTokens,
        logger: this.deps.logger,
        signal: abort.signal,
        onStatusUpdate: status => emit('status', { status }),
        onToolCall: (tool, args) => emit('tool_call', { tool, args })
      });

      this.sessionMessages = result.sessionMessages;

      if (result.requiresReview) {
        this.pending = {
          specialistId: result.specialistId,
          specialistName: result.specialistName,
          output: result.output,
          criticResult: result.criticResult,
          createdAt: new Date().toISOString()
        };
        emit('checkpoint', this.pending);
      }

      emit('complete', {
        specialistId: result.specialistId,
        specialistName: result.specialistName,
        output: result.output,
        criticResult: result.criticResult,
        requiresReview: result.requiresReview,
        aborted: result.aborted ?? false
      });

      return result;
    } finally {
      this.activeAbort = null;
    }
  }

  /**
   * Resolves the pending checkpoint.
   * - approve: writes the deliverable to docs/<ID>.md and records it approved.
   * - revise: clears the checkpoint and returns a critic-enriched revision prompt.
   * - discard: clears the checkpoint.
   */
  resolveCheckpoint(decision: CheckpointDecision, feedback?: string): {
    status: 'approved' | 'revision_requested' | 'discarded';
    savedPath?: string;
    revisionPrompt?: string;
  } {
    const pending = this.pending;
    if (!pending) {
      throw new Error('No checkpoint is pending');
    }

    if (decision === 'discard') {
      this.pending = null;
      return { status: 'discarded' };
    }

    if (decision === 'revise') {
      const revisionPrompt = enrichFeedbackWithCritic(feedback ?? 'Please revise the deliverable.', pending.criticResult);
      this.pending = null;
      return { status: 'revision_requested', revisionPrompt };
    }

    // approve — prefer the disk file (authoritative; written via fs_write)
    const { projectPath, stateManager } = this.deps;
    const docName = `${pending.specialistId.toUpperCase()}.md`;
    const docsDir = path.join(projectPath, 'docs');
    const outPath = path.join(docsDir, docName);

    let content = pending.output;
    try {
      const onDisk = fs.readFileSync(outPath, 'utf-8').trim();
      if (onDisk && onDisk.startsWith('# ')) content = onDisk;
    } catch {
      // no disk file yet — use the turn output
    }

    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(outPath, content, 'utf-8');

    stateManager.recordArtifact({
      id: pending.specialistId.toUpperCase(),
      title: `${pending.specialistName} Document`,
      path: path.relative(projectPath, outPath).replace(/\\/g, '/'),
      status: 'approved',
      criticScore: pending.criticResult?.score
    });

    this.pending = null;
    return { status: 'approved', savedPath: path.relative(projectPath, outPath).replace(/\\/g, '/') };
  }
}
