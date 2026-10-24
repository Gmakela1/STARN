import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Save,
  Settings2,
  FolderOpen,
  Folder,
  Network,
  Plus,
  Trash2,
  PlugZap,
  ChevronUp,
  Search,
  ArrowRight,
  Globe,
  Bot
} from 'lucide-react';
import { api } from '../api/client';
import {
  Assignments,
  ModelRole,
  ProviderInput,
  Settings,
  ProjectRecord,
  FolderEntry,
  SearchProvider
} from '../types/api';

export interface SettingsViewProps {
  onSaved: () => Promise<void> | void;
  onProjectSwitched?: () => Promise<void> | void;
}

const ROLES: Array<{ role: ModelRole; label: string; note?: string }> = [
  { role: 'drafting', label: 'Drafting', note: 'Writes every deliverable and runs intake. Needs tool calling.' },
  { role: 'critic', label: 'Critic', note: 'The critic gates every deliverable; assign your strongest model.' },
  { role: 'classifier', label: 'Classifier', note: 'Routes each request to a specialist. A small fast model is fine.' },
  { role: 'compaction', label: 'Compaction', note: 'Summarizes long sessions.' },
  { role: 'transcriber', label: 'Transcriber', note: 'Reads scanned PDFs (manuals, datasheets). Recommended: gemini-2.5-flash (low cost). Local: qwen2.5vl:7b.' }
];

/** Editable provider row. `apiKey` undefined = keep stored key. */
interface ProviderDraft extends ProviderInput {
  builtIn: boolean;
  hasKey: boolean;
}

const inputClass =
  'mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none';

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider';

export default function SettingsView({ onSaved, onProjectSwitched }: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [providers, setProviders] = useState<ProviderDraft[]>([]);
  const [assignments, setAssignments] = useState<Assignments | null>(null);
  const [models, setModels] = useState<Record<string, string[] | { error: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(true);
  const [autopilotEnabled, setAutopilotEnabled] = useState(true);

  // Project switching state
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [switchingProject, setSwitchingProject] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState<string>('');
  const [parentBrowsePath, setParentBrowsePath] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [customPathInput, setCustomPathInput] = useState('');
  const [browsingLoading, setBrowsingLoading] = useState(false);

  // Search settings state
  const [searchProvider, setSearchProvider] = useState<SearchProvider>('openrouter');
  const [tavilyKey, setTavilyKey] = useState<string>('');
  const [braveKey, setBraveKey] = useState<string>('');
  const [hasTavilyKey, setHasTavilyKey] = useState<boolean>(false);
  const [hasBraveKey, setHasBraveKey] = useState<boolean>(false);
  const [searchProbeResult, setSearchProbeResult] = useState<{ success: boolean; latencyMs?: number; error?: string } | null>(null);
  const [probingSearch, setProbingSearch] = useState<boolean>(false);
  const [savingSearch, setSavingSearch] = useState<boolean>(false);

  const loadProjects = async () => {
    try {
      const res = await api.fetchProjects();
      setProjects(res.projects);
      setActiveProjectId(res.activeId);
      setSelectedProjectId(res.activeId);
    } catch {
      // ignore
    }
  };

  const loadFolders = async (targetPath?: string, q?: string) => {
    setBrowsingLoading(true);
    try {
      const res = await api.browseFolders(targetPath, q);
      setBrowsePath(res.currentPath);
      setParentBrowsePath(res.parentPath);
      setFolders(res.folders);
      setCustomPathInput(res.currentPath);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to browse directory');
    } finally {
      setBrowsingLoading(false);
    }
  };

  const handleSwitchProject = async (opts: { projectId?: string; path?: string }) => {
    setSwitchingProject(true);
    setError(null);
    try {
      await api.switchProject(opts);
      await loadProjects();
      const updatedSettings = await api.fetchSettings();
      load(updatedSettings);
      setNotice('Switched active project successfully.');
      if (onProjectSwitched) {
        await onProjectSwitched();
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to switch project');
    } finally {
      setSwitchingProject(false);
    }
  };

  const load = (s: Settings) => {
    setSettings(s);
    setProviders(s.providers.map(p => ({ ...p, apiKey: undefined })));
    setAssignments(s.assignments);
    setTranscriptionEnabled(s.transcriptionEnabled ?? true);
    setAutopilotEnabled(s.autopilotEnabled ?? true);
  };

  useEffect(() => {
    api.fetchSettings().then(load).catch(err => setError(err?.message ?? 'Failed to load settings'));
    void loadProjects();
    void loadSearch();
  }, []);

  const loadSearch = async () => {
    try {
      const res = await api.fetchSearchSettings();
      setSearchProvider(res.provider);
      setHasTavilyKey(res.hasTavilyKey);
      setHasBraveKey(res.hasBraveKey);
    } catch {}
  };

  const handleSaveSearch = async () => {
    setSavingSearch(true);
    try {
      const res = await api.saveSearchSettings({
        provider: searchProvider,
        tavilyApiKey: tavilyKey || undefined,
        braveApiKey: braveKey || undefined
      });
      setSearchProvider(res.provider);
      setHasTavilyKey(res.hasTavilyKey);
      setHasBraveKey(res.hasBraveKey);
      setNotice('Search provider settings saved');
      setTimeout(() => setNotice(null), 3000);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save search settings');
    } finally {
      setSavingSearch(false);
    }
  };

  const handleProbeSearch = async () => {
    setProbingSearch(true);
    setSearchProbeResult(null);
    try {
      const res = await api.probeSearchProvider({
        provider: searchProvider,
        apiKey: searchProvider === 'tavily' ? tavilyKey : searchProvider === 'brave' ? braveKey : undefined
      });
      setSearchProbeResult({ success: res.success, latencyMs: res.latencyMs, error: res.error });
    } catch (err: any) {
      setSearchProbeResult({ success: false, error: err?.message ?? 'Probe failed' });
    } finally {
      setProbingSearch(false);
    }
  };

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
        assignments,
        transcriptionEnabled,
        autopilotEnabled
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

        {/* Project Switcher Card */}
        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-labelledby="project-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="project-heading" className="text-sm font-bold text-slate-200">Active Project</h2>
            <button
              type="button"
              onClick={() => {
                setBrowseOpen(v => !v);
                if (!browseOpen && !browsePath) void loadFolders(settings?.projectPath);
              }}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800"
            >
              <FolderOpen className="h-4 w-4 text-sky-400" aria-hidden />
              {browseOpen ? 'Hide folder browser' : 'Browse folders…'}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label htmlFor="known-project-select" className="text-xs font-medium text-slate-300">
                Known projects
              </label>
              <select
                id="known-project-select"
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
                className={inputClass}
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.path}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => handleSwitchProject({ projectId: selectedProjectId })}
                disabled={switchingProject || selectedProjectId === activeProjectId}
                className="flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
              >
                {switchingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Switch
              </button>
            </div>
          </div>

          {/* Expandable filesystem browser panel */}
          {browseOpen && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-300 break-all">{browsePath}</span>
                {parentBrowsePath && (
                  <button
                    type="button"
                    onClick={() => void loadFolders(parentBrowsePath)}
                    className="flex min-h-[44px] items-center gap-1 rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    <ChevronUp className="h-3.5 w-3.5" /> Up
                  </button>
                )}
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter folders..."
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    void loadFolders(browsePath, e.target.value);
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-900 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="max-h-56 overflow-y-auto space-y-1 divide-y divide-slate-800/40">
                {browsingLoading ? (
                  <div className="py-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading folders…
                  </div>
                ) : folders.length === 0 ? (
                  <p className="py-2 text-center text-xs text-slate-500">No subdirectories found.</p>
                ) : (
                  folders.map(f => (
                    <div
                      key={f.path}
                      onClick={() => void loadFolders(f.path)}
                      className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded px-2 hover:bg-slate-900 transition-colors"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Folder className="h-4 w-4 text-sky-400 shrink-0" />
                        <span className="text-sm text-slate-200 truncate">{f.name}</span>
                      </div>
                      {f.isProject && (
                        <span className="rounded bg-sky-950 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-300 border border-sky-800">
                          STARN Project
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-slate-800 pt-3 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={customPathInput}
                  onChange={e => setCustomPathInput(e.target.value)}
                  placeholder="Paste or type path..."
                  className="min-h-[44px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 font-mono placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleSwitchProject({ path: customPathInput })}
                  disabled={switchingProject || !customPathInput.trim()}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
                >
                  Use this folder
                </button>
              </div>
            </div>
          )}
        </section>

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

        {/* Document Transcription */}
        <section aria-labelledby="transcription-heading" className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="transcription-heading" className="text-sm font-bold text-slate-200">Document Transcription</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                When on, scanned PDFs without text (manuals, datasheets) are read by the Transcriber model. Cost: ~$0.0005/page on the
                recommended model — a 25-page manual ≈ $0.05. Local models (Ollama / LM Studio) cost $0/token.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={transcriptionEnabled}
              onClick={() => setTranscriptionEnabled(v => !v)}
              className={`relative flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${transcriptionEnabled ? 'bg-cyan-600' : 'bg-slate-700'}`}
              aria-label="Toggle document transcription"
            >
              <span className={`absolute h-5 w-5 rounded-full bg-white transition-transform ${transcriptionEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
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

        {/* Web Search & Hardware Sourcing */}
        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-bold text-slate-200">Web Search & Hardware Sourcing</h2>
          </div>
          <p className="text-xs text-slate-400">
            Enables the BOM specialist to search the internet for component datasheets, prices, and vendor links.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className={`flex cursor-pointer flex-col rounded-lg border p-3 transition-colors ${
              searchProvider === 'openrouter' ? 'border-sky-500 bg-sky-950/30' : 'border-slate-800 bg-slate-950 hover:border-slate-700'
            }`}>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="searchProvider"
                  value="openrouter"
                  checked={searchProvider === 'openrouter'}
                  onChange={() => setSearchProvider('openrouter')}
                  className="accent-sky-500"
                />
                <span className="text-xs font-semibold text-slate-200">OpenRouter (Built-in)</span>
              </div>
              <span className="mt-1 text-[11px] text-slate-400">
                Zero configuration. Uses OpenRouter server tool and credits.
              </span>
            </label>

            <label className={`flex cursor-pointer flex-col rounded-lg border p-3 transition-colors ${
              searchProvider === 'tavily' ? 'border-sky-500 bg-sky-950/30' : 'border-slate-800 bg-slate-950 hover:border-slate-700'
            }`}>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="searchProvider"
                  value="tavily"
                  checked={searchProvider === 'tavily'}
                  onChange={() => setSearchProvider('tavily')}
                  className="accent-sky-500"
                />
                <span className="text-xs font-semibold text-slate-200">Tavily Search</span>
              </div>
              <span className="mt-1 text-[11px] text-slate-400">
                Recommended for LLMs. Clean spec extraction (1,000 free/mo).
              </span>
            </label>

            <label className={`flex cursor-pointer flex-col rounded-lg border p-3 transition-colors ${
              searchProvider === 'brave' ? 'border-sky-500 bg-sky-950/30' : 'border-slate-800 bg-slate-950 hover:border-slate-700'
            }`}>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="searchProvider"
                  value="brave"
                  checked={searchProvider === 'brave'}
                  onChange={() => setSearchProvider('brave')}
                  className="accent-sky-500"
                />
                <span className="text-xs font-semibold text-slate-200">Brave Search</span>
              </div>
              <span className="mt-1 text-[11px] text-slate-400">
                Fast, private web search API.
              </span>
            </label>
          </div>

          {searchProvider === 'tavily' && (
            <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">Tavily API Key</span>
                {hasTavilyKey && (
                  <span className="rounded bg-emerald-950 px-2 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-800">
                    Stored on server
                  </span>
                )}
              </div>
              <input
                type="password"
                placeholder={hasTavilyKey ? '••••••••  (Leave blank to keep stored key)' : 'tvly-...'}
                value={tavilyKey}
                onChange={e => setTavilyKey(e.target.value)}
                className={inputClass}
              />
            </div>
          )}

          {searchProvider === 'brave' && (
            <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">Brave Search API Key</span>
                {hasBraveKey && (
                  <span className="rounded bg-emerald-950 px-2 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-800">
                    Stored on server
                  </span>
                )}
              </div>
              <input
                type="password"
                placeholder={hasBraveKey ? '••••••••  (Leave blank to keep stored key)' : 'BSA...'}
                value={braveKey}
                onChange={e => setBraveKey(e.target.value)}
                className={inputClass}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={() => void handleSaveSearch()}
              disabled={savingSearch}
              className="flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-700 px-4 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50 cursor-pointer"
            >
              {savingSearch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Search Settings
            </button>

            <button
              onClick={() => void handleProbeSearch()}
              disabled={probingSearch}
              className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              {probingSearch ? <Loader2 className="h-4 w-4 animate-spin text-sky-400" /> : <PlugZap className="h-4 w-4" />}
              Test Connection
            </button>

            {searchProbeResult && (
              <span className={`text-xs ${searchProbeResult.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                {searchProbeResult.success
                  ? `✓ Connected (${searchProbeResult.latencyMs}ms)`
                  : `✗ Connection failed: ${searchProbeResult.error}`}
              </span>
            )}
          </div>
        </section>

        {/* Autopilot */}
        <section aria-labelledby="autopilot-heading" className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-cyan-400" />
            <h2 id="autopilot-heading" className="text-sm font-bold text-slate-200">Autopilot</h2>
          </div>
          <p className="text-xs text-slate-400">AI auto-drafts all 13 documents end-to-end with minimal human interference.</p>
          <div className="flex items-start justify-between gap-4 mt-3">
            <div>
              <p className="text-sm font-semibold text-slate-200">Master Autopilot Toggle</p>
              <p className="mt-1 text-xs text-slate-400">When enabled, the specialist chain auto-runs on project creation or phase transitions.</p>
            </div>
            <button role="switch" aria-checked={autopilotEnabled} onClick={() => setAutopilotEnabled(v => !v)}
              className={`relative flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${autopilotEnabled ? 'bg-cyan-600' : 'bg-slate-700'}`}
              aria-label="Toggle autopilot">
              <span className={`absolute h-5 w-5 rounded-full bg-white transition-transform ${autopilotEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {/* Deferred token-budget slot */}
          <div className="mt-3 rounded-lg border border-dashed border-slate-700 bg-slate-950/40 p-4 opacity-40 pointer-events-none">
            <p className="text-xs font-semibold text-slate-400">Per-doc token budget &amp; model-based cost estimate</p>
            <p className="mt-1 text-[11px] text-slate-500">Coming in a future release.</p>
          </div>
        </section>

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
