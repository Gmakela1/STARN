import { select, input, confirm, password, search, Separator } from '@inquirer/prompts';
import chalk from 'chalk';
import { ModelOption } from '../openrouter/models.js';
import { ProjectRecord } from '../workspace/types.js';
import { formatModelChoice } from './ui.js';
import { isVoiceCommand, captureVoicePrompt } from './voice.js';
import { OpenRouterClient } from '../openrouter/client.js';
import { Assignments, MODEL_ROLES, ModelRole, OPENROUTER_PROVIDER_ID, ProviderConfig } from '../config.js';
import { allProviders, createProviderClient } from '../models/role-clients.js';
import { listProviderModels, probeToolCalling } from '../models/provider-models.js';
import { assignedRolesFor, formatAssignments } from './model-settings.js';

export async function promptApiKey(): Promise<string> {
  const key = await password({
    message: 'Enter your OpenRouter API Key (input masked):',
    mask: '*',
    validate: val => {
      const trimmed = val.trim();
      if (!trimmed) return 'API key cannot be empty.';
      if (!trimmed.startsWith('sk-or-') && trimmed.length < 20) {
        return 'Warning: OpenRouter keys typically start with "sk-or-v1-...". Please enter a valid key.';
      }
      return true;
    }
  });
  return key.trim();
}

export async function promptSelectLiveModel(
  models: ModelOption[],
  currentDefault: string
): Promise<string> {
  const lastUsedModel = models.find(m => m.id === currentDefault);

  // Build a display choice for a model — annotate the last-used one
  const makeChoice = (m: ModelOption) => ({
    name: m.id === currentDefault && lastUsedModel
      ? formatModelChoice(m) + chalk.bold.green('  ← last used')
      : formatModelChoice(m),
    value: m.id
  });

  // Full list with last-used model pinned to position 0 (only appears once)
  const choices = models.map(makeChoice);
  if (lastUsedModel) {
    const idx = choices.findIndex(c => c.value === currentDefault);
    if (idx > 0) {
      const [item] = choices.splice(idx, 1);
      choices.unshift(item);
    }
  }

  try {
    return await search({
      message: 'Select OpenRouter Model (type to filter):',
      source: async (term?: string) => {
        if (!term) {
          // Unfiltered: last-used model at top with a separator before the full list
          if (lastUsedModel && choices.length > 1) {
            return [
              choices[0],
              new Separator('─── All Models ──────────────────────────────────────────────────────'),
              ...choices.slice(1)
            ];
          }
          return choices;
        }
        const lower = term.toLowerCase();
        return choices.filter(c => {
          const rawModel = models.find(m => m.id === c.value);
          if (!rawModel) return c.value.toLowerCase().includes(lower);
          return (
            rawModel.id.toLowerCase().includes(lower) ||
            rawModel.name.toLowerCase().includes(lower) ||
            rawModel.description.toLowerCase().includes(lower)
          );
        });
      }
    });
  } catch (_e) {
    // Fallback to standard select if search prompt is interrupted or unsupported
    return await select({
      message: 'Select OpenRouter Model to use:',
      choices: choices.slice(0, 30),
      default: currentDefault
    });
  }
}

export async function promptProjectSelection(
  existingProjects: ProjectRecord[],
  activeId: string | null
): Promise<{ action: 'select' | 'create'; projectId?: string; name?: string; path?: string }> {
  const choices = [
    ...existingProjects.map(p => ({
      name: `${p.name} (${p.path}) ${p.id === activeId ? '[Active]' : ''}`,
      value: p.id
    })),
    { name: '+ Link a New Project Folder...', value: 'NEW' }
  ];

  const selected = await select({
    message: 'Select an active project:',
    choices,
    default: activeId || undefined
  });

  if (selected === 'NEW') {
    const name = await input({
      message: 'Enter Project Name (e.g. Solar Shed 2026):',
      validate: val => (val.trim() ? true : 'Project name cannot be empty.')
    });
    const targetPath = await input({
      message: 'Enter Project Directory Path:',
      default: '.',
      validate: val => (val.trim() ? true : 'Path cannot be empty.')
    });
    return { action: 'create', name: name.trim(), path: targetPath.trim() };
  }

  return { action: 'select', projectId: selected };
}

export async function promptInputWithVoice(message: string, client?: OpenRouterClient): Promise<string> {
  const raw = await input({
    message,
    validate: val => (val.trim() ? true : 'Please enter a prompt.')
  });

  if (isVoiceCommand(raw) && client) {
    console.log(chalk.cyan('🎤 Recording... (press Enter to stop and transcribe)'));
    try {
      const transcribed = await captureVoicePrompt(client);
      if (!transcribed) {
        console.log(chalk.yellow('No speech captured. Please try again.'));
        return promptInputWithVoice(message, client);
      }
      return await input({
        message: 'Edit your prompt (or press Enter to submit):',
        default: transcribed
      });
    } catch (err: any) {
      console.log(chalk.yellow(`Voice capture failed: ${err.message}`));
      return promptInputWithVoice(message, client);
    }
  }

  return raw;
}

export async function promptUserQuery(client?: OpenRouterClient): Promise<string> {
  return promptInputWithVoice('What would you like to build or inspect? (type /voice to speak)', client);
}

export async function promptContinueSession(): Promise<boolean> {
  return await confirm({
    message: 'Would you like to perform another task in this project?',
    default: true
  });
}

/**
 * Picks a model id for a provider. OpenRouter uses the live searchable list;
 * other providers use GET <baseUrl>/models, falling back to manual entry when
 * the list cannot be fetched or is empty.
 */
export async function promptModelForProvider(
  provider: ProviderConfig,
  openRouterModels: ModelOption[],
  current: string
): Promise<string> {
  if (provider.id === OPENROUTER_PROVIDER_ID) {
    return promptSelectLiveModel(openRouterModels, current);
  }
  let models: string[] = [];
  try {
    models = await listProviderModels(provider);
  } catch (err: any) {
    console.log(chalk.yellow(`⚠ ${err?.message ?? err}`));
  }
  if (models.length === 0) {
    const typed = await input({ message: `Model id on ${provider.name}:`, default: current || undefined });
    return typed.trim();
  }
  return select({
    message: `Select model on ${provider.name}:`,
    choices: models.map(m => ({ name: m, value: m })),
    default: models.includes(current) ? current : undefined
  });
}

export interface ModelsMenuResult {
  providers: ProviderConfig[];
  assignments: Assignments;
}

/**
 * Interactive /models menu: reassign a role, add or remove a provider.
 * Returns the updated settings, or null when nothing changed.
 */
export async function promptModelsMenu(
  cfg: { apiKey: string; providers: ProviderConfig[]; assignments: Assignments; siteUrl?: string; appName?: string },
  openRouterModels: ModelOption[]
): Promise<ModelsMenuResult | null> {
  let providers = cfg.providers.map(p => ({ ...p }));
  const assignments: Assignments = JSON.parse(JSON.stringify(cfg.assignments));
  let changed = false;

  for (;;) {
    console.log('\n' + chalk.bold('Model assignments') + '\n' + formatAssignments(assignments, providers) + '\n');
    const action = await select({
      message: 'Models:',
      choices: [
        { name: 'Reassign a role', value: 'reassign' },
        { name: 'Add provider (OpenAI-compatible, e.g. Ollama / LM Studio)', value: 'add' },
        { name: 'Remove provider', value: 'remove', disabled: providers.length === 0 ? '(none)' : false },
        { name: 'Done', value: 'done' }
      ]
    });

    if (action === 'done') return changed ? { providers, assignments } : null;

    if (action === 'add') {
      const name = (await input({ message: 'Provider name:', default: 'Ollama' })).trim();
      const baseUrl = (await input({ message: 'Base URL (API root):', default: 'http://localhost:11434/v1' })).trim();
      const apiKey = (await password({ message: 'API key (optional, Enter to skip):', mask: '*' })).trim();
      const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider';
      let id = baseId === OPENROUTER_PROVIDER_ID ? `${baseId}-local` : baseId;
      for (let n = 2; providers.some(p => p.id === id); n++) id = `${baseId}-${n}`;
      providers.push({ id, name, baseUrl, ...(apiKey ? { apiKey } : {}) });
      changed = true;
      continue;
    }

    if (action === 'remove') {
      const id = await select({ message: 'Remove which provider?', choices: providers.map(p => ({ name: `${p.name} (${p.baseUrl})`, value: p.id })) });
      const roles = assignedRolesFor(id, assignments);
      if (roles.length > 0) {
        console.log(chalk.yellow(`⚠ Provider "${providers.find(p => p.id === id)?.name}" is assigned to: ${roles.join(', ')}. Reassign those roles first.`));
        continue;
      }
      providers = providers.filter(p => p.id !== id);
      changed = true;
      continue;
    }

    // reassign
    const role = await select<ModelRole>({
      message: 'Which role?',
      choices: MODEL_ROLES.map(r => ({ name: r, value: r }))
    });
    const all = allProviders(cfg.apiKey, providers);
    const providerId = await select({
      message: 'Provider:',
      choices: all.map(p => ({ name: p.name, value: p.id })),
      default: assignments[role].providerId
    });
    const provider = all.find(p => p.id === providerId)!;
    const model = await promptModelForProvider(provider, openRouterModels, assignments[role].providerId === providerId ? assignments[role].model : '');
    if (!model) continue;

    if (role === 'drafting') {
      const client = createProviderClient(provider, { siteUrl: cfg.siteUrl, appName: cfg.appName });
      const probe = await probeToolCalling(client, model);
      if (!probe.ok) {
        console.log(chalk.yellow(`⚠ Tool-calling check failed for ${model} on ${provider.name}: ${probe.detail}`));
        console.log(chalk.yellow('  Drafting needs tool calling to write documents. Saved anyway.'));
      } else {
        console.log(chalk.green(`✔ Tool calling supported by ${model}`));
      }
    }
    if (role === 'critic') {
      console.log(chalk.dim('  The critic gates every deliverable; assign your strongest model.'));
    }
    assignments[role] = { providerId, model };
    changed = true;
  }
}
