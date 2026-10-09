#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig, ensureStarnDirs, saveUserConfig } from './config.js';
import { OpenRouterClient } from './openrouter/client.js';
import { fetchLiveOpenRouterModels } from './openrouter/models.js';
import { ProjectRegistry } from './workspace/registry.js';
import { ProjectStateManager } from './workspace/state.js';
import { ToolRegistry } from './tools/registry.js';
import { SpecialistRegistry } from './specialists/registry.js';
import { ChatMessage } from './openrouter/types.js';
import { CoreRunner } from './core/runner.js';
import { estimateTokens } from './core/compaction.js';
import {
  formatBanner,
  formatCompactCriticPass,
  formatContextGauge,
  formatWorkflowRoadmap,
  formatHelp,
  formatOpenQuestionsReport,
  printSectionHeader
} from './cli/ui.js';import { confirm } from '@inquirer/prompts';
import {
  promptApiKey,
  promptSelectLiveModel,
  promptProjectSelection,
  promptUserQuery
} from './cli/prompts.js';
import { runHumanCheckpoint, handleCriticFailure } from './cli/checkpoint.js';
import { runDocumentViewer, resolveDocTarget } from './cli/doc-viewer.js';
import { collectOpenQuestions, countOpenQuestions } from './cli/section6-resolver.js';
import { setClassifierLogger } from './core/classifier.js';
import { setCriticLogger } from './core/critic.js';
import { attachAbortListener } from './util/abort-input.js';
import { ORDERED_WORKFLOW_PHASES, resolveArtifactPaths } from './workspace/state.js';
import { Logger } from './util/logger.js';
import { ServerSessionManager } from './server/session.js';
import { startWebServer } from './server/server.js';
import {
  BriefingData,
  formatExecutiveBriefingPlain,
  formatExecutiveBriefingMarkdown
} from './core/briefing-formatter.js';
import { extractConopsOverview } from './core/conops-overview.js';
import { parseBomDocument } from './server/parsers/bom-parser.js';

async function main() {
  const isWebMode = process.argv.includes('--web');
  console.log(formatBanner());

  const config = loadConfig();
  ensureStarnDirs(config.globalDir);

  // 1. Interactive API Key Onboarding if missing
  let apiKey = config.apiKey;
  if (!apiKey) {
    console.log(chalk.yellow('No OpenRouter API key found in environment or config.'));
    console.log(chalk.dim('Get an API key at https://openrouter.ai/keys\n'));
    apiKey = await promptApiKey();
    saveUserConfig({ apiKey }, config.globalDir);
    console.log(chalk.green(`✔ API Key saved to ${path.join(config.globalDir, 'config.json')}\n`));
  }

  const registryFile = path.join(config.globalDir, 'registry.json');
  const projectRegistry = new ProjectRegistry(registryFile);

  // 2. Fetch Live Models from OpenRouter
  const modelSpinner = ora('Fetching available models from OpenRouter...').start();
  const availableModels = await fetchLiveOpenRouterModels(apiKey);
  modelSpinner.succeed(`Loaded ${availableModels.length} models from OpenRouter.`);

  // 3. Model Selection
  const selectedModel = await promptSelectLiveModel(availableModels, config.defaultModel);
  projectRegistry.setDefaultModel(selectedModel);
  saveUserConfig({ defaultModel: selectedModel }, config.globalDir);

  // 3b. Compaction model onboarding (if not yet configured)
  if (!config.compactionModel) {
    console.log(chalk.dim('\nSelect a model for session compaction (summarizes long conversations to free context).'))
    console.log(chalk.dim('Pick the same model, or a cheaper/faster one. Press Enter to accept the default.'))
    const compactionModel = await promptSelectLiveModel(availableModels, selectedModel);
    saveUserConfig({ compactionModel }, config.globalDir);
    config.compactionModel = compactionModel;
    console.log(chalk.green(`✔ Compaction model set to ${compactionModel}\n`));
  }

  // 4. Project Selection / Creation
  const existingProjects = projectRegistry.listProjects();
  const activeProject = projectRegistry.getActiveProject();
  const projectSelection = await promptProjectSelection(
    existingProjects,
    activeProject ? activeProject.id : null
  );

  let currentProjectRecord = activeProject;
  if (projectSelection.action === 'create' && projectSelection.name && projectSelection.path) {
    currentProjectRecord = projectRegistry.registerProject(
      projectSelection.name,
      projectSelection.path
    );
  } else if (projectSelection.projectId) {
    projectRegistry.setActiveProject(projectSelection.projectId);
    currentProjectRecord = projectRegistry.getActiveProject();
  }

  if (!currentProjectRecord) {
    console.error(chalk.red('Error: No active project selected.'));
    process.exit(1);
  }

  console.log(chalk.green(`\nWorking in Project: ${chalk.bold(currentProjectRecord.name)}`));
  console.log(chalk.dim(`Directory: ${currentProjectRecord.path}`));
  console.log(chalk.dim(`Active Model: ${selectedModel}\n`));

  const stateManager = new ProjectStateManager(currentProjectRecord.path);
  const currentState = stateManager.getOrCreateState(currentProjectRecord.id, currentProjectRecord.name);

  // Per-project file logger (writes to <project>/.starn/logs/starn-<date>.log)
  const logger = new Logger(path.join(currentProjectRecord.path, '.starn'));
  setClassifierLogger(logger);
  setCriticLogger(logger);

  // Graceful SIGINT: state is already persisted per-turn; just acknowledge and exit
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n⚠ Interrupt received. Session state has been persisted to .starn/state.json. Goodbye.\n'));
    process.exit(0);
  });

  // Show Project Roadmap Banner
  console.log(formatWorkflowRoadmap(currentState, currentProjectRecord.path));

  const client = new OpenRouterClient({
    apiKey,
    siteUrl: config.siteUrl,
    appName: config.appName,
    logger
  });

  const toolRegistry = new ToolRegistry();
  const specialistRegistry = new SpecialistRegistry();

  // --- Web mode: serve the HTTP adapter + React UI instead of the terminal loop ---
  if (isWebMode) {
    const portArgIdx = process.argv.indexOf('--port');
    const port = portArgIdx !== -1 ? Number(process.argv[portArgIdx + 1]) || 3000 : 3000;

    const session = new ServerSessionManager({
      projectPath: currentProjectRecord.path,
      stateManager,
      client,
      model: selectedModel,
      toolRegistry,
      specialistRegistry,
      compactionModel: config.compactionModel || selectedModel,
      compressionThreshold: config.compressionThreshold,
      keepRecentTokens: config.keepRecentTokens,
      logger
    });

    const started = await startWebServer({
      projectPath: currentProjectRecord.path,
      stateManager,
      session,
      port,
      onSettingsSaved: s => {
        if (s.agentModel) saveUserConfig({ defaultModel: s.agentModel }, config.globalDir);
        if (s.compactionModel) saveUserConfig({ compactionModel: s.compactionModel }, config.globalDir);
      }
    });

    console.log(chalk.green('\n★ STARN web UI is running:'));
    for (const url of started.urls) {
      console.log(chalk.cyan(`   ${url}`));
    }
    console.log(chalk.dim('\nAgent turns, checkpoints, BOM, shop floor, and settings are served over HTTP.'));
    console.log(chalk.dim('Press Ctrl+C to stop. State persists to .starn/state.json.\n'));
    return; // HTTP server keeps the event loop alive
  }

  let sessionMessages: ChatMessage[] = [];

  while (true) {
    const sessionTokens = estimateTokens(sessionMessages);
    printSectionHeader(`Active Session [Phase: ${stateManager.getState().workflow?.activePhase?.toUpperCase() || 'CONOPS'}] ${formatContextGauge(sessionTokens, config.compressionThreshold, config.compactionModel)}`);
    const userPrompt = await promptUserQuery(client);

    let currentPrompt = userPrompt;

    // /compact-model: select the model used for session compaction (settings-only)
    if (currentPrompt.trim().toLowerCase() === '/compact-model') {
      const compactionModel = await promptSelectLiveModel(availableModels, config.compactionModel || selectedModel);
      saveUserConfig({ compactionModel }, config.globalDir);
      config.compactionModel = compactionModel;
      console.log(chalk.green(`✔ Compaction model set to ${compactionModel}\n`));
      continue;
    }


    // /web or /browser: Option A in-process handoff to browser web UI
    if (currentPrompt.trim().toLowerCase() === '/web' || currentPrompt.trim().toLowerCase() === '/browser') {
      const port = Number(process.env.STARN_PORT || 3000);
      const session = new ServerSessionManager({
        projectPath: currentProjectRecord.path,
        stateManager,
        client,
        model: selectedModel,
        toolRegistry,
        specialistRegistry,
        compactionModel: config.compactionModel,
        compressionThreshold: config.compressionThreshold,
        keepRecentTokens: config.keepRecentTokens,
        logger
      });
      session.setSessionMessages(sessionMessages);

      const started = await startWebServer({
        projectPath: currentProjectRecord.path,
        stateManager,
        session,
        port,
        onSettingsSaved: s => {
          if (s.agentModel) saveUserConfig({ defaultModel: s.agentModel }, config.globalDir);
          if (s.compactionModel) saveUserConfig({ compactionModel: s.compactionModel }, config.globalDir);
        }
      });

      console.log(chalk.green('\n★ STARN web UI is running and session handed off:'));
      for (const url of started.urls) {
        console.log(chalk.cyan(`   ${url}`));
      }
      console.log(chalk.dim('\nCLI is now in web monitor mode. Browser has been opened.'));
      console.log(chalk.dim('Press Ctrl+C to stop. State persists to .starn/state.json.\n'));
      return; // Keep event loop running with HTTP server
    }

    // /briefing: 2-page executive briefing summary
    if (currentPrompt.trim().toLowerCase() === '/briefing' || currentPrompt.trim().toLowerCase() === '/summary' || currentPrompt.trim().toLowerCase() === '/report') {
      const state = stateManager.getState();
      const conopsPath = path.join(currentProjectRecord.path, 'docs', 'CONOPS.md');
      let conopsSummary: string | undefined;
      if (fs.existsSync(conopsPath)) {
        try {
          conopsSummary = extractConopsOverview(fs.readFileSync(conopsPath, 'utf-8')) ?? undefined;
        } catch {}
      }

      const bomPath = path.join(currentProjectRecord.path, 'docs', 'BOM.md');
      let financials = { totalEstimated: 0, totalActual: 0, netVariance: 0 };
      if (fs.existsSync(bomPath)) {
        try {
          const bomContent = fs.readFileSync(bomPath, 'utf-8');
          const parsed = parseBomDocument(bomContent);
          financials = parsed.financials;
        } catch {}
      }

      const wiDir = path.join(currentProjectRecord.path, 'docs', 'work_instructions');
      const openIssues: Array<{ title: string; type: string }> = [];
      if (fs.existsSync(wiDir)) {
        for (const file of fs.readdirSync(wiDir).filter(f => f.endsWith('.md'))) {
          const content = fs.readFileSync(path.join(wiDir, file), 'utf-8');
          if (content.includes('OPEN_NON_CONFORMANCE')) {
            openIssues.push({
              title: `Work Instruction ${file} flagged with Open Non-Conformance`,
              type: 'non_conformance'
            });
          }
        }
      }
      for (const def of ORDERED_WORKFLOW_PHASES) {
        const docPaths = resolveArtifactPaths(currentProjectRecord.path, def.artifactPath);
        for (const p of docPaths) {
          const qCount = countOpenQuestions(p);
          if (qCount > 0) {
            openIssues.push({
              title: `${path.basename(p)} has ${qCount} open question(s)`,
              type: 'open_question'
            });
          }
        }
      }

      const phases = ORDERED_WORKFLOW_PHASES.map(p => {
        const ph = state.workflow?.phases?.[p.id];
        const artifact = state.artifacts.find(a => a.id === p.id.toUpperCase());
        return {
          id: p.id,
          name: p.name,
          status: ph?.status ? ph.status.toUpperCase() : 'LOCKED',
          criticScore: artifact?.criticScore
        };
      });

      const briefingData: BriefingData = {
        projectName: currentProjectRecord.name,
        activePhase: state.workflow?.activePhase || 'conops',
        conopsSummary,
        financials,
        phases,
        openIssues
      };

      const plainText = formatExecutiveBriefingPlain(briefingData);
      console.log('\n' + plainText + '\n');

      const mdText = formatExecutiveBriefingMarkdown(briefingData);
      const briefingFilePath = path.join(currentProjectRecord.path, 'docs', 'EXECUTIVE_BRIEFING.md');
      fs.writeFileSync(briefingFilePath, mdText, 'utf-8');
      console.log(chalk.green(`✔ Saved 2-page executive briefing to docs/EXECUTIVE_BRIEFING.md\n`));
      continue;
    }

    const lowered = currentPrompt.trim().toLowerCase();

    // /view: inspect any deliverable in read-only mode (no LLM, 0 tokens)
    if (lowered === '/view' || lowered.startsWith('/view ')) {
      const arg = currentPrompt.trim().slice('/view'.length).trim();
      await runDocumentViewer({
        projectPath: currentProjectRecord.path,
        stateManager,
        targetArg: arg || undefined
      });
      continue;
    }

    // /approve: manually mark a deliverable as approved on disk and unlock next phase
    if (lowered === '/approve' || lowered.startsWith('/approve ')) {
      const arg = currentPrompt.trim().slice('/approve'.length).trim();
      const phase = resolveDocTarget(arg);
      if (!phase) {
        console.log(chalk.yellow(`\n⚠ Please specify which document to approve (e.g. /approve conops, /approve 1).\n`));
        continue;
      }
      const approveRes = stateManager.manualApproveArtifact(phase.id);
      if (!approveRes.success) {
        console.log(chalk.red(`\n✖ ${approveRes.error}\n`));
        continue;
      }
      const nextPhase = stateManager.advanceToNextPhase();
      console.log(chalk.green(`\n✔ Manually approved deliverable: [${phase.name}]`));
      if (nextPhase) {
        console.log(chalk.cyan(`★ Workflow Advanced: Current active phase is now [${nextPhase.toUpperCase()}].`));
      }
      console.log(formatWorkflowRoadmap(stateManager.getState(), currentProjectRecord.path));
      continue;
    }

    // /draft or /revert: manually revert an approved deliverable to draft
    if (lowered === '/draft' || lowered.startsWith('/draft ') || lowered === '/revert' || lowered.startsWith('/revert ')) {
      const prefix = lowered.startsWith('/revert') ? '/revert' : '/draft';
      const arg = currentPrompt.trim().slice(prefix.length).trim();
      const phase = resolveDocTarget(arg);
      if (!phase) {
        console.log(chalk.yellow(`\n⚠ Please specify which document to revert to draft (e.g. /draft conops, /draft 1).\n`));
        continue;
      }
      stateManager.revertArtifactToDraft(phase.id);
      console.log(chalk.cyan(`\n↺ Reverted [${phase.name}] to draft. Downstream phases re-locked.`));
      console.log(chalk.dim("You'll get an impact report when you re-approve."));
      console.log(formatWorkflowRoadmap(stateManager.getState(), currentProjectRecord.path));
      continue;
    }

    // Pre-turn: if the active phase's document has open questions, collect answers NOW
    // and feed them to the specialist so the LLM integrates them into the document body.
    // This must happen before executeTurn — not after — so the LLM sees the answers.
    const isQuickCommand = ['/plan', '/roadmap', '/status', '/help', '/questions', '/briefing', '/summary', '/report', '/web', '/browser'].includes(lowered)
      || lowered.startsWith('/goto')
      || lowered.startsWith('/view')
      || lowered.startsWith('/approve')
      || lowered.startsWith('/draft')
      || lowered.startsWith('/revert')
      || lowered.startsWith('/voice');
    const activePhaseNow = stateManager.getState().workflow?.activePhase || 'conops';
    const activePhaseDef = ORDERED_WORKFLOW_PHASES.find(p => p.id === activePhaseNow);

    if (activePhaseDef && !isQuickCommand) {
      const docPaths = resolveArtifactPaths(currentProjectRecord.path, activePhaseDef.artifactPath);
      const docWithQuestions = docPaths.find(docPath => countOpenQuestions(docPath) > 0);
      if (docWithQuestions) {
        const collected = await collectOpenQuestions({
          docPath: docWithQuestions,
          docName: path.basename(docWithQuestions)
        });
        if (collected.answers.length > 0) {
          const answerBlock = collected.answers
            .map((qa, i) => `Q${i + 1}: ${qa.question.slice(0, 150).replace(/\n/g, ' ')}\nAnswer: ${qa.answer}`)
            .join('\n\n');
          currentPrompt += `\n\nUSER ANSWERS TO OPEN QUESTIONS (incorporate per your instructions):\n${answerBlock}`;
        }
      }
    }

    let turnActive = true;

    while (turnActive) {
      const spinner = ora('Initializing turn...').start();

      // ESC-to-abort: attach a keypress listener for the duration of the turn.
      // The controller's signal is threaded into the OpenRouter fetch so ESC
      // cancels the in-flight call and returns to the prompt.
      const abortController = new AbortController();
      const detachAbort = attachAbortListener(abortController);
      spinner.text = spinner.text + '  (press ESC to stop)';

      try {
        const result = await CoreRunner.executeTurn({
          userPrompt: currentPrompt,
          projectPath: currentProjectRecord.path,
          stateManager,
          client,
          model: selectedModel,
          toolRegistry,
          specialistRegistry,
          sessionMessages,
          compactionModel: config.compactionModel || selectedModel,
          compressionThreshold: config.compressionThreshold,
          keepRecentTokens: config.keepRecentTokens,
          logger,
          signal: abortController.signal,
          formatters: { formatWorkflowRoadmap, formatHelp, formatOpenQuestionsReport },
          onStatusUpdate: status => {
            spinner.text = `${status}  (press ESC to stop)`;
          },
          onToolCall: (toolName, _args) => {
            spinner.text = `Executing tool: ${toolName}...  (press ESC to stop)`;
          }
        });

        spinner.stop();
        detachAbort();

        // ESC pressed during the turn — discard the partial turn and re-prompt.
        if (result.aborted) {
          console.log(chalk.yellow('\n⚠ Turn cancelled. (State is untouched — you can re-ask.)\n'));
          turnActive = false;
          continue;
        }

        sessionMessages = result.sessionMessages;

        // Handle /goto reopen signal: target phase's artifact is approved —
        // prompt the user to revert it to draft (with downstream re-locking).
        if (result.output.startsWith('__REOPEN_PROMPT__:')) {
          const [, artifactId, downstreamList] = result.output.split(':');
          const confirmed = await confirm({
            message: `${artifactId} is currently approved. Switching to it will revert it to draft so you can revise. Downstream phases that will re-lock: ${downstreamList}. Continue?`,
            default: false
          });
          if (confirmed) {
            stateManager.revertArtifactToDraft(artifactId);
            console.log(chalk.cyan(`\n↺ Reverted ${artifactId} to draft. Downstream phases re-locked.`));
            console.log(chalk.dim("You'll get an impact report when you re-approve."));
            console.log(formatWorkflowRoadmap(stateManager.getState(), currentProjectRecord.path));
          }
          continue; // re-prompt
        }

        const crit = result.criticResult;

        // Problem 1: Display critic results compactly
        if (crit && crit.passed) {
          console.log(formatCompactCriticPass(crit));
        } else if (crit && !crit.passed && result.autoRevisionsRun >= 2) {
          // Auto-revisions exhausted — user must intervene
          const critAction = await handleCriticFailure(crit, result.specialistName, client);
          if (critAction.action === 'feedback' && critAction.feedback) {
            currentPrompt = critAction.feedback;
            continue; // restart turn loop with targeted feedback
          } else if (critAction.action === 'override') {
            crit.passed = true; // flag as overridden for checkpoint
          } else {
            // discard
            turnActive = false;
            continue;
          }
        }

        // Checkpoint only when a specialist completed a critic-gated draft.
        // Quick commands, intake questions, and conversational replies just print and continue.
        if (result.requiresReview) {
          const checkpoint = await runHumanCheckpoint({
            specialistId: result.specialistId,
            specialistName: result.specialistName,
            output: result.output,
            criticResult: result.criticResult,
            projectPath: currentProjectRecord.path,
            stateManager,
            client,
            model: selectedModel,
            toolRegistry
          });

          if (checkpoint.action === 'feedback' && checkpoint.feedback) {
            currentPrompt = checkpoint.feedback;
          } else if (checkpoint.action === 'accept') {
            // If approved deliverable, check if we can advance to next phase
            const nextPhase = stateManager.advanceToNextPhase();
            if (nextPhase) {
              console.log(chalk.cyan(`\n★ Workflow Updated: Advanced to next phase [${nextPhase.toUpperCase()}].`));
              console.log(formatWorkflowRoadmap(stateManager.getState(), currentProjectRecord.path));
            }
            turnActive = false;
          } else {
            turnActive = false;
          }
        } else {
          // Non-review output: print it and end the turn
          console.log(`\n${result.output}\n`);
          turnActive = false;
        }
      } catch (err: any) {
        spinner.fail(`Execution failed: ${err.message || String(err)}`);
        detachAbort();
        logger?.error(`Turn error: ${err.message || String(err)}`);
        turnActive = false;
      }
    }

    // Session loops continuously until the user exits with Ctrl+C
    // (handled by the SIGINT handler, which persists state and exits cleanly).
  }

  console.log(chalk.cyan('\n★ STARN session ended. Progress persisted to .starn/state.json. Happy building!\n'));
}

main().catch(err => {
  console.error(chalk.red('Fatal Error:'), err);
  process.exit(1);
});
