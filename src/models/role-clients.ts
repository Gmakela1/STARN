import {
  Assignments,
  MODEL_ROLES,
  ModelRole,
  OPENROUTER_BASE_URL,
  OPENROUTER_PROVIDER_ID,
  ProviderConfig
} from '../config.js';
import { OpenAICompatClient, OpenRouterClient } from '../openrouter/client.js';
import { ChatClient } from '../openrouter/types.js';
import { Logger } from '../util/logger.js';

export interface RoleClient {
  client: ChatClient;
  model: string;
  providerName: string;
}

export type RoleClients = Record<ModelRole, RoleClient>;

export interface RoleClientsConfig {
  apiKey: string;
  providers: ProviderConfig[];
  assignments: Assignments;
  siteUrl?: string;
  appName?: string;
  logger?: Logger;
}

/** Built-in OpenRouter first, then user providers. */
export function allProviders(apiKey: string, providers: ProviderConfig[]): ProviderConfig[] {
  return [
    { id: OPENROUTER_PROVIDER_ID, name: 'OpenRouter', baseUrl: OPENROUTER_BASE_URL, apiKey },
    ...providers
  ];
}

/** Real client for one provider: OpenRouterClient for the built-in, OpenAICompatClient otherwise. */
export function createProviderClient(p: ProviderConfig, opts: { siteUrl?: string; appName?: string; logger?: Logger } = {}): ChatClient {
  return p.id === OPENROUTER_PROVIDER_ID
    ? new OpenRouterClient({ apiKey: p.apiKey ?? '', siteUrl: opts.siteUrl, appName: opts.appName, logger: opts.logger })
    : new OpenAICompatClient({ providerName: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey, logger: opts.logger });
}

/** Builds one client per provider in use and maps each role to { client, model, providerName }. */
export function createRoleClients(
  cfg: RoleClientsConfig,
  factory?: (p: ProviderConfig) => ChatClient
): RoleClients {
  const byId = new Map(allProviders(cfg.apiKey, cfg.providers).map(p => [p.id, p]));
  const make = factory ?? ((p: ProviderConfig) => createProviderClient(p, cfg));

  const clients = new Map<string, ChatClient>();
  const result = {} as RoleClients;
  for (const role of MODEL_ROLES) {
    const { providerId, model } = cfg.assignments[role];
    const provider = byId.get(providerId);
    if (!provider) {
      throw new Error(`Config error: role "${role}" references unknown provider "${providerId}"`);
    }
    if (!clients.has(providerId)) clients.set(providerId, make(provider));
    result[role] = { client: clients.get(providerId)!, model, providerName: provider.name };
  }
  return result;
}
