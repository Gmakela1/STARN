import { useEffect, useState } from 'react';
import {
  Box,
  FolderArchive,
  MessageSquareWarning,
  PackageSearch,
  Satellite,
  Settings as SettingsIcon,
  Wrench,
  X
} from 'lucide-react';
import { api } from '../api/client';
import { AutopilotStatusResponse, ProjectInfo, RoadmapPhase } from '../types/api';
import { useTurnStream } from '../api/useTurnStream';
import { TopBar, HUBS } from '../components/TopBar';
import type { TabId } from '../components/TopBar';
import { deriveRunState } from '../lib/runState';
import DashboardView from '../views/DashboardView';
import RoadmapView from '../views/RoadmapView';
import DevelopmentView from '../views/DevelopmentView';
import PartsView from '../views/PartsView';
import WorkInstructionsView from '../views/WorkInstructionsView';
import IssuesAndQuestionsView from '../views/IssuesAndQuestionsView';
import DigitalTwinView from '../views/DigitalTwinView';
import LibraryView from '../views/LibraryView';
import SettingsView from '../views/SettingsView';

export type BuildSubTab = 'parts' | 'work' | 'issues';
export type VaultSubTab = 'library' | 'twin' | 'settings';

const BUILD_SUB_TABS: Array<{ id: BuildSubTab; label: string; icon: typeof PackageSearch }> = [
  { id: 'parts', label: 'Shopping List & BOM', icon: PackageSearch },
  { id: 'work', label: 'Work Instructions (Shop Mode)', icon: Wrench },
  { id: 'issues', label: 'Shop Floor Flags', icon: MessageSquareWarning }
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
  const [studioQuestionId, setStudioQuestionId] = useState<string | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [connected, setConnected] = useState(true);
  const [projectRevision, setProjectRevision] = useState(0);
  const [runStatus, setRunStatus] = useState<AutopilotStatusResponse | null>(null);
  const [openQuestions, setOpenQuestions] = useState(0);
  const [roadmap, setRoadmap] = useState<RoadmapPhase[]>([]);
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

  // Coarse run-state snapshot (design BC-1): a REST poll, not a second SSE.
  // Runs parallel to fetchProject; a failure of one never kills the other.
  const refreshRunStatus = async () => {
    const [statusResult, portalResult] = await Promise.allSettled([
      api.fetchAutopilotStatus(),
      api.fetchPortalItems({ status: 'open' })
    ]);
    if (statusResult.status === 'fulfilled') setRunStatus(statusResult.value);
    if (portalResult.status === 'fulfilled') setOpenQuestions(portalResult.value.items.length);
  };

  const refreshRoadmap = async () => {
    try {
      const data = await api.fetchRoadmap();
      setRoadmap(data);
    } catch {
      // Silently ignore — roadmap will be empty if unavailable.
    }
  };

  useEffect(() => {
    void refreshProject();
    void refreshRunStatus();
    void refreshRoadmap();
    // Restore a pending checkpoint after a page reload / reconnect.
    api.fetchPendingCheckpoint()
      .then(cp => {
        if (cp) turnStream.restoreCheckpoint(cp);
      })
      .catch(() => undefined);
    // One 15s poll cycle drives both the project and the run-state snapshot.
    const interval = setInterval(() => {
      void refreshProject();
      void refreshRunStatus();
      void refreshRoadmap();
    }, 15000);
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

  // Design §5.E: Dashboard needs-input rows deep-link into the studio with the
  // question active. The id is handed to DevelopmentView (consumed once).
  const handleOpenQuestion = (id: string) => {
    setStudioQuestionId(id);
    setTab('development');
  };

  // Design §5.E: clear the deep-link when leaving the studio so navigating
  // back without a fresh question focus never re-triggers the one-shot effect.
  useEffect(() => {
    if (tab !== 'development') setStudioQuestionId(undefined);
  }, [tab]);

  const runState = deriveRunState({
    busy: turnStream.busy,
    checkpoint: turnStream.checkpoint !== null,
    autopilotRunning: runStatus?.running ?? false,
    openQuestions,
    blocks: runStatus?.blocks ?? 0,
    lastError: turnStream.error ?? null,
    passedCount: runStatus?.passedCount ?? 0
  });

  const parkedCount = runStatus?.blocks ?? 0;
  let runDetail: string | undefined;
  let runDetailTitle: string | undefined;
  if (parkedCount > 0) {
    runDetail = `${parkedCount} document${parkedCount > 1 ? 's' : ''} parked`;
    runDetailTitle = 'Autopilot parked these documents for your review';
  } else if (turnStream.error) {
    runDetail = 'Last request failed';
    runDetailTitle = turnStream.error;
  }

  return (
    <div className="flex h-full flex-col star-field bg-[#05070c] text-[#e8edf5]">
      {/* Merged top bar — brand · tabs · run-state cluster */}
      <TopBar
        project={project}
        tab={tab}
        onSelectTab={setTab}
        runState={runState}
        runDetail={runDetail}
        runDetailTitle={runDetailTitle}
        connected={connected}
        openQuestions={openQuestions}
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen(prev => !prev)}
        progressPhases={roadmap}
        progressDocStatus={runStatus?.docStatus ?? {}}
        progressTotalPhases={runStatus?.totalPhases ?? 13}
        onNavigateToDashboard={() => setTab('dashboard')}
      />

      {/* Mobile Navigation Drawer (< 1024px) */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-[#05070c]/95 backdrop-blur-lg lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation Drawer"
        >
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-[#2a3342] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Satellite className="h-6 w-6 text-[#ff2a3c]" aria-hidden />
              <div>
                <span className="text-sm font-black tracking-widest text-white uppercase">STARN</span>
                {project && (
                  <p className="text-[11px] text-[#a8b3c4] truncate max-w-[220px]">
                    {project.name}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-[#3b4658] bg-[#11151d] text-[#a8b3c4] hover:bg-[#171c26] hover:text-white"
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
                      ? 'cut-corner-sm bg-[#1a0208] text-[#ffb3bd] border border-[#ff2a3c]/45 font-semibold shadow-sm'
                      : 'bg-[#0d1017]/70 text-[#a8b3c4] hover:bg-[#11151d] border border-[#2a3342]/80 active:bg-[#11151d]/90'
                  }`}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-[#ff2a3c]' : 'text-[#a8b3c4]'}`} aria-hidden />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold leading-tight">{label}</div>
                    <div className="text-xs text-[#a8b3c4] leading-tight mt-0.5 truncate">{tagline}</div>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Drawer Footer */}
          <div className="border-t border-[#2a3342] p-4 space-y-2 bg-[#0d1017]/70">
            {project && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#a8b3c4]">Current Phase:</span>
                <span className="font-mono font-bold text-[#f0c060] uppercase rounded bg-[#11151d] px-2.5 py-0.5 border border-[#d9a441]/40">
                  {project.activePhase}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#a8b3c4]">AI Assistant:</span>
              <span className="font-semibold text-[#c4b5fd] flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#a78bfa]" />
                {turnStream.busy ? 'Working…' : 'Ready'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Active Hub View */}
      <main key={projectRevision} className="relative z-10 min-h-0 flex-1 overflow-hidden">
        {tab === 'dashboard' && (
          <DashboardView onNavigate={(t) => setTab(t as TabId)} onOpenQuestion={handleOpenQuestion} />
        )}

        {tab === 'roadmap' && <RoadmapView onSelectPhase={handleSelectPhase} />}

        {tab === 'development' && (
          <DevelopmentView
            turnStream={turnStream}
            project={project}
            onProjectChanged={refreshProject}
            initialPhase={studioPhase}
            initialQuestionId={studioQuestionId}
            // Workstream C/D: state-based return path to the queue (design BC-5).
            onNavigate={(t) => setTab(t as TabId)}
          />
        )}

        {tab === 'build' && (
          <div className="flex h-full flex-col">
            {/* Build Sub-Navigation Bar */}
            <div className="flex items-center gap-2 border-b border-[#2a3342] bg-[#0d1017]/70 px-4 py-2 backdrop-blur overflow-x-auto shrink-0">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#6e7d92] mr-1 shrink-0">
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
                          ? 'bg-[#1a0208] text-[#ffb3bd] border border-[#ff2a3c]/45 shadow-sm font-semibold'
                          : 'bg-[#11151d]/60 text-[#a8b3c4] hover:bg-[#11151d] hover:text-[#e8edf5] border border-[#3b4658]/50'
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
            <div className="flex items-center gap-2 border-b border-[#2a3342] bg-[#0d1017]/70 px-4 py-2 backdrop-blur overflow-x-auto shrink-0">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#6e7d92] mr-1 shrink-0">
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
                          ? 'bg-[#1a0208] text-[#ffb3bd] border border-[#ff2a3c]/45 shadow-sm font-semibold'
                          : 'bg-[#11151d]/60 text-[#a8b3c4] hover:bg-[#11151d] hover:text-[#e8edf5] border border-[#3b4658]/50'
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
