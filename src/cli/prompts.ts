import { select, input, confirm } from '@inquirer/prompts';
import { AVAILABLE_MODELS } from '../openrouter/models.js';
import { ProjectRecord } from '../workspace/types.js';

export async function promptSelectModel(currentDefault: string): Promise<string> {
  const choices = AVAILABLE_MODELS.map(m => ({
    name: `${m.name} ${m.recommended ? '(Recommended)' : ''} - ${m.description}`,
    value: m.id
  }));

  return await select({
    message: 'Select OpenRouter Model to use:',
    choices,
    default: currentDefault
  });
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

export async function promptUserQuery(): Promise<string> {
  return await input({
    message: 'What would you like to build or inspect?',
    validate: val => (val.trim() ? true : 'Please enter a prompt.')
  });
}

export async function promptContinueSession(): Promise<boolean> {
  return await confirm({
    message: 'Would you like to perform another task in this project?',
    default: true
  });
}
