import { describe, it, expect } from 'vitest';
import { formatAssignments, assignedRolesFor, needsOpenRouterKey } from '../src/cli/model-settings.js';
import { Assignments, ProviderConfig } from '../src/config.js';

const ollama: ProviderConfig = { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' };
const mixed: Assignments = {
  drafting: { providerId: 'openrouter', model: 'a/m' },
  critic: { providerId: 'ollama', model: 'qwen' },
  classifier: { providerId: 'ollama', model: 'qwen' },
  compaction: { providerId: 'openrouter', model: 'c/m' }
};
const allLocal: Assignments = {
  drafting: { providerId: 'ollama', model: 'q' },
  critic: { providerId: 'ollama', model: 'q' },
  classifier: { providerId: 'ollama', model: 'q' },
  compaction: { providerId: 'ollama', model: 'q' }
};

describe('CLI model settings helpers', () => {
  it('formatAssignments prints one line per role', () => {
    expect(formatAssignments(mixed, [ollama])).toBe(
      ['drafting · OpenRouter · a/m', 'critic · Ollama · qwen', 'classifier · Ollama · qwen', 'compaction · OpenRouter · c/m'].join('\n')
    );
  });

  it('assignedRolesFor returns the roles using a provider', () => {
    expect(assignedRolesFor('ollama', mixed)).toEqual(['critic', 'classifier']);
    expect(assignedRolesFor('lm', mixed)).toEqual([]);
  });

  it('needsOpenRouterKey is false only when no role uses OpenRouter', () => {
    expect(needsOpenRouterKey(mixed)).toBe(true);
    expect(needsOpenRouterKey(allLocal)).toBe(false);
  });
});

import { validateProviderInput } from '../src/cli/model-settings.js';

describe('validateProviderInput', () => {
  it('rejects empty name and non-http base URL; accepts a valid provider', () => {
    expect(validateProviderInput(' ', 'http://h/v1')).toBe('Provider needs a name');
    expect(validateProviderInput('Ollama', 'localhost:11434/v1')).toBe('Base URL must start with http:// or https://');
    expect(validateProviderInput('Ollama', 'http://localhost:11434/v1')).toBe(true);
  });
});
