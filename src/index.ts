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
  printSectionHeader
} from './cli/ui.js';import { confirm } from '@inquirer/prompts';
import {
  promptApiKey,
  promptSelectLiveModel,
  promptProjectSelection,
  promptUserQuery
} from './cli/prompts.js';
import { runHumanCheckpoint, handleCriticFailure } from './cli/checkpoint.js';
import { collectOpenQuestions, countOpenQuestions } from './cli/section6-resolver.js';
import { ORDERED_WORKFLOW_PHASES, resolveArtifactPaths } from './workspace/state.js';
import { Logger } from './util/logger.js';
import { setClassifierLogger } from './core/classifier.js';
import { setCriticLogger } from './core/critic.js';

async function main() {
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
  console.log(formatWorkflowRoadmap(currentState));

  const client = new OpenRouterClient({
    apiKey,
    siteUrl: config.siteUrl,
    appName: config.appName,
    logger
  });

  const toolRegistry = new ToolRegistry();
  const specialistRegistry = new SpecialistRegistry();

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

    // Pre-turn: if the active phase's document has open questions, collect answers NOW
    // and feed them to the specialist so the LLM integrates them into the document body.
    // This must happen before executeTurn — not after — so the LLM sees the answers.
    const lowered = currentPrompt.trim().toLowerCase();
    const isQuickCommand = ['/plan', '/roadmap', '/status', '/help', '/questions'].includes(lowered)
      || lowered.startsWith('/goto')
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
          onStatusUpdate: status => {
            spinner.text = status;
          },
          onToolCall: (toolName, _args) => {
            spinner.text = `Executing tool: ${toolName}...`;
          }
        });

        spinner.stop();
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
          const critAction = await handleCriticFailure(crit, result.specialistName);
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
              console.log(formatWorkflowRoadmap(stateManager.getState()));
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
