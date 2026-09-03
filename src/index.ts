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
import {
  formatBanner,
  formatCompactCriticPass,
  formatWorkflowRoadmap,
  printSectionHeader
} from './cli/ui.js';
import {
  promptApiKey,
  promptSelectLiveModel,
  promptProjectSelection,
  promptUserQuery,
  promptContinueSession
} from './cli/prompts.js';
import { runHumanCheckpoint, handleCriticFailure } from './cli/checkpoint.js';
import { resolveSection6, hasUnresolvedQuestions } from './cli/section6-resolver.js';

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

  // Show Project Roadmap Banner
  console.log(formatWorkflowRoadmap(currentState));

  const client = new OpenRouterClient({
    apiKey,
    siteUrl: config.siteUrl,
    appName: config.appName
  });

  const toolRegistry = new ToolRegistry();
  const specialistRegistry = new SpecialistRegistry();

  let sessionActive = true;
  let sessionMessages: ChatMessage[] = [];

  while (sessionActive) {
    printSectionHeader(`Active Session [Phase: ${stateManager.getState().workflow?.activePhase?.toUpperCase() || 'CONOPS'}]`);
    const userPrompt = await promptUserQuery(client);

    let currentPrompt = userPrompt;
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
          onStatusUpdate: status => {
            spinner.text = status;
          },
          onToolCall: (toolName, _args) => {
            spinner.text = `Executing tool: ${toolName}...`;
          }
        });

        spinner.stop();
        sessionMessages = result.sessionMessages;

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

        // Problem 2: Section 6 resolution interview (CONOPS only, after passing)
        if (result.specialistId === 'conops' && crit?.passed) {
          const conopsPath = path.join(currentProjectRecord.path, 'docs', 'CONOPS.md');
          if (fs.existsSync(conopsPath) && hasUnresolvedQuestions(conopsPath)) {
            console.log();
            await resolveSection6({
              projectPath: currentProjectRecord.path,
              stateManager
            });
          }
        }

        const checkpoint = await runHumanCheckpoint({
          specialistId: result.specialistId,
          specialistName: result.specialistName,
          output: result.output,
          criticResult: result.criticResult,
          projectPath: currentProjectRecord.path,
          stateManager
        });

        if (checkpoint.action === 'feedback' && checkpoint.feedback) {
          currentPrompt = checkpoint.feedback;
        } else if (checkpoint.action === 'accept' && result.requiresReview) {
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
      } catch (err: any) {
        spinner.fail(`Execution failed: ${err.message || String(err)}`);
        turnActive = false;
      }
    }

    sessionActive = await promptContinueSession();
  }

  console.log(chalk.cyan('\n★ STARN session ended. Progress persisted to .starn/state.json. Happy building!\n'));
}

main().catch(err => {
  console.error(chalk.red('Fatal Error:'), err);
  process.exit(1);
});
