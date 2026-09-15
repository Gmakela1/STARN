import { select, input, confirm, password, search, Separator } from '@inquirer/prompts';
import chalk from 'chalk';
import { ModelOption } from '../openrouter/models.js';
import { ProjectRecord } from '../workspace/types.js';
import { formatModelChoice } from './ui.js';
import { isVoiceCommand, captureVoicePrompt } from './voice.js';
import { OpenRouterClient } from '../openrouter/client.js';

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

export async function promptUserQuery(client?: OpenRouterClient): Promise<string> {
  const raw = await input({
    message: 'What would you like to build or inspect? (type /voice to speak)',
    validate: val => (val.trim() ? true : 'Please enter a prompt.')
  });

  if (isVoiceCommand(raw) && client) {
    console.log(chalk.cyan('🎤 Recording... (press Enter to stop and transcribe)'));
    try {
      const transcribed = await captureVoicePrompt(client);
      if (!transcribed) {
        console.log(chalk.yellow('No speech captured. Please try again.'));
        return promptUserQuery(client);
      }
      return await input({
        message: 'Edit your prompt (or press Enter to submit):',
        default: transcribed
      });
    } catch (err: any) {
      console.log(chalk.yellow(`Voice capture failed: ${err.message}`));
      return promptUserQuery(client);
    }
  }

  return raw;
}

export async function promptContinueSession(): Promise<boolean> {
  return await confirm({
    message: 'Would you like to perform another task in this project?',
    default: true
  });
}
