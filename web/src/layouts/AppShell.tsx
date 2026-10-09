import { useEffect, useState } from 'react';
import {
  Bot,
  LayoutDashboard,
  PackageSearch,
  Wrench,
  MessageSquareWarning,
  Box,
  Settings as SettingsIcon,
  Satellite,
  CircleAlert
} from 'lucide-react';
import { api } from '../api/client';
import { ProjectInfo } from '../types/api';
import { useTurnStream } from '../api/useTurnStream';
import DevelopmentView from '../views/DevelopmentView';
import DashboardView from '../views/DashboardView';
import BomView from '../views/BomView';
import WorkInstructionsView from '../views/WorkInstructionsView';
import IssuesAndQuestionsView from '../views/IssuesAndQuestionsView';
import DigitalTwinView from '../views/DigitalTwinView';
import SettingsView from '../views/SettingsView';

export type TabId =
  | 'dashboard'
  | 'development'
  | 'issues'
  | 'parts'
  | 'work'
  | 'twin'
  | 'settings';

const TABS: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'development', label: 'Development', icon: Bot },
  { id: 'issues', label: 'Questions & Issues', icon: MessageSquareWarning },
  { id: 'parts', label: 'Parts', icon: PackageSearch },
  { id: 'work', label: 'Work Instructions', icon: Wrench },
  { id: 'twin', label: 'Digital Twin', icon: Box },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
];

export default function AppShell() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [connected, setConnected] = useState(true);
  const turnStream = useTurnStream();

  const refreshProject = async () => {
    try {
      const info = await api.fetchProject();
      setProject(info);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  useEffect(() => {
    void refreshProject();
    // Restore a pending checkpoint after a page reload / reconnect.
    api.fetchPendingCheckpoint()
      .then(cp => {
        if (cp) turnStream.restoreCheckpoint(cp);
      })
      .catch(() => undefined);
    const interval = setInterval(() => void refreshProject(), 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 border-b border-slate-800 bg-slate-900/70 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <Satellite className="h-6 w-6 text-sky-400" aria-hidden />
          <div>
            <h1 className="text-sm font-bold tracking-widest text-slate-100">STARN</h1>
            <p className="text-[11px] leading-tight text-slate-400">
              {project ? project.name : 'Connecting to project…'}
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {project && (
            <span className="hidden rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-[11px] font-medium text-slate-300 sm:inline-block">
              Phase: <span className="text-sky-300">{project.activePhase.toUpperCase()}</span>
            </span>
          )}
          {!connected && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-rose-700 bg-rose-950/70 px-3 py-1 text-[11px] font-semibold text-rose-300"
              role="status"
            >
              <CircleAlert className="h-3.5 w-3.5" aria-hidden />
              Reconnecting…
            </span>
          )}
          {turnStream.busy && (
            <span className="flex items-center gap-2 rounded-full border border-sky-800 bg-sky-950/70 px-3 py-1 text-[11px] font-medium text-sky-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" aria-hidden />
              Agent working…
            </span>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <nav
        className="flex gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900/40 px-2"
        role="tablist"
        aria-label="Primary"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap border-b-2 px-4 text-[13px] font-medium transition-colors ${
                active
                  ? 'border-sky-400 text-sky-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          );
        })}
      </nav>

      {/* Active view */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === 'dashboard' && <DashboardView />}
        {tab === 'development' && (
          <DevelopmentView turnStream={turnStream} project={project} onProjectChanged={refreshProject} />
        )}
        {tab === 'issues' && (
          <IssuesAndQuestionsView
            onPushToAgent={async prompt => {
              setTab('development');
              await turnStream.sendTurn(prompt);
            }}
          />
        )}
        {tab === 'parts' && <BomView />}
        {tab === 'work' && <WorkInstructionsView />}
        {tab === 'twin' && <DigitalTwinView />}
        {tab === 'settings' && <SettingsView onSaved={refreshProject} />}
      </main>
    </div>
  );
}
