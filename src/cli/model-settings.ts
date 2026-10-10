import { Assignments, MODEL_ROLES, ModelRole, OPENROUTER_PROVIDER_ID, ProviderConfig } from '../config.js';

const providerName = (id: string, providers: ProviderConfig[]) =>
  id === OPENROUTER_PROVIDER_ID ? 'OpenRouter' : providers.find(p => p.id === id)?.name ?? id;

/** One line per role: "<role> · <provider name> · <model>". */
export function formatAssignments(a: Assignments, providers: ProviderConfig[]): string {
  return MODEL_ROLES.map(r => `${r} · ${providerName(a[r].providerId, providers)} · ${a[r].model}`).join('\n');
}

/** Roles currently assigned to the given provider id. */
export function assignedRolesFor(providerId: string, a: Assignments): ModelRole[] {
  return MODEL_ROLES.filter(r => a[r].providerId === providerId);
}

/** True when at least one role runs on OpenRouter (so an OpenRouter key is required). */
export function needsOpenRouterKey(a: Assignments): boolean {
  return assignedRolesFor(OPENROUTER_PROVIDER_ID, a).length > 0;
}

/** Validates a provider name + base URL for the /models add flow. Returns true or an error message. */
export function validateProviderInput(name: string, baseUrl: string): true | string {
  if (!name.trim()) return 'Provider needs a name';
  if (!/^https?:\/\//i.test(baseUrl.trim())) return 'Base URL must start with http:// or https://';
  return true;
}
