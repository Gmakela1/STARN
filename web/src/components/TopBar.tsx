import {
  Bot,
  CircleAlert,
  Compass,
  FolderArchive,
  LayoutDashboard,
  Menu,
  Satellite,
  Wrench,
  X
} from 'lucide-react';
import type { ProjectInfo, RoadmapPhase } from '../types/api';
import type { RunState } from '../lib/runState';
import DocProgressBar from './DocProgressBar';
import RunStateCluster from './RunStateCluster';

/**
 * Merged single top bar (design §5.G + §5.E + §5.H).
 * ONE 56px header: brand + project (left) · nav tabs (middle) · run-state
 * cluster (right). The cluster is shrink-0 and never enters the overflow
 * region; below `lg` the tablist moves to the mobile drawer (unchanged).
 */

export type TabId = 'dashboard' | 'roadmap' | 'development' | 'build' | 'vault';

export interface HubNav {
  id: TabId;
  label: string;
  tagline: string;
  icon: typeof LayoutDashboard;
}

export const HUBS: HubNav[] = [
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

export interface TopBarProps {
  project: ProjectInfo | null;
  tab: TabId;
  onSelectTab: (t: TabId) => void;
  runState: RunState;
  phase?: string;
  step?: string | null;
  /** Failed-state explanation shown instead of the generic word. */
  runDetail?: string;
  runDetailTitle?: string;
  connected: boolean;
  mobileMenuOpen: boolean;
  onToggleMobileMenu: () => void;
  /** DocProgressBar props — replaces the old openQuestions badge (§5.E). */
  progressPhases: RoadmapPhase[];
  progressDocStatus: Record<string, string>;
  progressTotalPhases: number;
  onNavigateToDashboard: () => void;
}

export function TopBar({
  project,
  tab,
  onSelectTab,
  runState,
  phase,
  step,
  runDetail,
  runDetailTitle,
  connected,
  mobileMenuOpen,
  onToggleMobileMenu,
  progressPhases,
  progressDocStatus,
  progressTotalPhases,
  onNavigateToDashboard
}: TopBarProps) {
  // The cluster already shows `phase`; only show the project stage pill when it differs.
  const activePhase = project?.activePhase;
  const showActivePhase = Boolean(activePhase) && activePhase !== phase;

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 backdrop-blur-md">
      {/* Left — hamburger (< lg) + brand + project */}
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors lg:hidden shrink-0"
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>

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

      {/* Middle — nav tabs (hidden below lg, icon-only below xl) */}
      <div
        role="tablist"
        aria-label="Maker Lifecycle Hubs"
        className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden lg:flex"
      >
        {HUBS.map(({ id, label, tagline, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectTab(id)}
              title={tagline}
              aria-label={`${label} — ${tagline}`}
              className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all xl:text-sm ${
                active
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 transition-colors ${
                  active ? 'text-cyan-400' : 'text-slate-400 group-hover:text-slate-200'
                }`}
                aria-hidden
              />
              <span className="hidden xl:inline font-bold leading-tight whitespace-nowrap">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Right — DocProgressBar + run-state cluster + active phase + connection (always visible) */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <DocProgressBar
          phases={progressPhases}
          docStatus={progressDocStatus}
          totalPhases={progressTotalPhases}
          onNavigateToDashboard={onNavigateToDashboard}
        />
        <RunStateCluster
          runState={runState}
          phase={phase}
          step={step}
          detail={runDetail}
          detailTitle={runDetailTitle}
        />

        {showActivePhase && (
          <span
            className="inline-flex items-center rounded-full border border-cyan-500/40 bg-cyan-950/50 px-3 py-1 text-xs font-semibold text-cyan-300 shadow-sm"
            title={`Active Project Stage: ${activePhase}`}
          >
            <span className="font-mono tracking-wide uppercase">{activePhase}</span>
          </span>
        )}

        {!connected && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-700/80 bg-rose-950/80 px-3 py-1 text-xs font-semibold text-rose-300"
            role="status"
          >
            <CircleAlert className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Reconnecting…</span>
          </span>
        )}
      </div>
    </header>
  );
}

export default TopBar;
