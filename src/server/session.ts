import fs from 'node:fs';
import path from 'node:path';
import { CoreRunner, TurnResult } from '../core/runner.js';
import { approveArtifact, parseAffectedPhaseIds } from '../core/approvals.js';
import { CriticResult, enrichFeedbackWithCritic } from '../core/critic.js';
import { ChatMessage } from '../openrouter/types.js';
import { ChatClient } from '../openrouter/types.js';
import { Assignments, MODEL_ROLES, OPENROUTER_PROVIDER_ID, ProviderConfig, validateAssignments } from '../config.js';
import { allProviders, createProviderClient, createRoleClients, RoleClients } from '../models/role-clients.js';
import { ProjectStateManager } from '../workspace/state.js';
import { ToolRegistry } from '../tools/registry.js';
import { SpecialistRegistry } from '../specialists/registry.js';
import { Logger } from '../util/logger.js';
import { AutopilotDriver, AutopilotEvent } from '../core/autopilot.js';

export interface SessionDeps {
  projectPath: string;
  stateManager: ProjectStateManager;
  /** OpenRouter API key (built-in provider). */
  apiKey: string;
  providers: ProviderConfig[];
  assignments: Assignments;
  /** Test seam: builds a client for a provider. Defaults to real OpenAI-compatible clients. */
  clientFactory?: (p: ProviderConfig) => ChatClient;
  siteUrl?: string;
  appName?: string;
  toolRegistry: ToolRegistry;
  specialistRegistry: SpecialistRegistry;
  compressionThreshold?: number;
  keepRecentTokens?: number;
  logger?: Logger;
  /** Master toggle for scanned-document transcription (default true). */
  transcriptionEnabled?: boolean;
  /** Master toggle for autopilot mode (default true). This is a mutable property updated by applySettings. */
  autopilotEnabled?: boolean;
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

  setSessionMessages(messages: ChatMessage[]): void {
    this.sessionMessages = [...messages];
  }

  getSessionMessages(): ChatMessage[] {
    return [...this.sessionMessages];
  }
  private pending: PendingCheckpoint | null = null;
  private activeAbort: AbortController | null = null;

  private roleClients: RoleClients;

  /** Subscribers for autopilot events (SSE fan-out). */
  private subscribers: ((event: AutopilotEvent) => void)[] = [];

  /** Ring buffer of recent autopilot events for SSE reconnect backfill. */
  private recentEvents: AutopilotEvent[] = [];
  private static readonly MAX_RECENT_EVENTS = 20;

  /** Autopilot driver instance, created on start. */
  private autopilotDriver: AutopilotDriver | null = null;
  private autopilotController: AbortController | null = null;

  constructor(deps: SessionDeps) {
    this.deps = { ...deps, providers: deps.providers.map(p => ({ ...p })), assignments: cloneAssignments(deps.assignments) };
    this._autopilotEnabled = deps.autopilotEnabled ?? true;
    this.roleClients = this.buildRoleClients();
  }

  private buildRoleClients(): RoleClients {
    return createRoleClients(
      {
        apiKey: this.deps.apiKey,
        providers: this.deps.providers,
        assignments: this.deps.assignments,
        siteUrl: this.deps.siteUrl,
        appName: this.deps.appName,
        logger: this.deps.logger
      },
      this.deps.clientFactory
    );
  }

  private _autopilotEnabled: boolean;

  get autopilotEnabled(): boolean {
    return this._autopilotEnabled;
  }

  get busy(): boolean {
    return this.activeAbort !== null;
  }

  get apiKey(): string {
    return this.deps.apiKey;
  }

  get providers(): ProviderConfig[] {
    return this.deps.providers.map(p => ({ ...p }));
  }

  get assignments(): Assignments {
    return cloneAssignments(this.deps.assignments);
  }

  /** Drafting model (derived from assignments). */
  get model(): string {
    return this.deps.assignments.drafting.model;
  }

  /** Compaction model (derived from assignments). */
  get compactionModel(): string {
    return this.deps.assignments.compaction.model;
  }

  /** Provider config (built-in OpenRouter or user) by id; undefined when unknown. */
  providerById(providerId: string): ProviderConfig | undefined {
    return allProviders(this.deps.apiKey, this.deps.providers).find(p => p.id === providerId);
  }

  /** Fresh client for a provider id (for model listing / probing); undefined when unknown. */
  clientFor(providerId: string): ChatClient | undefined {
    const p = this.providerById(providerId);
    if (!p) return undefined;
    return this.deps.clientFactory
      ? this.deps.clientFactory(p)
      : createProviderClient(p, { siteUrl: this.deps.siteUrl, appName: this.deps.appName, logger: this.deps.logger });
  }

  /**
   * Validates and applies provider/assignment changes, then rebuilds role clients.
   * Throws (without mutating) on: reserved/duplicate provider ids, or any role
   * referencing an unknown provider.
   */
  applySettings(update: { providers?: ProviderConfig[]; assignments?: Partial<Assignments>; autopilotEnabled?: boolean }): void {
    const providers = update.providers ? update.providers.map(p => ({ ...p })) : this.providers;
    const ids = new Set<string>();
    for (const p of providers) {
      if (!p.id || p.id === OPENROUTER_PROVIDER_ID) throw new Error(`Provider id "${p.id}" is reserved or empty`);
      if (ids.has(p.id)) throw new Error(`Duplicate provider id "${p.id}"`);
      if (!p.name?.trim()) throw new Error(`Provider "${p.id}" needs a name`);
      if (!/^https?:\/\//i.test(p.baseUrl?.trim() ?? '')) {
        throw new Error(`Provider "${p.name}" base URL must start with http:// or https://`);
      }
      p.name = p.name.trim();
      p.baseUrl = p.baseUrl.trim();
      ids.add(p.id);
    }
    const assignments = cloneAssignments(this.deps.assignments);
    for (const role of MODEL_ROLES) {
      const a = update.assignments?.[role];
      if (a) assignments[role] = { providerId: String(a.providerId), model: String(a.model ?? '').trim() };
      if (!assignments[role].model) throw new Error(`Config error: role "${role}" has no model`);
    }
    validateAssignments(assignments, providers);
    this.deps.providers = providers;
    this.deps.assignments = assignments;
    if (typeof update.autopilotEnabled === 'boolean') {
      this._autopilotEnabled = update.autopilotEnabled;
    }
    this.roleClients = this.buildRoleClients();
  }


  getPendingCheckpoint(): PendingCheckpoint | null {
    return this.pending;
  }

  /**
   * Switches the active project in the session.
   * Throws if an agent turn is busy or a checkpoint is pending.
   * Clears session messages and updates project path, state manager, and logger.
   */
  switchProject(newPath: string, newStateManager: ProjectStateManager, newLogger?: Logger): void {
    if (this.busy) {
      throw new Error('Cannot switch projects while an agent turn is running.');
    }
    if (this.pending) {
      throw new Error('Cannot switch projects while a review is waiting.');
    }
    this.sessionMessages = [];
    this.deps.projectPath = newPath;
    this.deps.stateManager = newStateManager;
    if (newLogger) {
      this.deps.logger = newLogger;
    }
    this.roleClients = this.buildRoleClients();
  }

  /**
   * Begins a turn: creates and stores an AbortController, marks busy.
   * Throws if already busy (409 conflict).
   */
  private beginTurn(): AbortController {
    if (this.busy) {
      throw new Error('A turn is already in progress');
    }
    const abort = new AbortController();
    this.activeAbort = abort;
    return abort;
  }

  /** Ends the turn: clears the active AbortController. */
  private endTurn(): void {
    this.activeAbort = null;
  }

  /** Aborts the in-flight turn, if any. Returns true when something was aborted. */
  abortActiveTurn(): boolean {
    if (!this.activeAbort) return false;
    this.activeAbort.abort();
    return true;
  }

  // ── Subscriber management for autopilot events ────────────────────────

  addSubscriber(fn: (event: AutopilotEvent) => void): void {
    this.subscribers.push(fn);
  }

  removeSubscriber(fn: (event: AutopilotEvent) => void): void {
    const idx = this.subscribers.indexOf(fn);
    if (idx >= 0) {
      this.subscribers.splice(idx, 1);
    }
  }

  private publish(event: AutopilotEvent): void {
    // Store in ring buffer
    this.recentEvents.push(event);
    if (this.recentEvents.length > ServerSessionManager.MAX_RECENT_EVENTS) {
      this.recentEvents.shift();
    }
    // Fan out to subscribers, catching individual errors
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        // Subscriber error swallowed to prevent one bad subscriber from
        // breaking the entire fan-out.
      }
    }
  }

  getRecentAutopilotEvents(): AutopilotEvent[] {
    return [...this.recentEvents];
  }

  // ── Autopilot driver integration ──────────────────────────────────────

  /**
   * Starts the autopilot chain driver. Acquires the busy guard.
   * Throws 409 if a turn is already in progress.
   */
  autopilotStart(): void {
    const abort = this.beginTurn();
    this.autopilotController = abort;

    const deps = {
      stateManager: this.deps.stateManager,
      projectPath: this.deps.projectPath,
      executeTurn: async (opts: {
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
      }) => {
        const { CoreRunner: Runner } = await import('../core/runner.js');
        return Runner.executeTurn({
          userPrompt: opts.userPrompt,
          projectPath: this.deps.projectPath,
          stateManager: this.deps.stateManager,
          client: this.roleClients.drafting.client,
          model: this.roleClients.drafting.model,
          draftingProviderName: this.roleClients.drafting.providerName,
          criticClient: this.roleClients.critic.client,
          criticModel: this.roleClients.critic.model,
          classifierClient: this.roleClients.classifier.client,
          classifierModel: this.roleClients.classifier.model,
          compactionClient: this.roleClients.compaction.client,
          compactionModel: this.roleClients.compaction.model,
          transcriberClient: this.roleClients.transcriber?.client,
          transcriberModel: this.roleClients.transcriber?.model,
          transcriptionEnabled: this.deps.transcriptionEnabled,
          toolRegistry: this.deps.toolRegistry,
          specialistRegistry: this.deps.specialistRegistry,
          sessionMessages: this.sessionMessages,
          compressionThreshold: this.deps.compressionThreshold,
          keepRecentTokens: this.deps.keepRecentTokens,
          logger: this.deps.logger,
          signal: opts.signal ?? abort.signal,
          forceSpecialistId: opts.forceSpecialistId,
          onQuestions: opts.onQuestions
        });
      }
    };

    this.autopilotDriver = new AutopilotDriver(deps, (ev) => this.publish(ev));
    this.autopilotDriver.start();
  }

  /** Stops the autopilot chain driver and releases the busy guard. */
  autopilotStop(): void {
    if (this.autopilotDriver) {
      this.autopilotDriver.stop();
      this.autopilotDriver = null;
    }
    this.autopilotController = null;
    this.endTurn();
  }

  /** Resumes the autopilot from a specific doc or the first unapproved phase. */
  autopilotResume(docId?: string): void {
    if (!this.autopilotDriver) {
      // Create a fresh driver if none exists
      const abort = this.beginTurn();
      this.autopilotController = abort;

      const deps = {
        stateManager: this.deps.stateManager,
        projectPath: this.deps.projectPath,
        executeTurn: async (opts: {
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
        }) => {
          const { CoreRunner: Runner } = await import('../core/runner.js');
          return Runner.executeTurn({
            userPrompt: opts.userPrompt,
            projectPath: this.deps.projectPath,
            stateManager: this.deps.stateManager,
            client: this.roleClients.drafting.client,
            model: this.roleClients.drafting.model,
            draftingProviderName: this.roleClients.drafting.providerName,
            criticClient: this.roleClients.critic.client,
            criticModel: this.roleClients.critic.model,
            classifierClient: this.roleClients.classifier.client,
            classifierModel: this.roleClients.classifier.model,
            compactionClient: this.roleClients.compaction.client,
            compactionModel: this.roleClients.compaction.model,
            transcriberClient: this.roleClients.transcriber?.client,
            transcriberModel: this.roleClients.transcriber?.model,
            transcriptionEnabled: this.deps.transcriptionEnabled,
            toolRegistry: this.deps.toolRegistry,
            specialistRegistry: this.deps.specialistRegistry,
            sessionMessages: this.sessionMessages,
            compressionThreshold: this.deps.compressionThreshold,
            keepRecentTokens: this.deps.keepRecentTokens,
            logger: this.deps.logger,
            signal: opts.signal ?? abort.signal,
            forceSpecialistId: opts.forceSpecialistId,
            onQuestions: opts.onQuestions
          });
        }
      };

      this.autopilotDriver = new AutopilotDriver(deps, (ev) => this.publish(ev));
    }
    this.autopilotDriver.resume(docId);
  }

  /**
   * Runs one agent turn, emitting SSE-style events through the emitter:
   * status, tool_call, checkpoint, complete, error.
   */
  async runTurn(prompt: string, emit: TurnEmitter): Promise<TurnResult> {
    const abort = this.beginTurn();

    try {
      const result = await CoreRunner.executeTurn({
        userPrompt: prompt,
        projectPath: this.deps.projectPath,
        stateManager: this.deps.stateManager,
        client: this.roleClients.drafting.client,
        model: this.roleClients.drafting.model,
        draftingProviderName: this.roleClients.drafting.providerName,
        criticClient: this.roleClients.critic.client,
        criticModel: this.roleClients.critic.model,
        classifierClient: this.roleClients.classifier.client,
        classifierModel: this.roleClients.classifier.model,
        compactionClient: this.roleClients.compaction.client,
        compactionModel: this.roleClients.compaction.model,
        transcriberClient: this.roleClients.transcriber?.client,
        transcriberModel: this.roleClients.transcriber?.model,
        transcriptionEnabled: this.deps.transcriptionEnabled,
        toolRegistry: this.deps.toolRegistry,
        specialistRegistry: this.deps.specialistRegistry,
        sessionMessages: this.sessionMessages,
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
      this.endTurn();
    }
  }

  /**
   * Resolves the pending checkpoint.
   * - approve: writes the deliverable to docs/<ID>.md and records it approved.
   * - revise: clears the checkpoint and returns a critic-enriched revision prompt.
   * - discard: clears the checkpoint.
   */
  async resolveCheckpoint(decision: CheckpointDecision, feedback?: string): Promise<{
    status: 'approved' | 'revision_requested' | 'discarded';
    savedPath?: string;
    revisionPrompt?: string;
    nextPhase?: string;
  }> {
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
    const outPath = path.join(projectPath, 'docs', docName);

    let content = pending.output;
    try {
      const onDisk = fs.readFileSync(outPath, 'utf-8').trim();
      if (onDisk && onDisk.startsWith('# ')) content = onDisk;
    } catch {
      // no disk file yet — use the turn output
    }

    // Core approval mechanics (write + recordArtifact hash + decision harvesting
    // + change-impact). The web path gains the change-impact parity the CLI has.
    await approveArtifact({
      projectPath,
      stateManager,
      specialistId: pending.specialistId,
      content,
      title: `${pending.specialistName} Document`,
      criticScore: pending.criticResult?.score,
      runChangeImpact: phaseId => this.runChangeImpactForApproval(phaseId)
    });

    this.pending = null;
    const nextPhase = stateManager.getState().workflow.activePhase;
    return {
      status: 'approved',
      savedPath: path.relative(projectPath, outPath).replace(/\\/g, '/'),
      nextPhase
    };
  }

  /**
   * Runs the change-impact package programmatically with the drafting client
   * (web parity with the CLI re-approval flow). Returns affected phase ids.
   * Kept in the server layer (not core) because it imports the agent tool loop.
   */
  async runChangeImpactForApproval(phaseId: string): Promise<string[]> {
    const { projectPath, stateManager, toolRegistry } = this.deps;
    try {
      const { runAgentToolLoop } = await import('../core/agent-loop.js');
      const { changeImpactPackage } = await import('../specialists/packages/change-impact/index.js');
      const impactResult = await runAgentToolLoop({
        client: this.roleClients.drafting.client,
        model: this.roleClients.drafting.model,
        systemPrompt: changeImpactPackage.systemPrompt,
        userMessage: `Analyze the impact of changes to ${phaseId}. Compare the current docs/${phaseId}.md against all other approved/draft documents in docs/. Identify which downstream documents are now inconsistent and what specific sections/interfaces/requirements are affected.`,
        toolRegistry,
        allowedTools: changeImpactPackage.allowedTools,
        context: { projectPath, stateManager }
      });
      return parseAffectedPhaseIds(impactResult.finalResponse);
    } catch (err: any) {
      this.deps.logger?.error(`Change-impact analysis failed: ${err?.message ?? err}`);
      return [];
    }
  }
}

function cloneAssignments(a: Assignments): Assignments {
  return {
    drafting: { ...a.drafting },
    critic: { ...a.critic },
    classifier: { ...a.classifier },
    compaction: { ...a.compaction },
    transcriber: { ...a.transcriber }
  };
}
