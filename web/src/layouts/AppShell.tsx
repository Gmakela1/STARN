import { useEffect, useState } from 'react';
import {
  Bot,
  LayoutDashboard,
  Compass,
  Wrench,
  FolderArchive,
  PackageSearch,
  MessageSquareWarning,
  Box,
  Settings as SettingsIcon,
  Satellite,
  CircleAlert,
  Menu,
  X
} from 'lucide-react';
import { api } from '../api/client';
import { ProjectInfo } from '../types/api';
import { useTurnStream } from '../api/useTurnStream';
import DashboardView from '../views/DashboardView';
import RoadmapView from '../views/RoadmapView';
import DevelopmentView from '../views/DevelopmentView';
import PartsView from '../views/PartsView';
import WorkInstructionsView from '../views/WorkInstructionsView';
import IssuesAndQuestionsView from '../views/IssuesAndQuestionsView';
import DigitalTwinView from '../views/DigitalTwinView';
import LibraryView from '../views/LibraryView';
import SettingsView from '../views/SettingsView';

export type TabId = 'dashboard' | 'roadmap' | 'development' | 'build' | 'vault';
export type BuildSubTab = 'parts' | 'work' | 'issues';
export type VaultSubTab = 'library' | 'twin' | 'settings';

export interface HubNav {
  id: TabId;
  label: string;
  tagline: string;
  icon: typeof LayoutDashboard;
}

const HUBS: HubNav[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    tagline: 'Mission Overview & Charter',
    icon: LayoutDashboard
  },
  {
    id: 'roadmap',
    label: 'Roadmap',
    tagline: '13-Stage Build Journey',
    icon: Compass
  },
  {
    id: 'development',
    label: 'Engineering Studio',
    tagline: 'Collaborative AI Workbench',
    icon: Bot
  },
  {
    id: 'build',
    label: 'Materials & Build',
    tagline: 'Shopping List, Shop Instructions & Issues',
    icon: Wrench
  },
  {
    id: 'vault',
    label: 'Vault & Settings',
    tagline: 'Reference Manuals, 3D Twin & Config',
    icon: FolderArchive
  }
];

const BUILD_SUB_TABS: Array<{ id: BuildSubTab; label: string; icon: typeof PackageSearch }> = [
  { id: 'parts', label: 'Shopping List & BOM', icon: PackageSearch },
  { id: 'work', label: 'Work Instructions (Shop Mode)', icon: Wrench },
  { id: 'issues', label: 'Workshop Issues & Questions', icon: MessageSquareWarning }
];

const VAULT_SUB_TABS: Array<{ id: VaultSubTab; label: string; icon: typeof FolderArchive }> = [
  { id: 'library', label: 'Technical Library', icon: FolderArchive },
  { id: 'twin', label: '3D Digital Twin', icon: Box },
  { id: 'settings', label: 'Project & AI Settings', icon: SettingsIcon }
];

export default function AppShell() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [buildSubTab, setBuildSubTab] = useState<BuildSubTab>('parts');
  const [vaultSubTab, setVaultSubTab] = useState<VaultSubTab>('library');
  const [studioPhase, setStudioPhase] = useState<string | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [connected, setConnected] = useState(true);
  const [projectRevision, setProjectRevision] = useState(0);
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

  // Close mobile drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  const handleSelectPhase = (phaseId: string) => {
    setStudioPhase(phaseId);
    setTab('development');
  };

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-2.5 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile hamburger button (< 1024px) */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(prev => !prev)}
            className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors lg:hidden shrink-0"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>

          {/* Brand & Project Info */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-950/60 border border-cyan-500/30">
              <Satellite className="h-5 w-5 text-cyan-400" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-xs font-black tracking-widest text-white uppercase leading-tight">STARN</h1>
              <p
                className="text-xs font-medium text-slate-300 truncate max-w-[160px] sm:max-w-xs md:max-w-sm leading-tight"
                title={project?.name}
              >
                {project ? project.name : 'Connecting to project…'}
              </p>
            </div>
          </div>
        </div>

        {/* Header Telemetry Badges */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Stage Badge */}
          {project && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-950/50 px-3 py-1 text-xs font-semibold text-cyan-300 shadow-sm"
              title={`Active Project Stage: ${project.activePhase}`}
            >
              <span className="text-cyan-400/80 font-normal hidden sm:inline">Stage:</span>
              <span className="font-mono tracking-wide uppercase">{project.activePhase}</span>
            </span>
          )}

          {/* Reconnecting Badge */}
          {!connected && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-700/80 bg-rose-950/80 px-3 py-1 text-xs font-semibold text-rose-300"
              role="status"
            >
              <CircleAlert className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Reconnecting…</span>
            </span>
          )}

          {/* Agent Status Badge */}
          {turnStream.busy ? (
            <span
              className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-950/70 px-3 py-1 text-xs font-semibold text-cyan-300 shadow-sm"
              role="status"
            >
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" aria-hidden />
              <span>Working…</span>
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/50 px-3 py-1 text-xs font-semibold text-emerald-300 shadow-sm"
              role="status"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
              <span className="hidden xs:inline sm:inline">AI Ready</span>
            </span>
          )}
        </div>
      </header>

      {/* Mobile Navigation Drawer (< 1024px) */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-lg lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation Drawer"
        >
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Satellite className="h-6 w-6 text-cyan-400" aria-hidden />
              <div>
                <span className="text-sm font-black tracking-widest text-white uppercase">STARN</span>
                {project && (
                  <p className="text-[11px] text-slate-400 truncate max-w-[220px]">
                    {project.name}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
              aria-label="Close navigation menu"
            >
              <X className="h-6 w-6" aria-hidden />
            </button>
          </div>

          {/* Drawer Links */}
          <nav className="flex-1 overflow-y-auto p-4 space-y-2" aria-label="Mobile Maker Hubs">
            {HUBS.map(({ id, label, tagline, icon: Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTab(id);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex min-h-[48px] w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left transition-colors ${
                    active
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold shadow-sm'
                      : 'bg-slate-900/60 text-slate-300 hover:bg-slate-800 border border-slate-800/80 active:bg-slate-800/90'
                  }`}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-cyan-400' : 'text-slate-400'}`} aria-hidden />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold leading-tight">{label}</div>
                    <div className="text-xs text-slate-400 leading-tight mt-0.5 truncate">{tagline}</div>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Drawer Footer */}
          <div className="border-t border-slate-800 p-4 space-y-2 bg-slate-900/40">
            {project && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Current Phase:</span>
                <span className="font-mono font-bold text-cyan-300 uppercase rounded bg-cyan-950/60 px-2.5 py-0.5 border border-cyan-500/30">
                  {project.activePhase}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">AI Assistant:</span>
              <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                {turnStream.busy ? 'Working…' : 'Ready'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Primary Maker Hub Navigation (Desktop lg+) */}
      <nav
        className="hidden lg:flex items-center gap-1.5 border-b border-slate-800 bg-slate-900/50 px-4 py-2 shrink-0"
        role="tablist"
        aria-label="Maker Lifecycle Hubs"
      >
        {HUBS.map(({ id, label, tagline, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`group flex items-center gap-2.5 rounded-xl px-4 py-2 text-xs xl:text-sm font-medium transition-all ${
                active
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent'
              }`}
              title={tagline}
            >
              <Icon
                className={`h-4 w-4 shrink-0 transition-colors ${
                  active ? 'text-cyan-400' : 'text-slate-400 group-hover:text-slate-200'
                }`}
                aria-hidden
              />
              <div className="flex flex-col text-left">
                <span className="font-bold leading-tight">{label}</span>
                <span className="hidden xl:block text-[10px] font-normal text-slate-500 group-hover:text-slate-400 leading-tight">
                  {tagline}
                </span>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Active Hub View */}
      <main key={projectRevision} className="min-h-0 flex-1 overflow-hidden">
        {tab === 'dashboard' && <DashboardView onNavigate={(t) => setTab(t as TabId)} />}

        {tab === 'roadmap' && <RoadmapView onSelectPhase={handleSelectPhase} />}

        {tab === 'development' && (
          <DevelopmentView
            turnStream={turnStream}
            project={project}
            onProjectChanged={refreshProject}
            initialPhase={studioPhase}
          />
        )}

        {tab === 'build' && (
          <div className="flex h-full flex-col">
            {/* Build Sub-Navigation Bar */}
            <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-2 backdrop-blur overflow-x-auto shrink-0">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mr-1 shrink-0">
                Floor:
              </span>
              <div className="flex items-center gap-2">
                {BUILD_SUB_TABS.map(({ id, label, icon: SubIcon }) => {
                  const active = buildSubTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setBuildSubTab(id)}
                      className={`flex min-h-[36px] items-center gap-2 rounded-full px-3.5 py-1 text-xs font-medium transition-all whitespace-nowrap ${
                        active
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm font-semibold'
                          : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-700/50'
                      }`}
                    >
                      <SubIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Build Sub-Views */}
            <div className="min-h-0 flex-1 overflow-hidden">
              {buildSubTab === 'parts' && <PartsView />}
              {buildSubTab === 'work' && <WorkInstructionsView />}
              {buildSubTab === 'issues' && (
                <IssuesAndQuestionsView
                  onPushToAgent={async prompt => {
                    setTab('development');
                    await turnStream.sendTurn(prompt);
                  }}
                />
              )}
            </div>
          </div>
        )}

        {tab === 'vault' && (
          <div className="flex h-full flex-col">
            {/* Vault Sub-Navigation Bar */}
            <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-2 backdrop-blur overflow-x-auto shrink-0">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mr-1 shrink-0">
                Vault:
              </span>
              <div className="flex items-center gap-2">
                {VAULT_SUB_TABS.map(({ id, label, icon: SubIcon }) => {
                  const active = vaultSubTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setVaultSubTab(id)}
                      className={`flex min-h-[36px] items-center gap-2 rounded-full px-3.5 py-1 text-xs font-medium transition-all whitespace-nowrap ${
                        active
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm font-semibold'
                          : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-700/50'
                      }`}
                    >
                      <SubIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vault Sub-Views */}
            <div className="min-h-0 flex-1 overflow-hidden">
              {vaultSubTab === 'library' && <LibraryView />}
              {vaultSubTab === 'twin' && <DigitalTwinView />}
              {vaultSubTab === 'settings' && (
                <SettingsView
                  onSaved={refreshProject}
                  onProjectSwitched={async () => {
                    setProjectRevision(r => r + 1);
                    await refreshProject();
                  }}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
