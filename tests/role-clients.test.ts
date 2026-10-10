import { describe, it, expect, vi } from 'vitest';
import { createRoleClients, allProviders } from '../src/models/role-clients.js';
import { Assignments, ProviderConfig } from '../src/config.js';
import { ChatClient } from '../src/openrouter/types.js';

const ollama: ProviderConfig = { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' };
const assignments: Assignments = {
  drafting: { providerId: 'openrouter', model: 'a/m' },
  critic: { providerId: 'openrouter', model: 'b/m' },
  classifier: { providerId: 'ollama', model: 'qwen' },
  compaction: { providerId: 'ollama', model: 'llama' }
};

describe('createRoleClients', () => {
  it('one client per provider shared across roles', () => {
    const factory = vi.fn((_p: ProviderConfig): ChatClient => ({ chatCompletion: vi.fn() }));
    const rc = createRoleClients({ apiKey: 'k', providers: [ollama], assignments }, factory);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(rc.drafting.client).toBe(rc.critic.client);
    expect(rc.classifier.client).toBe(rc.compaction.client);
    expect(rc.drafting.client).not.toBe(rc.classifier.client);
  });

  it('roles map to assigned model and providerName', () => {
    const rc = createRoleClients({ apiKey: 'k', providers: [ollama], assignments }, () => ({ chatCompletion: vi.fn() }));
    expect(rc.critic).toMatchObject({ model: 'b/m', providerName: 'OpenRouter' });
    expect(rc.classifier).toMatchObject({ model: 'qwen', providerName: 'Ollama' });
  });

  it('allProviders lists built-in OpenRouter first', () => {
    const all = allProviders('k', [ollama]);
    expect(all[0]).toMatchObject({ id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' });
    expect(all[1]).toBe(ollama);
  });
});
