import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Settings2, FolderOpen, Network, Plus, Trash2, PlugZap } from 'lucide-react';
import { api } from '../api/client';
import { Assignments, ModelRole, ProviderInput, Settings } from '../types/api';

export interface SettingsViewProps {
  onSaved: () => Promise<void> | void;
}

const ROLES: Array<{ role: ModelRole; label: string; note?: string }> = [
  { role: 'drafting', label: 'Drafting', note: 'Writes every deliverable and runs intake. Needs tool calling.' },
  { role: 'critic', label: 'Critic', note: 'The critic gates every deliverable; assign your strongest model.' },
  { role: 'classifier', label: 'Classifier', note: 'Routes each request to a specialist. A small fast model is fine.' },
  { role: 'compaction', label: 'Compaction', note: 'Summarizes long sessions.' }
];

/** Editable provider row. `apiKey` undefined = keep stored key. */
interface ProviderDraft extends ProviderInput {
  builtIn: boolean;
  hasKey: boolean;
}

const inputClass =
  'mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none';

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider';

export default function SettingsView({ onSaved }: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [providers, setProviders] = useState<ProviderDraft[]>([]);
  const [assignments, setAssignments] = useState<Assignments | null>(null);
  const [models, setModels] = useState<Record<string, string[] | { error: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (s: Settings) => {
    setSettings(s);
    setProviders(s.providers.map(p => ({ ...p, apiKey: undefined })));
    setAssignments(s.assignments);
  };

  useEffect(() => {
    api.fetchSettings().then(load).catch(err => setError(err?.message ?? 'Failed to load settings'));
  }, []);

  const fetchModels = async (providerId: string) => {
    setTesting(providerId);
    try {
      const { models: list } = await api.listProviderModels(providerId);
      setModels(m => ({ ...m, [providerId]: list }));
    } catch (err: any) {
      setModels(m => ({ ...m, [providerId]: { error: err?.message ?? 'Unreachable' } }));
    } finally {
      setTesting(null);
    }
  };

  // Load model lists for providers already in use (saved providers only).
  useEffect(() => {
    if (!assignments || !settings) return;
    const used = new Set(Object.values(assignments).map(a => a.providerId));
    for (const id of used) {
      if (!(id in models) && settings.providers.some(p => p.id === id)) void fetchModels(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, settings]);

  const dirtyProviders = useMemo(() => {
    if (!settings) return false;
    const saved = settings.providers.filter(p => !p.builtIn);
    const draft = providers.filter(p => !p.builtIn);
    return (
      saved.length !== draft.length ||
      draft.some((p, i) => p.id !== saved[i]?.id || p.name !== saved[i]?.name || p.baseUrl !== saved[i]?.baseUrl || p.apiKey !== undefined)
    );
  }, [settings, providers]);

  const updateProvider = (index: number, patch: Partial<ProviderDraft>) =>
    setProviders(list => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const addProvider = () => {
    const taken = new Set(providers.map(p => p.id));
    let id = 'ollama';
    for (let n = 2; taken.has(id); n++) id = `ollama-${n}`;
    setProviders(list => [...list, { id, name: 'Ollama', baseUrl: 'http://localhost:11434/v1', builtIn: false, hasKey: false }]);
  };

  const assignedRoles = (providerId: string) =>
    assignments ? ROLES.filter(r => assignments[r.role].providerId === providerId).map(r => r.label) : [];

  const save = async () => {
    if (!assignments) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setWarning(null);
    try {
      const updated = await api.saveSettings({
        providers: providers
          .filter(p => !p.builtIn)
          .map(p => ({
            id: p.id || slug(p.name),
            name: p.name.trim(),
            baseUrl: p.baseUrl.trim(),
            ...(p.apiKey !== undefined ? { apiKey: p.apiKey } : {})
          })),
        assignments
      });
      load(updated);
      if (updated.probe && !updated.probe.ok) {
        setWarning(`Drafting model failed the tool-calling check: ${updated.probe.detail}. Saved anyway; drafts may not be written.`);
      }
      setNotice('Saved. Applies to the next request and persists to ~/.starn/config.json.');
      await onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!settings && !error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading settings…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-center gap-2.5">
          <Settings2 className="h-5 w-5 text-sky-400" aria-hidden />
          <h1 className="text-lg font-bold text-slate-100">Settings</h1>
        </header>

        {error && (
          <p className="rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-2 text-sm text-rose-200" role="alert">{error}</p>
        )}
        {warning && (
          <p className="rounded-lg border border-amber-900 bg-amber-950/50 px-3 py-2 text-sm text-amber-200" role="alert">{warning}</p>
        )}
        {notice && (
          <p className="rounded-lg border border-emerald-900 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-200" role="status">{notice}</p>
        )}

        {/* Providers */}
        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-labelledby="providers-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="providers-heading" className="text-sm font-bold text-slate-200">Providers</h2>
            <button
              type="button"
              onClick={addProvider}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add provider
            </button>
          </div>
          <p className="text-sm text-slate-400">
            OpenRouter plus any OpenAI-compatible server (Ollama, LM Studio, llama.cpp). STARN connects to them; it does not start them.
          </p>

          <ul className="space-y-3">
            {providers.map((p, i) => {
              const list = models[p.id];
              const roles = assignedRoles(p.id);
              const saved = settings?.providers.some(s => s.id === p.id);
              return (
                <li key={`${p.id}-${i}`} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  {p.builtIn ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">OpenRouter</p>
                        <p className="font-mono text-xs text-slate-400">{p.baseUrl}</p>
                        <p className="text-xs text-slate-400">{p.hasKey ? 'API key configured' : 'No API key (set OPENROUTER_API_KEY)'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`prov-name-${i}`} className="text-xs font-medium text-slate-300">Name</label>
                        <input id={`prov-name-${i}`} value={p.name} onChange={e => updateProvider(i, { name: e.target.value })} className={inputClass} />
                      </div>
                      <div>
                        <label htmlFor={`prov-url-${i}`} className="text-xs font-medium text-slate-300">Base URL (API root)</label>
                        <input
                          id={`prov-url-${i}`}
                          value={p.baseUrl}
                          onChange={e => updateProvider(i, { baseUrl: e.target.value })}
                          placeholder="http://localhost:11434/v1"
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor={`prov-key-${i}`} className="text-xs font-medium text-slate-300">API key (optional)</label>
                        <input
                          id={`prov-key-${i}`}
                          type="password"
                          autoComplete="off"
                          value={p.apiKey ?? ''}
                          onChange={e => updateProvider(i, { apiKey: e.target.value })}
                          placeholder={p.hasKey ? 'unchanged' : 'none'}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void fetchModels(p.id)}
                      disabled={!saved || testing === p.id}
                      title={saved ? undefined : 'Save first to test this provider'}
                      className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {testing === p.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlugZap className="h-4 w-4" aria-hidden />}
                      Test connection
                    </button>
                    {!p.builtIn && (
                      <button
                        type="button"
                        onClick={() => setProviders(l => l.filter((_, j) => j !== i))}
                        disabled={roles.length > 0}
                        title={roles.length > 0 ? `Assigned to: ${roles.join(', ')}` : undefined}
                        className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden /> Remove
                      </button>
                    )}
                    <span className="text-sm" role="status">
                      {list && 'error' in list && <span className="text-rose-300">{list.error}</span>}
                      {Array.isArray(list) && <span className="text-emerald-300">{list.length} models available</span>}
                      {roles.length > 0 && <span className="ml-2 text-slate-400">Used by: {roles.join(', ')}</span>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Assignments */}
        {assignments && (
          <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-labelledby="assign-heading">
            <h2 id="assign-heading" className="text-sm font-bold text-slate-200">Model assignments</h2>
            {dirtyProviders && (
              <p className="text-sm text-amber-200">Save provider changes before assigning roles to new providers.</p>
            )}
            {ROLES.map(({ role, label, note }) => {
              const a = assignments[role];
              const list = models[a.providerId];
              const options = Array.isArray(list) ? list : null;
              const setA = (patch: Partial<typeof a>) => setAssignments(cur => (cur ? { ...cur, [role]: { ...cur[role], ...patch } } : cur));
              return (
                <div key={role} className="grid gap-3 border-t border-slate-800 pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[8rem_1fr_1.5fr]">
                  <div>
                    <p className="pt-2 text-sm font-semibold text-slate-100">{label}</p>
                  </div>
                  <div>
                    <label htmlFor={`assign-prov-${role}`} className="text-xs font-medium text-slate-300">Provider</label>
                    <select
                      id={`assign-prov-${role}`}
                      value={a.providerId}
                      onChange={e => {
                        setA({ providerId: e.target.value, model: '' });
                        if (!(e.target.value in models)) void fetchModels(e.target.value);
                      }}
                      className={inputClass}
                    >
                      {(settings?.providers ?? []).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`assign-model-${role}`} className="text-xs font-medium text-slate-300">Model</label>
                    {options && options.length > 0 ? (
                      <select id={`assign-model-${role}`} value={a.model} onChange={e => setA({ model: e.target.value })} className={inputClass}>
                        {!options.includes(a.model) && <option value={a.model}>{a.model || 'Select a model'}</option>}
                        {options.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`assign-model-${role}`}
                        value={a.model}
                        onChange={e => setA({ model: e.target.value })}
                        placeholder="model id"
                        className={`${inputClass} font-mono`}
                      />
                    )}
                  </div>
                  {note && <p className="text-xs text-slate-400 sm:col-span-3">{note}</p>}
                </div>
              );
            })}
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={saving || !assignments || Object.values(assignments).some(a => !a.model.trim())}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-700 px-5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Save
          </button>
          <p className="text-xs text-slate-400">Saving the drafting role runs a quick tool-calling check.</p>
        </div>

        {settings && (
          <section className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="text-sm font-bold text-slate-200">Session</h2>
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <FolderOpen className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
              <span className="font-mono">{settings.projectPath}</span>
            </p>
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Network className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
              Serving on port <span className="font-mono text-slate-200">{settings.port}</span>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
