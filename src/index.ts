#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig, ensureStarnDirs, saveUserConfig, ProviderConfig, Assignments, OPENROUTER_PROVIDER_ID } from './config.js';
import { allProviders, createRoleClients } from './models/role-clients.js';
import { formatAssignments, needsOpenRouterKey } from './cli/model-settings.js';
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
  formatCharterPlain,
  printSectionHeader
} from './cli/ui.js';import { confirm } from '@inquirer/prompts';
import {
  promptApiKey,
  promptSelectLiveModel,
  promptProjectSelection,
  promptUserQuery,
  promptModelForProvider,
  promptModelsMenu,
  promptSwitchProject
} from './cli/prompts.js';
import { runHumanCheckpoint, handleCriticFailure } from './cli/checkpoint.js';
import { runDocumentViewer, resolveDocTarget } from './cli/doc-viewer.js';
import { collectOpenQuestions, countOpenQuestions } from './cli/section6-resolver.js';
import { setClassifierLogger } from './core/classifier.js';
import { setCriticLogger } from './core/critic.js';
import { attachAbortListener } from './util/abort-input.js';
import { createVersionBackup } from './util/version-backup.js';
import { ORDERED_WORKFLOW_PHASES, resolveArtifactPaths } from './workspace/state.js';
import { Logger } from './util/logger.js';
import { ProjectContext } from './workspace/project-context.js';
import { ServerSessionManager } from './server/session.js';
import { startWebServer } from './server/server.js';
import {
  BriefingData,
  formatExecutiveBriefingPlain,
  formatExecutiveBriefingMarkdown
} from './core/briefing-formatter.js';
import { extractConopsCharter, extractConopsOverview, CharterSection } from './core/conops-overview.js';
import { parseBomDocument } from './server/parsers/bom-parser.js';
import {
  handleExampleCommand,
  handleReferenceCommand,
  handleLibraryCommand
} from './cli/library-commands.js';
import { formatPartsTable, parsePartsUpdateArgs, formatTradeStudySummary } from './cli/parts-commands.js';
import { updateBomItemInMarkdown } from './server/parsers/bom-updater.js';
import { parseTradeStudyDocument } from './server/parsers/trade-study-parser.js';

async function main() {
  const isWebMode = process.argv.includes('--web');
  console.log(formatBanner());

  const config = loadConfig();
  ensureStarnDirs(config.globalDir);

  // 1. Interactive API Key Onboarding (only when a role runs on OpenRouter)
  let apiKey = config.apiKey;
  if (!apiKey && needsOpenRouterKey(config.assignments)) {
    console.log(chalk.yellow('No OpenRouter API key found in environment or config.'));
    console.log(chalk.dim('Get an API key at https://openrouter.ai/keys\n'));
    apiKey = await promptApiKey();
    saveUserConfig({ apiKey }, config.globalDir);
    console.log(chalk.green(`✔ API Key saved to ${path.join(config.globalDir, 'config.json')}\n`));
  }

  const registryFile = path.join(config.globalDir, 'registry.json');
  const projectRegistry = new ProjectRegistry(registryFile);

  // 2. Fetch Live Models from OpenRouter (only with a key)
  let availableModels: Awaited<ReturnType<typeof fetchLiveOpenRouterModels>> = [];
  if (apiKey) {
    const modelSpinner = ora('Fetching available models from OpenRouter...').start();
    availableModels = await fetchLiveOpenRouterModels(apiKey);
    modelSpinner.succeed(`Loaded ${availableModels.length} models from OpenRouter.`);
  }

  // 3. Drafting model selection (OpenRouter drafting only; local roles are managed via /models)
  if (config.assignments.drafting.providerId === OPENROUTER_PROVIDER_ID) {
    const draftingModel = await promptSelectLiveModel(availableModels, config.assignments.drafting.model);
    config.assignments.drafting.model = draftingModel;
    config.defaultModel = draftingModel;
    projectRegistry.setDefaultModel(draftingModel);
    saveUserConfig({ defaultModel: draftingModel, assignments: config.assignments }, config.globalDir);
  }

  // 3b. Compaction model onboarding (if not yet configured, OpenRouter only)
  if (!config.compactionModel && config.assignments.compaction.providerId === OPENROUTER_PROVIDER_ID) {
    console.log(chalk.dim('\nSelect a model for session compaction (summarizes long conversations to free context).'))
    console.log(chalk.dim('Pick the same model, or a cheaper/faster one. Press Enter to accept the default.'))
    const compactionModel = await promptSelectLiveModel(availableModels, config.assignments.drafting.model);
    config.assignments.compaction = { providerId: OPENROUTER_PROVIDER_ID, model: compactionModel };
    config.compactionModel = compactionModel;
    saveUserConfig({ compactionModel, assignments: config.assignments }, config.globalDir);
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

  const projectContext = new ProjectContext(projectRegistry, currentProjectRecord);
  projectContext.onSwitch(() => {
    setClassifierLogger(projectContext.logger);
    setCriticLogger(projectContext.logger);
  });

  console.log(chalk.green(`\nWorking in Project: ${chalk.bold(projectContext.record.name)}`));
  console.log(chalk.dim(`Directory: ${projectContext.path}`));
  const startupConops = path.join(projectContext.path, 'docs', 'CONOPS.md');
  if (fs.existsSync(startupConops)) {
    try {
      const purpose = extractConopsOverview(fs.readFileSync(startupConops, 'utf-8'));
      if (purpose) {
        console.log(chalk.cyan(`Purpose: ${purpose.split('\n')[0]}`));
      }
    } catch {}
  }
  console.log(chalk.dim(formatAssignments(config.assignments, config.providers) + '\n'));

  // Per-project file logger (writes to <project>/.starn/logs/starn-<date>.log)
  setClassifierLogger(projectContext.logger);
  setCriticLogger(projectContext.logger);

  // Graceful SIGINT: state is already persisted per-turn; just acknowledge and exit
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n⚠ Interrupt received. Session state has been persisted to .starn/state.json. Goodbye.\n'));
    process.exit(0);
  });

  // Show Project Roadmap Banner
  console.log(formatWorkflowRoadmap(projectContext.stateManager.getState(), projectContext.path));

  // Voice transcription always uses OpenRouter.
  const voiceClient = new OpenRouterClient({
    apiKey,
    siteUrl: config.siteUrl,
    appName: config.appName,
    logger: projectContext.logger
  });
  const buildRoleClients = () =>
    createRoleClients({ apiKey, providers: config.providers, assignments: config.assignments, siteUrl: config.siteUrl, appName: config.appName, logger: projectContext.logger });
  let roleClients = buildRoleClients();

  /** Persists provider/assignment changes (from web Settings or /models) and keeps legacy mirrors in sync. */
  const persistModelSettings = (s: { providers: ProviderConfig[]; assignments: Assignments }) => {
    config.providers = s.providers;
    config.assignments = s.assignments;
    roleClients = buildRoleClients();
    config.defaultModel = s.assignments.drafting.model;
    config.compactionModel = s.assignments.compaction.model;
    saveUserConfig(
      { providers: s.providers, assignments: s.assignments, defaultModel: s.assignments.drafting.model, compactionModel: s.assignments.compaction.model },
      config.globalDir
    );
  };

  const toolRegistry = new ToolRegistry({ transcriptionEnabled: config.transcriptionEnabled });
  const specialistRegistry = new SpecialistRegistry();

  // --- Web mode: serve the HTTP adapter + React UI instead of the terminal loop ---
  if (isWebMode) {
    const portArgIdx = process.argv.indexOf('--port');
    const port = portArgIdx !== -1 ? Number(process.argv[portArgIdx + 1]) || 3000 : 3000;

    const session = new ServerSessionManager({
      projectPath: projectContext.path,
      stateManager: projectContext.stateManager,
      apiKey,
      providers: config.providers,
      assignments: config.assignments,
      siteUrl: config.siteUrl,
      appName: config.appName,
      toolRegistry,
      specialistRegistry,
      compressionThreshold: config.compressionThreshold,
      keepRecentTokens: config.keepRecentTokens,
      logger: projectContext.logger,
      transcriptionEnabled: config.transcriptionEnabled
    });

    const started = await startWebServer({
      projectPath: projectContext.path,
      stateManager: projectContext.stateManager,
      context: projectContext,
      session,
      port,
      onSettingsSaved: persistModelSettings
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
    printSectionHeader(`Active Session [Phase: ${projectContext.stateManager.getState().workflow?.activePhase?.toUpperCase() || 'CONOPS'}] ${formatContextGauge(sessionTokens, config.compressionThreshold, config.compactionModel)}`);
    const userPrompt = await promptUserQuery(voiceClient);

    let currentPrompt = userPrompt;

    // /compact-model: select the model used for session compaction (settings-only)
    if (currentPrompt.trim().toLowerCase() === '/compact-model') {
      const provider = allProviders(apiKey, config.providers).find(p => p.id === config.assignments.compaction.providerId)!;
      const compactionModel = await promptModelForProvider(provider, availableModels, config.assignments.compaction.model);
      if (compactionModel) {
        persistModelSettings({
          providers: config.providers,
          assignments: { ...config.assignments, compaction: { providerId: provider.id, model: compactionModel } }
        });
        console.log(chalk.green(`✔ Compaction model set to ${compactionModel} on ${provider.name}\n`));
      }
      continue;
    }

    // /models: manage providers and per-role model assignments
    if (currentPrompt.trim().toLowerCase() === '/models') {
      const updated = await promptModelsMenu(
        { apiKey, providers: config.providers, assignments: config.assignments, siteUrl: config.siteUrl, appName: config.appName },
        availableModels
      );
      if (updated) {
        persistModelSettings(updated);
        console.log(chalk.green('✔ Model settings saved.\n'));
      }
      continue;
    }


    // /web or /browser: Option A in-process handoff to browser web UI
    if (currentPrompt.trim().toLowerCase() === '/web' || currentPrompt.trim().toLowerCase() === '/browser') {
      const port = Number(process.env.STARN_PORT || 3000);
      const session = new ServerSessionManager({
        projectPath: projectContext.path,
        stateManager: projectContext.stateManager,
        apiKey,
        providers: config.providers,
        assignments: config.assignments,
        siteUrl: config.siteUrl,
        appName: config.appName,
        toolRegistry,
        specialistRegistry,
        compressionThreshold: config.compressionThreshold,
        keepRecentTokens: config.keepRecentTokens,
        logger: projectContext.logger
      });
      session.setSessionMessages(sessionMessages);

      const started = await startWebServer({
        projectPath: projectContext.path,
        stateManager: projectContext.stateManager,
        context: projectContext,
        session,
        port,
        onSettingsSaved: persistModelSettings
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
      const state = projectContext.stateManager.getState();
      const conopsPath = path.join(projectContext.path, 'docs', 'CONOPS.md');
      let conopsSummary: string | undefined;
      let charter: CharterSection[] | undefined;
      if (fs.existsSync(conopsPath)) {
        try {
          const raw = fs.readFileSync(conopsPath, 'utf-8');
          charter = extractConopsCharter(raw);
          conopsSummary = extractConopsOverview(raw) ?? undefined;
        } catch {}
      }

      const bomPath = path.join(projectContext.path, 'docs', 'BOM.md');
      let financials = { totalEstimated: 0, totalActual: 0, netVariance: 0 };
      if (fs.existsSync(bomPath)) {
        try {
          const bomContent = fs.readFileSync(bomPath, 'utf-8');
          const parsed = parseBomDocument(bomContent);
          financials = parsed.financials;
        } catch {}
      }

      const wiDir = path.join(projectContext.path, 'docs', 'work_instructions');
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
        const docPaths = resolveArtifactPaths(projectContext.path, def.artifactPath);
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
        projectName: projectContext.record.name,
        activePhase: state.workflow?.activePhase || 'conops',
        conopsSummary,
        charter,
        financials,
        phases,
        openIssues
      };

      const plainText = formatExecutiveBriefingPlain(briefingData);
      console.log('\n' + plainText + '\n');

      const mdText = formatExecutiveBriefingMarkdown(briefingData);
      const briefingFilePath = path.join(projectContext.path, 'docs', 'EXECUTIVE_BRIEFING.md');
      fs.writeFileSync(briefingFilePath, mdText, 'utf-8');
      console.log(chalk.green(`✔ Saved 2-page executive briefing to docs/EXECUTIVE_BRIEFING.md\n`));
      continue;
    }

    // /charter: display project overview and charter subsections
    if (currentPrompt.trim().toLowerCase() === '/charter') {
      const conopsPath = path.join(projectContext.path, 'docs', 'CONOPS.md');
      let charter: CharterSection[] = [];
      if (fs.existsSync(conopsPath)) {
        try {
          charter = extractConopsCharter(fs.readFileSync(conopsPath, 'utf-8'));
        } catch {}
      }
      console.log('\n' + formatCharterPlain(charter, projectContext.record.name) + '\n');
      continue;
    }

    const lowered = currentPrompt.trim().toLowerCase();

    // /project: switch to a different project or browse filesystem
    if (lowered === '/project') {
      const chosen = await promptSwitchProject(
        projectRegistry.listProjects(),
        projectContext.record.id
      );
      if (chosen) {
        if (chosen.projectId) {
          const p = projectRegistry.listProjects().find(rec => rec.id === chosen.projectId);
          if (p) projectContext.switchTo(p);
        } else if (chosen.path) {
          projectContext.switchToPath(chosen.path);
        }
        sessionMessages = [];
        console.log(chalk.green(`\n✔ Switched to project: ${chalk.bold(projectContext.record.name)}`));
        console.log(chalk.dim(`Directory: ${projectContext.path}\n`));
        console.log(formatWorkflowRoadmap(projectContext.stateManager.getState(), projectContext.path));
      }
      continue;
    }

    // /view: inspect any deliverable in read-only mode (no LLM, 0 tokens)
    if (lowered === '/view' || lowered.startsWith('/view ')) {
      const arg = currentPrompt.trim().slice('/view'.length).trim();
      await runDocumentViewer({
        projectPath: projectContext.path,
        stateManager: projectContext.stateManager,
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
      const approveRes = projectContext.stateManager.manualApproveArtifact(phase.id);
      if (!approveRes.success) {
        console.log(chalk.red(`\n✖ ${approveRes.error}\n`));
        continue;
      }
      const nextPhase = projectContext.stateManager.advanceToNextPhase();
      console.log(chalk.green(`\n✔ Manually approved deliverable: [${phase.name}]`));
      if (nextPhase) {
        console.log(chalk.cyan(`★ Workflow Advanced: Current active phase is now [${nextPhase.toUpperCase()}].`));
      }
      console.log(formatWorkflowRoadmap(projectContext.stateManager.getState(), projectContext.path));
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
      projectContext.stateManager.revertArtifactToDraft(phase.id);
      console.log(chalk.cyan(`\n↺ Reverted [${phase.name}] to draft. Downstream phases re-locked.`));
      console.log(chalk.dim("You'll get an impact report when you re-approve."));
      console.log(formatWorkflowRoadmap(projectContext.stateManager.getState(), projectContext.path));
      continue;
    }

    // /example: add a quality example for the active phase
    if (lowered === '/example' || lowered.startsWith('/example ')) {
      const arg = currentPrompt.trim().slice('/example'.length).trim();
      const activePhase = projectContext.stateManager.getState().workflow?.activePhase || 'conops';
      await handleExampleCommand(projectContext.path, activePhase, arg);
      continue;
    }

    // /reference: add a reference document to reference/
    if (lowered === '/reference' || lowered.startsWith('/reference ')) {
      const arg = currentPrompt.trim().slice('/reference'.length).trim();
      await handleReferenceCommand(projectContext.path, arg);
      continue;
    }

    // /library: list and manage reference documents and quality examples
    if (lowered === '/library') {
      await handleLibraryCommand(projectContext.path);
      continue;
    }

    // /parts: view or update procurement ledger
    if (lowered === '/parts' || lowered.startsWith('/parts update')) {
      const bomPath = path.join(projectContext.path, 'docs', 'BOM.md');
      if (!fs.existsSync(bomPath)) {
        console.log(chalk.yellow('\nNo BOM found in docs/BOM.md. Run the BOM specialist to generate the procurement ledger.\n'));
        continue;
      }

      if (lowered.startsWith('/parts update')) {
        const updateArgs = currentPrompt.trim().slice('/parts update'.length);
        const parsed = parsePartsUpdateArgs(updateArgs);
        if (!parsed.itemId) {
          console.log(chalk.yellow('\nUsage: /parts update <itemId> [status] [actualCost] [tracking]\nExample: /parts update SS01-01 Ordered 895.00 #ORD-9821\n'));
          continue;
        }

        try {
          const content = fs.readFileSync(bomPath, 'utf-8');
          const updated = updateBomItemInMarkdown(content, parsed.itemId, parsed);
          createVersionBackup(projectContext.path, bomPath);
          fs.writeFileSync(bomPath, updated, 'utf-8');
          console.log(chalk.green(`\n✓ Successfully updated BOM item ${parsed.itemId}.\n`));
          const bomData = parseBomDocument(updated);
          console.log(formatPartsTable(bomData));
        } catch (err: any) {
          console.log(chalk.red(`\nUpdate failed: ${err.message}\n`));
        }
        continue;
      }

      const content = fs.readFileSync(bomPath, 'utf-8');
      const bomData = parseBomDocument(content);
      console.log('\n' + formatPartsTable(bomData) + '\n');
      continue;
    }

    // /trade-study: view candidate trade studies
    if (lowered === '/trade-study') {
      const tradePath = path.join(projectContext.path, 'docs', 'TRADE_STUDY.md');
      if (!fs.existsSync(tradePath)) {
        console.log(chalk.yellow('\nNo candidate trade study found in docs/TRADE_STUDY.md. Run the BOM specialist to generate candidate evaluations.\n'));
        continue;
      }
      const content = fs.readFileSync(tradePath, 'utf-8');
      const studies = parseTradeStudyDocument(content);
      console.log('\n' + formatTradeStudySummary(studies) + '\n');
      continue;
    }

    // Pre-turn: if the active phase's document has open questions, collect answers NOW
    // and feed them to the specialist so the LLM integrates them into the document body.
    // This must happen before executeTurn — not after — so the LLM sees the answers.
    const isQuickCommand = ['/models', '/plan', '/roadmap', '/status', '/help', '/questions', '/charter', '/project', '/library', '/parts', '/trade-study', '/briefing', '/summary', '/report', '/web', '/browser'].includes(lowered)
      || lowered.startsWith('/parts')
      || lowered.startsWith('/goto')
      || lowered.startsWith('/view')
      || lowered.startsWith('/approve')
      || lowered.startsWith('/draft')
      || lowered.startsWith('/revert')
      || lowered.startsWith('/example')
      || lowered.startsWith('/reference')
      || lowered.startsWith('/voice');
    const activePhaseNow = projectContext.stateManager.getState().workflow?.activePhase || 'conops';
    const activePhaseDef = ORDERED_WORKFLOW_PHASES.find(p => p.id === activePhaseNow);

    if (activePhaseDef && !isQuickCommand) {
      const docPaths = resolveArtifactPaths(projectContext.path, activePhaseDef.artifactPath);
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
          projectPath: projectContext.path,
          stateManager: projectContext.stateManager,
          client: roleClients.drafting.client,
          model: roleClients.drafting.model,
          draftingProviderName: roleClients.drafting.providerName,
          criticClient: roleClients.critic.client,
          criticModel: roleClients.critic.model,
          classifierClient: roleClients.classifier.client,
          classifierModel: roleClients.classifier.model,
          compactionClient: roleClients.compaction.client,
          compactionModel: roleClients.compaction.model,
          transcriberClient: roleClients.transcriber.client,
          transcriberModel: roleClients.transcriber.model,
          transcriptionEnabled: config.transcriptionEnabled,
          toolRegistry,
          specialistRegistry,
          sessionMessages,
          compressionThreshold: config.compressionThreshold,
          keepRecentTokens: config.keepRecentTokens,
          logger: projectContext.logger,
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
            projectContext.stateManager.revertArtifactToDraft(artifactId);
            console.log(chalk.cyan(`\n↺ Reverted ${artifactId} to draft. Downstream phases re-locked.`));
            console.log(chalk.dim("You'll get an impact report when you re-approve."));
            console.log(formatWorkflowRoadmap(projectContext.stateManager.getState(), projectContext.path));
          }
          continue; // re-prompt
        }

        const crit = result.criticResult;

        // Problem 1: Display critic results compactly
        if (crit && crit.passed) {
          console.log(formatCompactCriticPass(crit));
        } else if (crit && !crit.passed && result.autoRevisionsRun >= 2) {
          // Auto-revisions exhausted — user must intervene
          const critAction = await handleCriticFailure(crit, result.specialistName, voiceClient);
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
            projectPath: projectContext.path,
            stateManager: projectContext.stateManager,
            client: roleClients.drafting.client,
            model: roleClients.drafting.model,
            voiceClient,
            toolRegistry
          });

          if (checkpoint.action === 'feedback' && checkpoint.feedback) {
            currentPrompt = checkpoint.feedback;
          } else if (checkpoint.action === 'accept') {
            // If approved deliverable, check if we can advance to next phase
            const nextPhase = projectContext.stateManager.advanceToNextPhase();
            if (nextPhase) {
              console.log(chalk.cyan(`\n★ Workflow Updated: Advanced to next phase [${nextPhase.toUpperCase()}].`));
              console.log(formatWorkflowRoadmap(projectContext.stateManager.getState(), projectContext.path));
            }
            turnActive = false;
          } else {
            turnActive = false;
          }
        } else {
          // Non-review output: print it and end the turn
          console.log(result.error ? chalk.yellow(`\n⚠ ${result.output}\n`) : `\n${result.output}\n`);
          turnActive = false;
        }
      } catch (err: any) {
        spinner.fail(`Execution failed: ${err.message || String(err)}`);
        detachAbort();
        projectContext.logger.error(`Turn error: ${err.message || String(err)}`);
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
