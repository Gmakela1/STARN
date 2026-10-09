import { useEffect, useState } from 'react';
import { Loader2, Save, Settings2, FolderOpen, Network, Box, Server, Cloud } from 'lucide-react';
import { api } from '../api/client';
import { Settings } from '../types/api';

export interface SettingsViewProps {
  onSaved: () => Promise<void> | void;
}

export default function SettingsView({ onSaved }: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [agentModel, setAgentModel] = useState('');
  const [compactionModel, setCompactionModel] = useState('');
  const [twinProvider, setTwinProvider] = useState<'openrouter' | 'local'>('openrouter');
  const [twinBaseUrl, setTwinBaseUrl] = useState('');
  const [twinModel, setTwinModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.fetchSettings()
      .then(s => {
        setSettings(s);
        setAgentModel(s.agentModel);
        setCompactionModel(s.compactionModel ?? '');
        setTwinProvider(s.digitalTwinProvider ?? 'openrouter');
        setTwinBaseUrl(s.digitalTwinBaseUrl ?? 'http://localhost:11434/v1');
        setTwinModel(s.digitalTwinModel ?? '');
      })
      .catch(err => setError(err?.message ?? 'Failed to load settings'));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.saveSettings({
        agentModel: agentModel.trim(),
        compactionModel: compactionModel.trim() || undefined,
        digitalTwinProvider: twinProvider,
        digitalTwinBaseUrl: twinProvider === 'local' ? (twinBaseUrl.trim() || undefined) : undefined,
        digitalTwinModel: twinModel.trim() || undefined
      });
      setSettings(updated);
      setNotice('Settings applied to the live session and saved to ~/.starn/config.json.');
      await onSaved();
      setTimeout(() => setNotice(null), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!settings && !error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading settings…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-center gap-2.5">
          <Settings2 className="h-5 w-5 text-sky-400" aria-hidden />
          <h1 className="text-lg font-bold text-slate-100">Settings</h1>
        </header>

        {error && (
          <p className="rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-2 text-xs text-rose-300" role="alert">{error}</p>
        )}
        {notice && (
          <p className="rounded-lg border border-emerald-900 bg-emerald-950/50 px-3 py-2 text-xs text-emerald-300" role="status">{notice}</p>
        )}

        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-bold text-slate-200">Models</h2>

          <div>
            <label htmlFor="agent-model" className="text-xs font-medium text-slate-300">
              Agent model <span className="text-slate-500">(OpenRouter ID — drives specialists &amp; critic)</span>
            </label>
            <input
              id="agent-model"
              value={agentModel}
              onChange={e => setAgentModel(e.target.value)}
              placeholder="e.g. anthropic/claude-sonnet-4.5"
              className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="compaction-model" className="text-xs font-medium text-slate-300">
              Compaction model <span className="text-slate-500">(optional — summarizes long sessions)</span>
            </label>
            <input
              id="compaction-model"
              value={compactionModel}
              onChange={e => setCompactionModel(e.target.value)}
              placeholder="e.g. google/gemini-2.5-flash"
              className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none"
            />
          </div>
        </section>

        {/* Digital Twin Spatial Model & Local Endpoint */}
        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center gap-2">
            <Box className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-bold text-slate-200">Digital Twin Spatial Model</h2>
          </div>
          <p className="text-xs text-slate-400">
            Dedicated endpoint for 3D coordinate mapping and spatial collision reasoning. Supports private local hosts.
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTwinProvider('openrouter')}
              className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                twinProvider === 'openrouter'
                  ? 'border-sky-500 bg-sky-950/40 text-sky-300'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-900'
              }`}
            >
              <Cloud className="h-4 w-4" />
              OpenRouter Cloud
            </button>

            <button
              type="button"
              onClick={() => setTwinProvider('local')}
              className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                twinProvider === 'local'
                  ? 'border-sky-500 bg-sky-950/40 text-sky-300'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-900'
              }`}
            >
              <Server className="h-4 w-4" />
              Local Endpoint (Ollama / vLLM)
            </button>
          </div>

          {twinProvider === 'local' && (
            <div>
              <label htmlFor="twin-base-url" className="text-xs font-medium text-slate-300">
                Local Base URL <span className="text-slate-500">(OpenAI-compatible endpoint)</span>
              </label>
              <input
                id="twin-base-url"
                value={twinBaseUrl}
                onChange={e => setTwinBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1 or http://192.168.1.X:8000/v1"
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label htmlFor="twin-model" className="text-xs font-medium text-slate-300">
              Spatial model tag / identifier
            </label>
            <input
              id="twin-model"
              value={twinModel}
              onChange={e => setTwinModel(e.target.value)}
              placeholder={twinProvider === 'local' ? 'e.g. llama3.3:70b or qwen2.5-coder:32b' : 'e.g. anthropic/claude-3.5-sonnet'}
              className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none"
            />
          </div>

          <button
            onClick={() => void save()}
            disabled={saving || !agentModel.trim()}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-600 px-5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-40 cursor-pointer"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Apply to live session
          </button>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Changes take effect immediately on subsequent requests. Persisted defaults live in{' '}
            <span className="font-mono">~/.starn/config.json</span>.
          </p>
        </section>

        {settings && (
          <section className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="text-sm font-bold text-slate-200">Session</h2>
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
              <span className="font-mono">{settings.projectPath}</span>
            </p>
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <Network className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
              Serving on port <span className="font-mono text-slate-300">{settings.port}</span>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
