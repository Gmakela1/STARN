import { OPENROUTER_PROVIDER_ID, loadConfig, saveUserConfig, SearchProvider, ProviderConfig } from '../../config.js';
import type { SettingsResponse } from '../types.js';
import { createSearchClient } from '../../tools/search/search-client.js';
import { listProviderModels, probeToolCalling } from '../../models/provider-models.js';
import { fetchLiveOpenRouterModels } from '../../openrouter/models.js';
import { readJsonBody, ok, fail, buildSettings, RouteModule } from './kit.js';

export const settingsModule: RouteModule = {
  name: 'settings',
  match: (url, segments) => ['settings', 'providers'].includes(segments[1]),
  handle: async (deps, req, res, url, segments) => {
    const method = (req.method ?? 'GET').toUpperCase();
    // --- Settings ---------------------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/settings/search') {
      const cfg = loadConfig();
      return ok(res, {
        provider: cfg.search?.provider || 'openrouter',
        hasTavilyKey: Boolean(cfg.search?.tavilyApiKey),
        hasBraveKey: Boolean(cfg.search?.braveApiKey)
      });
    }

    if (method === 'POST' && url.pathname === '/api/settings/search') {
      const body = await readJsonBody(req);
      const existingConfig = loadConfig();
      const existingSearch = existingConfig.search || {};

      const newProvider = (body.provider as SearchProvider) || existingSearch.provider || 'openrouter';
      const newTavily = body.tavilyApiKey !== undefined ? String(body.tavilyApiKey) : existingSearch.tavilyApiKey;
      const newBrave = body.braveApiKey !== undefined ? String(body.braveApiKey) : existingSearch.braveApiKey;

      saveUserConfig({
        search: {
          provider: newProvider,
          tavilyApiKey: newTavily,
          braveApiKey: newBrave
        }
      });

      const updatedConfig = loadConfig();
      return ok(res, {
        provider: updatedConfig.search?.provider || 'openrouter',
        hasTavilyKey: Boolean(updatedConfig.search?.tavilyApiKey),
        hasBraveKey: Boolean(updatedConfig.search?.braveApiKey)
      });
    }

    if (method === 'POST' && url.pathname === '/api/settings/search/probe') {
      const body = await readJsonBody(req);
      const provider = (body.provider as SearchProvider) || 'openrouter';
      const apiKey = body.apiKey !== undefined ? String(body.apiKey) : undefined;

      const start = Date.now();
      try {
        const cfg = loadConfig();
        const probeConfig = {
          ...cfg,
          search: {
            provider,
            tavilyApiKey: provider === 'tavily' ? (apiKey || cfg.search?.tavilyApiKey) : cfg.search?.tavilyApiKey,
            braveApiKey: provider === 'brave' ? (apiKey || cfg.search?.braveApiKey) : cfg.search?.braveApiKey
          }
        };
        const client = createSearchClient(probeConfig);
        await client.search('hardware test probe', 1);
        return ok(res, {
          success: true,
          provider,
          latencyMs: Date.now() - start
        });
      } catch (err: any) {
        return ok(res, {
          success: false,
          provider,
          latencyMs: Date.now() - start,
          error: err?.message || String(err)
        });
      }
    }

    if (method === 'GET' && url.pathname === '/api/settings') {
      return ok(res, buildSettings(deps));
    }

    if ((method === 'PUT' || method === 'POST') && url.pathname === '/api/settings') {
      const session = deps.session;
      if (!session) return fail(res, 503, 'No active session');
      const body = await readJsonBody(req);
      const draftingBefore = JSON.stringify(session.assignments.drafting);

      let providers: ProviderConfig[] | undefined;
      if (Array.isArray(body.providers)) {
        const existing = new Map(session.providers.map(p => [p.id, p]));
        providers = body.providers.map((p: any): ProviderConfig => {
          const out: ProviderConfig = { id: String(p.id ?? ''), name: String(p.name ?? ''), baseUrl: String(p.baseUrl ?? '') };
          // apiKey omitted = keep existing; '' = clear; otherwise set.
          const key = p.apiKey === undefined ? existing.get(out.id)?.apiKey : String(p.apiKey);
          if (key) out.apiKey = key;
          return out;
        });
      }

      try {
        session.applySettings({
          providers,
          assignments: body.assignments,
          autopilotEnabled: typeof body.autopilotEnabled === 'boolean' ? body.autopilotEnabled : undefined
        });
      } catch (err: any) {
        return fail(res, 400, err?.message ?? 'Invalid settings');
      }

      const autopilotEnabledVal = typeof body.autopilotEnabled === 'boolean' ? body.autopilotEnabled : undefined;

      deps.onSettingsSaved?.({
        providers: session.providers,
        assignments: session.assignments,
        transcriptionEnabled: typeof body.transcriptionEnabled === 'boolean' ? body.transcriptionEnabled : undefined,
        autopilotEnabled: autopilotEnabledVal
      });

      const response: SettingsResponse = buildSettings(deps);
      const drafting = session.assignments.drafting;
      if (JSON.stringify(drafting) !== draftingBefore) {
        const client = session.clientFor(drafting.providerId);
        if (client) response.probe = await probeToolCalling(client, drafting.model);
      }
      return ok(res, response);
    }

    // --- Providers -------------------------------------------------------------
    if (segments[1] === 'providers' && segments.length === 4) {
      const session = deps.session;
      if (!session) return fail(res, 503, 'No active session');
      const providerId = decodeURIComponent(segments[2]);
      const provider = session.providerById(providerId);
      if (!provider) return fail(res, 404, `Unknown provider "${providerId}"`);

      if (method === 'GET' && segments[3] === 'models') {
        try {
          const models = provider.id === OPENROUTER_PROVIDER_ID
            ? (await fetchLiveOpenRouterModels(provider.apiKey)).map(m => m.id)
            : await listProviderModels(provider);
          return ok(res, { models });
        } catch (err: any) {
          return fail(res, 502, err?.message ?? 'Provider unreachable');
        }
      }

      if (method === 'POST' && segments[3] === 'probe') {
        const body = await readJsonBody(req);
        const client = session.clientFor(providerId)!;
        return ok(res, await probeToolCalling(client, String(body.model ?? '')));
      }
    }

  }
};
