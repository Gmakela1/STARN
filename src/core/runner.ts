import path from 'node:path';
import fs from 'node:fs';
import { ProjectStateManager } from '../workspace/state.js';
import { ToolRegistry } from '../tools/registry.js';
import { ToolExecutionContext, EditEntry } from '../tools/types.js';
import { SpecialistRegistry } from '../specialists/registry.js';
import { SHARED_EDIT_INSTRUCTIONS } from '../specialists/shared.js';
import { ChatClient, ChatMessage } from '../openrouter/types.js';
import { runDiscovery } from './discovery.js';
import { classifyRequest } from './classifier.js';
import { runAgentToolLoop } from './agent-loop.js';
import { maybeCompact } from './compaction.js';
import { Logger } from '../util/logger.js';
import { CriticEvaluator, CriticResult, BaselineDocument } from './critic.js';
import { TurnFormatters, headlessFormatters } from './formatters.js';
import { resolvePhaseRef, ORDERED_WORKFLOW_PHASES } from '../workspace/state.js';

export interface TurnOptions {
  userPrompt: string;
  projectPath: string;
  stateManager: ProjectStateManager;
  /** Drafting + intake client/model. Other roles fall back to these when unset. */
  client: ChatClient;
  model: string;
  criticClient?: ChatClient;
  criticModel?: string;
  classifierClient?: ChatClient;
  classifierModel?: string;
  compactionClient?: ChatClient;
  /** Provider name of the drafting client, used in the no-document guard message. */
  draftingProviderName?: string;
  toolRegistry: ToolRegistry;
  specialistRegistry: SpecialistRegistry;
  sessionMessages?: ChatMessage[];
  compactionModel?: string;
  compressionThreshold?: number;
  keepRecentTokens?: number;
  logger?: Logger;
  onStatusUpdate?: (status: string) => void;
  onToolCall?: (tool: string, args: any) => void;
  signal?: AbortSignal;
  /**
   * Presentation-specific formatters for quick-command outputs. Defaults to
   * headless plain-text formatters; the terminal CLI injects chalk-styled ones.
   */
  formatters?: TurnFormatters;
}

export interface TurnResult {
  specialistId: string;
  specialistName: string;
  output: string;
  criticResult?: CriticResult;
  autoRevisionsRun: number;
  requiresReview: boolean;
  sessionMessages: ChatMessage[];
  aborted?: boolean;
  /** True when the turn failed in a way the user must act on (e.g. drafting model produced no document). */
  error?: boolean;
}

export class CoreRunner {
  // In-memory sticky hint: the last specialist that ran. Helps the classifier
  // route short conversational replies (e.g. answers to a specialist's question)
  // back to the same specialist. Resets on session restart; cleared on /goto.
  private static lastActiveSpecialistId: string | undefined;

  static async executeTurn(options: TurnOptions): Promise<TurnResult> {
    const {
      userPrompt,
      projectPath,
      stateManager,
      client,
      model,
      toolRegistry,
      specialistRegistry,
      onStatusUpdate,
      onToolCall,
      signal
    } = options;
    let sessionMessages = options.sessionMessages ?? [];
    const fmt = options.formatters ?? headlessFormatters;

    const state = stateManager.getState();
    const activeWorkflowPhase = state.workflow?.activePhase || 'conops';

    // 0. Handle quick commands (/plan, /roadmap, /status, /help, /goto, /questions)
    const trimmed = userPrompt.trim().toLowerCase();
    const quickCommandResult = (specialistName: string, output: string): TurnResult => ({
      specialistId: 'general',
      specialistName,
      output,
      autoRevisionsRun: 0,
      requiresReview: false,
      sessionMessages: [
        ...sessionMessages,
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: output }
      ]
    });

    if (trimmed === '/plan' || trimmed === '/roadmap' || trimmed === '/status') {
      return quickCommandResult('Project Workflow Planner', fmt.formatWorkflowRoadmap(state, projectPath));
    }

    if (trimmed === '/help') {
      return quickCommandResult('Help', fmt.formatHelp());
    }

    if (trimmed === '/compact') {
      // Force compaction now using the configured compaction model
      const compactionResult = await maybeCompact({
        client: options.compactionClient ?? client,
        messages: sessionMessages,
        compactionModel: options.compactionModel || model,
        threshold: 0, // force compaction regardless of size
        keepRecentTokens: options.keepRecentTokens ?? 20000,
        logger: options.logger
      });
      return {
        specialistId: 'general',
        specialistName: 'Session Compaction',
        output: compactionResult.compacted
          ? `✓ Compacted session. ${compactionResult.tokensBefore} → ${compactionResult.tokensAfter} tokens.`
          : 'Nothing to compact (session too small).',
        autoRevisionsRun: 0,
        requiresReview: false,
        sessionMessages: compactionResult.messages
      };
    }

    if (trimmed === '/questions') {
      return quickCommandResult('Open Questions Report', fmt.formatOpenQuestionsReport(state, projectPath));
    }

    if (trimmed.startsWith('/goto')) {
      const arg = userPrompt.trim().slice('/goto'.length).trim();
      const phase = resolvePhaseRef(arg);
      if (!phase) {
        const msg = `Unknown phase: "${arg}". Use a phase number (1-${state.workflow?.phases ? Object.keys(state.workflow.phases).length : 12}), a phase id (e.g. "bom"), or a name fragment (e.g. "risk").\n\nTry /plan to see the phase list.`;
        return quickCommandResult('Project Workflow Planner', msg);
      }
      // REOPEN CHECK: if the target phase's artifact is approved, signal the UI
      // to prompt the user for a revert-to-draft (with downstream re-locking).
      const artifactId = phase.id.toUpperCase();
      if (stateManager.isArtifactApproved(artifactId)) {
        const idx = ORDERED_WORKFLOW_PHASES.findIndex(p => p.id === phase.id);
        const downstream = ORDERED_WORKFLOW_PHASES.slice(idx + 1).map(p => p.name).join(', ');
        // Explicit /goto: clear the sticky hint so the next turn classifies fresh.
        CoreRunner.lastActiveSpecialistId = undefined;
        return {
          specialistId: 'general',
          specialistName: 'Reopen Artifact',
          output: `__REOPEN_PROMPT__:${artifactId}:${downstream}`,
          autoRevisionsRun: 0,
          requiresReview: false,
          sessionMessages: [...sessionMessages, { role: 'user', content: userPrompt }]
        };
      }
      stateManager.setActivePhase(phase.id);
      const updated = stateManager.getState();
      return quickCommandResult(
        'Project Workflow Planner',
        `★ Active phase switched to ${phase.name}.\n\n${fmt.formatWorkflowRoadmap(updated, projectPath)}`
      );
    }

    // 1. Classification (phase-aware with phase locking, with conversation history)
    onStatusUpdate?.('Classifying request...');
    let specialistId = await classifyRequest(
      userPrompt,
      options.classifierClient ?? client,
      options.classifierModel ?? model,
      activeWorkflowPhase,
      sessionMessages.slice(-6),
      CoreRunner.lastActiveSpecialistId
    );
    let specialist = specialistRegistry.get(specialistId) || specialistRegistry.get('general')!;

    // 2. Prerequisite Check Gate
    const prereqIds: string[] = [];
    if (specialist.prerequisiteArtifactId) {
      prereqIds.push(specialist.prerequisiteArtifactId);
    }
    if (specialist.prerequisiteArtifactIds) {
      prereqIds.push(...specialist.prerequisiteArtifactIds);
    }

    if (prereqIds.length > 0) {
      const unmetPrereqs = prereqIds.filter(id => !stateManager.isArtifactApproved(id));
      if (unmetPrereqs.length > 0) {
        const explanation = `Prerequisite Required: The following deliverables have not yet been approved for this project:
${unmetPrereqs.map(id => {
          const pkg = specialistRegistry.get(id.toLowerCase());
          return `  - ${pkg?.name || id} (${id}.md)`;
        }).join('\n')}

Please complete and approve these before proceeding to ${specialist.name}.`;
        
        return {
          specialistId: 'general',
          specialistName: 'General / Project Lead',
          output: explanation,
          autoRevisionsRun: 0,
          requiresReview: false,
          sessionMessages: [
            ...sessionMessages,
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: explanation }
          ]
        };
      }
    }

    // Update active phase if shifting to a formal specialist
    if (specialist.id !== 'general' && state.workflow?.phases[specialist.id]) {
      stateManager.setActivePhase(specialist.id);
    }

    // 3. Mandatory Discovery
    onStatusUpdate?.('Running mandatory project discovery...');
    const discovery = await runDiscovery(projectPath, stateManager);

    // 4. Adaptive Story-Based Intake Interview for CONOPS if not yet completed
    const hasApprovedConops = stateManager.isArtifactApproved('CONOPS');
    if (specialist.id === 'conops' && !hasApprovedConops && !state.intake.completed) {
      const intake = state.intake;
      const qIndex = intake.currentQuestionIndex;

      // Question 1: Project Identity (auto-capture if already provided)
      if (qIndex === 0 && !intake.answers.projectName) {
        stateManager.recordIntakeAnswer('projectName', userPrompt);
        stateManager.incrementIntakeQuestion();
        // Immediately advance to Question 2 (operational story)
        const msg = `Great! I've captured your project description: "${userPrompt}"\n\nNow, walk me through how you envision using this from start to finish. Paint the story of a typical operating session:\n- Where does it start?\n- What specific tasks or work will it perform?\n- What does the full use cycle look like?`;
        return {
          specialistId: 'conops',
          specialistName: 'CONOPS Intake',
          output: msg,
          autoRevisionsRun: 0,
          requiresReview: false,
          sessionMessages: [
            ...sessionMessages,
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: msg }
          ]
        };
      }

      // Question 2: Operational Story (recorded as question_1_answer)
      if (qIndex === 1 && !intake.answers.operationalStory) {
        stateManager.recordIntakeAnswer('operationalStory', userPrompt);
        stateManager.incrementIntakeQuestion();
        // Advance to dynamic questions via LLM
        const nextQ = await this.generateDynamicIntakeQuestion(client, model, userPrompt, 'operationalStory', 2);
        return nextQ;
      }

      // Dynamic Adaptive Questions 3, 4, 5 generated by LLM
      if (qIndex >= 2 && qIndex < 5) {
        const answerKey = `question_${qIndex}_answer`;
        stateManager.recordIntakeAnswer(answerKey, userPrompt);
        stateManager.incrementIntakeQuestion();

        if (qIndex >= 4) {
          // After question 4, record and synthesize
          stateManager.recordIntakeAnswer('finalIntakeNotes', userPrompt);
          stateManager.completeIntake();
        } else {
          const nextQ = await this.generateDynamicIntakeQuestion(client, model, userPrompt, answerKey, qIndex + 1);
          return nextQ;
        }
      } else {
        // At question 5+, record final answer and synthesize
        stateManager.recordIntakeAnswer('finalIntakeNotes', userPrompt);
        stateManager.completeIntake();
      }
    }

    // 5. Check if Target Artifact already exists to evolve
    let existingBaselineText = '';
    const targetDocPath = path.join(projectPath, 'docs', `${specialist.id.toUpperCase()}.md`);
    if (fs.existsSync(targetDocPath)) {
      try {
        const existingContent = fs.readFileSync(targetDocPath, 'utf-8');
        if (existingContent.trim()) {
          existingBaselineText = `\nEXISTING BASELINE DOCUMENT (TO EVOLVE / UPDATE):\nAn approved baseline for this deliverable already exists at docs/${specialist.id.toUpperCase()}.md:\n\`\`\`markdown\n${existingContent}\n\`\`\`\nINSTRUCTION: You must EVOLVE and UPDATE this existing baseline document to incorporate the user's requested additions or changes, rather than starting from scratch.\n\nSECTION 6 ANSWER HANDLING (if applicable):\nIf the existing document has a Section 6 (Open Questions) and the user is now answering those questions, EDIT the relevant sections IN PLACE to reflect the answer. Remove the answered question from Section 6. Do NOT regenerate or rewrite the entire document from scratch. Do NOT include your reasoning, thought process, or meta-commentary in the document output.\n`;
        }
      } catch (_e) {
        // ignore read error
      }
    }

    // 6. Specialist Execution Loop
    // Auto-compaction: if context exceeds threshold, summarize older messages first.
    const compactionResult = await maybeCompact({
      client: options.compactionClient ?? client,
      messages: sessionMessages,
      compactionModel: options.compactionModel || model,
      threshold: options.compressionThreshold ?? 100000,
      keepRecentTokens: options.keepRecentTokens ?? 20000,
      logger: options.logger
    });
    if (compactionResult.compacted) {
      sessionMessages = compactionResult.messages;
      onStatusUpdate?.(`Compacted session (${compactionResult.tokensBefore} → ${compactionResult.tokensAfter} tokens)`);
    }

    onStatusUpdate?.(`Executing specialist: ${specialist.name}...`);
    const enhancedSystemPrompt = `${specialist.systemPrompt}\n\n${discovery.discoveryText}${existingBaselineText}${SHARED_EDIT_INSTRUCTIONS}`;

    const context: ToolExecutionContext = { projectPath, stateManager, editLog: [] as EditEntry[] };
    // Snapshot the target doc's mtime before the agent loop runs, so we can detect
    // whether the model modified it this turn (via fs_edit or fs_write). Filesystem
    // mtime granularity can lag Date.now(), so we compare against this snapshot.
    let targetDocMtimeBefore = 0;
    let targetDocContentBefore = '';
    try {
      const filePath = path.join(projectPath, 'docs', `${specialist.id.toUpperCase()}.md`);
      if (fs.existsSync(filePath)) {
        targetDocMtimeBefore = fs.statSync(filePath).mtimeMs;
        targetDocContentBefore = fs.readFileSync(filePath, 'utf-8');
      }
    } catch (_e) { /* ignore */ }
    const targetDocExistedBeforeTurn = targetDocMtimeBefore > 0;
    const existingArtifact = state.artifacts.find(
      a => a.id.toUpperCase() === specialist.id.toUpperCase()
    );
    const priorArtifactScore = existingArtifact?.criticScore ?? 8.5;
    const agentResult = await runAgentToolLoop({
      client,
      model,
      systemPrompt: enhancedSystemPrompt,
      userMessage: userPrompt,
      toolRegistry,
      allowedTools: specialist.allowedTools,
      context,
      priorMessages: sessionMessages,
      onToolCall,
      signal
    });

    // User pressed ESC — abort the turn, discard partial work.
    if (agentResult.aborted) {
      return {
        specialistId: specialist.id,
        specialistName: specialist.name,
        output: '',
        autoRevisionsRun: 0,
        requiresReview: false,
        sessionMessages,
        aborted: true
      };
    }

    let finalOutput = agentResult.finalResponse;
    let criticResult: CriticResult | undefined;
    let autoRevisionsRun = 0;

    // If the LLM wrote the file to disk but responded with commentary, recover the document for the critic.
    // When fs_edit was used (editLog non-empty), the on-disk file is the source of truth —
    // always read it, even if the model's summary text contains a '# ' heading (the old
    // heuristic mistook a revision summary for the document).
    let artifactForCritic = finalOutput;
    let diskModified = false;
    if (specialist.requiresCritic) {
      const filePath = path.join(projectPath, 'docs', `${specialist.id.toUpperCase()}.md`);
      const editUsed = context.editLog && context.editLog.length > 0;
      // Read from disk if (a) fs_edit ran, (b) the file was touched this turn (fs_write),
      // or (c) the response lacks a markdown heading.
      try {
        if (fs.existsSync(filePath)) {
          const currentContent = fs.readFileSync(filePath, 'utf-8');
          diskModified = fs.statSync(filePath).mtimeMs > targetDocMtimeBefore || currentContent !== targetDocContentBefore;
        }
      } catch (_e) { /* ignore */ }
      if (editUsed || diskModified || !finalOutput.includes('# ')) {
        try {
          if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf-8').trim();
            if (fileContent && fileContent.startsWith('# ')) {
              artifactForCritic = fileContent;
            }
          }
        } catch (_e) {
          // ignore
        }
      }

      // Guard: the drafting model made no tool calls and neither wrote nor returned a document.
      // Common with local models that lack tool calling. Never send an empty
      // artifact to the critic; surface an actionable error instead.
      if (!editUsed && !diskModified && !finalOutput.includes('# ') && (agentResult.toolCallCount ?? 0) === 0) {
        const reply = finalOutput.trim();
        const output =
          `Drafting model "${model}" on "${options.draftingProviderName ?? 'OpenRouter'}" produced no document. ` +
          `It may not support tool calling. Reassign drafting in Settings or /models.` +
          (reply ? `\n\nModel reply:\n${reply}` : '');
        return {
          specialistId: specialist.id,
          specialistName: specialist.name,
          output,
          autoRevisionsRun: 0,
          requiresReview: false,
          error: true,
          sessionMessages: [
            ...sessionMessages,
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: reply || output }
          ]
        };
      }
    }

    // 7. Critic While-Loop with Program Baseline Verification
    if (specialist.requiresCritic) {
      onStatusUpdate?.('Running harsh critic evaluation with program alignment...');
      const critic = new CriticEvaluator(options.criticClient ?? client);
      let attempts = 0;
      const maxAttempts = 2;
      let passed = false;

      // Load all existing approved baseline documents for cross-document program alignment
      const programBaselineDocs: BaselineDocument[] = [];
      const docsDir = path.join(projectPath, 'docs');
      if (fs.existsSync(docsDir)) {
        const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
        for (const f of files) {
          const docId = f.replace(/\.md$/i, '').toUpperCase();
          if (docId !== specialist.id.toUpperCase()) {
            try {
              const content = fs.readFileSync(path.join(docsDir, f), 'utf-8');
              if (content.trim()) {
                programBaselineDocs.push({
                  id: docId,
                  path: `docs/${f}`,
                  content
                });
              }
            } catch (_e) {
              // ignore
            }
          }
        }
      }

      while (attempts <= maxAttempts && !passed) {
        // Load user custom examples if present
        const customExamples: string[] = [];
        const userExDir = path.join(projectPath, 'examples', specialist.id);
        if (fs.existsSync(userExDir)) {
          for (const f of fs.readdirSync(userExDir)) {
            if (f.endsWith('.md')) {
              customExamples.push(fs.readFileSync(path.join(userExDir, f), 'utf-8'));
            }
          }
        }

        const isDeltaReview = targetDocExistedBeforeTurn && (
          (context.editLog && context.editLog.length > 0) || diskModified
        );

        try {
          criticResult = await critic.evaluate({
            model: options.criticModel ?? model,
            artifactContent: artifactForCritic,
            rubric: specialist.criticRubric || '',
            secretSauceExamples: specialist.secretSauceExamples,
            userExamples: customExamples,
            programBaselineDocuments: programBaselineDocs,
            appliedEdits: context.editLog,
            signal,
            mode: isDeltaReview ? 'delta' : 'full',
            priorScore: isDeltaReview ? priorArtifactScore : undefined,
            userPrompt: isDeltaReview ? userPrompt : undefined
          });
        } catch (err: any) {
          // ESC during critic — abort the turn.
          if (err?.name === 'AbortError' || signal?.aborted) {
            return {
              specialistId: specialist.id,
              specialistName: specialist.name,
              output: '',
              autoRevisionsRun: autoRevisionsRun,
              requiresReview: false,
              sessionMessages,
              aborted: true
            };
          }
          throw err;
        }

        if (criticResult.passed) {
          passed = true;
          break;
        }

        if (attempts < maxAttempts) {
          attempts++;
          autoRevisionsRun++;
          onStatusUpdate?.(`Critic requested improvements (Score: ${criticResult.score}/10). Revising draft (Attempt ${attempts}/${maxAttempts})...`);

          const isDeltaReview = targetDocExistedBeforeTurn && (
            (context.editLog && context.editLog.length > 0) || diskModified
          );

          const revisionPrompt = isDeltaReview
            ? `The Critic evaluated your targeted edits to docs/${specialist.id.toUpperCase()}.md and found the following issues:\n` +
              `${(criticResult.weaknesses || []).map(w => `- ${w}`).join('\n')}\n\n` +
              `Actionable Guidance:\n${criticResult.actionableGuidance || 'Fix weaknesses'}\n\n` +
              `INSTRUCTION: Use the fs_edit tool to surgically resolve these specific issues in the document. Do NOT rewrite or regenerate the entire document.`
            : `The Critic evaluated your draft and found the following weaknesses:\n${(criticResult.weaknesses || []).map(w => `- ${w}`).join('\n')}\n\nActionable Guidance:\n${criticResult.actionableGuidance || 'Fix weaknesses'}\n\nPlease revise the deliverable to resolve all weaknesses while maintaining rigorous physical engineering standards and program alignment.`;

          // Reset the edit log so the critic sees only this revision's edits.
          context.editLog = [];
          const revisionResult = await runAgentToolLoop({
            client,
            model,
            systemPrompt: enhancedSystemPrompt,
            userMessage: revisionPrompt,
            toolRegistry,
            allowedTools: specialist.allowedTools,
            context,
            priorMessages: sessionMessages,
            onToolCall,
            signal
          });
          finalOutput = revisionResult.finalResponse;
          // ESC during revision — abort the whole turn.
          if (revisionResult.aborted) {
            return {
              specialistId: specialist.id,
              specialistName: specialist.name,
              output: '',
              autoRevisionsRun: autoRevisionsRun,
              requiresReview: false,
              sessionMessages,
              aborted: true
            };
          }
          // Re-check the disk file after revision. Prefer the on-disk file whenever
          // fs_edit was used this revision (editLog non-empty) — the model's summary
          // is not the document.
          const revisionEditUsed = context.editLog && context.editLog.length > 0;
          let revisionDiskModified = false;
          try {
            const filePath = path.join(projectPath, 'docs', `${specialist.id.toUpperCase()}.md`);
            if (fs.existsSync(filePath)) {
              revisionDiskModified = fs.statSync(filePath).mtimeMs > targetDocMtimeBefore;
            }
          } catch (_e) { /* ignore */ }
          diskModified = revisionDiskModified;
          if (revisionEditUsed || revisionDiskModified || !finalOutput.includes('# ')) {
            try {
              const filePath = path.join(projectPath, 'docs', `${specialist.id.toUpperCase()}.md`);
              if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf-8').trim();
                if (fileContent && fileContent.startsWith('# ')) {
                  artifactForCritic = fileContent;
                }
              }
            } catch (_e) {
              // ignore
            }
          } else {
            artifactForCritic = finalOutput;
          }
        } else {
          break;
        }
      }
    }

    const updatedSessionMessages: ChatMessage[] = [
      ...sessionMessages,
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: finalOutput }
    ];

    if (criticResult) {
      let criticNote = `[Critic Review for ${specialist.name}]: Score: ${criticResult.score.toFixed(1)}/10.`;
      if (criticResult.summary) {
        criticNote += `\nSummary: ${criticResult.summary}`;
      }
      if (criticResult.weaknesses && criticResult.weaknesses.length > 0) {
        criticNote += `\nWeaknesses:\n${criticResult.weaknesses.map(w => `- ${w}`).join('\n')}`;
      }
      if (criticResult.actionableGuidance) {
        criticNote += `\nActionable Guidance: ${criticResult.actionableGuidance}`;
      }
      updatedSessionMessages.push({
        role: 'user',
        content: criticNote
      });
    }

    // Track the last specialist that ran, so the next turn's classifier can
    // route short conversational replies back to it.
    CoreRunner.lastActiveSpecialistId = specialist.id;

    return {
      specialistId: specialist.id,
      specialistName: specialist.name,
      output: finalOutput,
      criticResult,
      autoRevisionsRun,
      requiresReview: specialist.requiresCritic,
      sessionMessages: updatedSessionMessages
    };
  }

  // Helper: Generate dynamic adaptive intake question via LLM
  private static async generateDynamicIntakeQuestion(
    client: ChatClient,
    model: string,
    userPrompt: string,
    answerKey: string,
    questionNumber: number
  ): Promise<TurnResult> {
    const intakePrompt = `You are the CONOPS Specialist conducting a story-based intake interview for a physical/hardware engineering project.
Review the user's project details gathered so far:
${JSON.stringify({ projectName: userPrompt, lastAnswerKey: answerKey, questionNumber }, null, 2)}

User's latest response: "${userPrompt}"

TASK:
Formulate the next single, highly relevant guided question tailored to this specific project.
Key topics to explore based on what is missing:
- Operating Location & Climate (indoor/outdoor, geographic climate extremes, terrain).
- Daily Operational Use Cases & Duty Cycle (routine tasks, required continuous runtime, duty cycle).
- Physical & Structural Boundaries (donor vehicle chassis, structure dimensions, mechanical interfaces).
- Charging, Storage & Critical Safety Protections.

Acknowledge their previous answer briefly and naturally, then ask the next question clearly.
The question should feel conversational and help the user paint a picture of how they will use this project.
Respond with ONLY the response text to the user.`;

    try {
      const intakeRes = await client.chatCompletion({
        model,
        messages: [{ role: 'user', content: intakePrompt }],
        temperature: 0.2
      });

      const nextQuestionText = intakeRes.content || `Thank you! Next question:\n\n${questionNumber}. Where will this project be operated (indoor/outdoor, climate conditions, terrain), and what are the primary use cases?`;

      return {
        specialistId: 'conops',
        specialistName: 'CONOPS Intake',
        output: nextQuestionText,
        autoRevisionsRun: 0,
        requiresReview: false,
        sessionMessages: []
      };
    } catch (_e) {
      return {
        specialistId: 'conops',
        specialistName: 'CONOPS Intake',
        output: `Thank you! Next guided question:\n\n${questionNumber}. Where will this project be operated (indoor/outdoor, climate conditions, terrain), and what are the primary use cases?`,
        autoRevisionsRun: 0,
        requiresReview: false,
        sessionMessages: []
      };
    }
  }
}
