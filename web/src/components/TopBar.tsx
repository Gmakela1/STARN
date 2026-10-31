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
import StarBorder from './reactbits/StarBorder';
import type { RunState } from '../lib/runState';
import DocProgressBar from './DocProgressBar';
import RunStateCluster from './RunStateCluster';
// React Bits (reactbits.dev) decorative text effect — see web/src/components/reactbits.
import ShinyText from './reactbits/ShinyText';

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
  /** Failed-state explanation shown instead of the generic word. */
  runDetail?: string;
  runDetailTitle?: string;
  connected: boolean;
  /** Open question count — drives the Engineering Studio tab pill (§5.E). Separate from progress props. */
  openQuestions: number;
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
  runDetail,
  runDetailTitle,
  connected,
  openQuestions,
  mobileMenuOpen,
  onToggleMobileMenu,
  progressPhases,
  progressDocStatus,
  progressTotalPhases,
  onNavigateToDashboard
}: TopBarProps) {
  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-[#2a3342] bg-[#0d1017]/85 px-4 backdrop-blur-md">
      {/* Left — hamburger (< lg) + brand + project */}
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-[#3b4658] bg-[#11151d] text-[#a8b3c4] hover:bg-[#171c26] hover:text-white transition-colors lg:hidden shrink-0"
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#1a0208] border border-[#ff2a3c]/40">
            <Satellite className="h-4 w-4 text-[#ff2a3c]" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-[11px] font-black tracking-widest text-white uppercase leading-tight">
              <ShinyText text="STARN" color="#e8edf5" shineColor="#ffb3bd" speed={4} trigger="loop" />
            </h1>
            <p
              className="text-[11px] font-medium text-[#a8b3c4] truncate max-w-[120px] xl:max-w-[200px] leading-tight"
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
        className="hidden min-w-0 flex-1 items-center gap-1 lg:flex"
      >
        {HUBS.map(({ id, label, tagline, icon: Icon }) => {
          const active = tab === id;
          const badgeVisible = id === 'development' && openQuestions > 0;
          const tabButton = (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectTab(id)}
              title={tagline}
              aria-label={badgeVisible ? `${label}, ${openQuestions} needs input` : `${label} — ${tagline}`}
              className={`group flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-medium transition-all ${
                active
                  ? 'cut-corner-sm bg-[#1a0208] text-[#ffb3bd] border border-[#ff2a3c]/45 shadow-sm'
                  : 'text-[#a8b3c4] hover:bg-[#11151d]/60 hover:text-[#e8edf5] border border-transparent'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 transition-colors ${
                  active ? 'text-[#ff2a3c]' : 'text-[#a8b3c4] group-hover:text-[#e8edf5]'
                }`}
                aria-hidden
              />
              <span className="hidden xl:inline font-bold leading-tight whitespace-nowrap">{label}</span>
              {badgeVisible && (
                <span
                  className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 text-[10px] font-bold text-amber-300"
                  aria-hidden
                >
                  {openQuestions > 99 ? '99+' : openQuestions}
                </span>
              )}
            </button>
          );
          if (!active) return tabButton;
          // Active tab wears a StarBorder pill (ambient cap §3: one canvas,
          // only one tab active at a time). Div wrapper keeps the button the
          // sole interactive element; canvas is aria-hidden decoration.
          return (
            <StarBorder
              key={id}
              as="div"
              thickness={1}
              duration={10}
              color="#ff2a3c"
              trailColor="#d9a441"
              glow={0.4}
              radius={8}
              clickPulse={false}
              className="shrink-0 rounded-xl"
              style={{ padding: 0, background: 'transparent' }}
            >
              {tabButton}
            </StarBorder>
          );
        })}
      </div>

      {/* Right — DocProgressBar + run-state cluster + connection (always visible) */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <DocProgressBar
          phases={progressPhases}
          docStatus={progressDocStatus}
          totalPhases={progressTotalPhases}
          onNavigateToDashboard={onNavigateToDashboard}
        />
        <RunStateCluster runState={runState} detail={runDetail} detailTitle={runDetailTitle} />

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
