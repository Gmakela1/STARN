import { useEffect, useState } from 'react';
import {
  Wallet,
  Receipt,
  TrendingUp,
  TrendingDown,
  PackageCheck,
  Loader2,
  RefreshCw,
  FileText,
  Compass,
  MapPin,
  ArrowRight,
  ChevronDown,
  CircleAlert,
  AlertTriangle,
  MessageSquare,
  Flag
} from 'lucide-react';
import { api } from '../api/client';
import { DashboardData, PortalItem } from '../types/api';
import ExecutiveBriefingModal from '../components/ExecutiveBriefingModal';
import Markdown from '../components/Markdown';
import { PHASE_SUBTITLES } from '../components/roadmapMeta';
// React Bits (reactbits.dev) decorative effects — see web/src/components/reactbits.
import Galaxy from '../components/reactbits/Galaxy';
import ShinyText from '../components/reactbits/ShinyText';
import StartAutopilotButton from '../components/StartAutopilotButton';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Design §5.E: relative timestamp from an ISO-8601 string (pure, no dep). */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Basename of a docPath without pulling in node:path in the browser bundle. */
function fileBase(p: string): string {
  const segs = p.split('/');
  return segs[segs.length - 1] || p;
}

/**
 * Design §5.E J/K row navigation: move focus between the row buttons of one
 * tier. Guarded so J/K never fires while typing in an input/textarea or a
 * contenteditable (e.g. the question-panel composer).
 */
function handleRowKeydown(e: React.KeyboardEvent<HTMLDivElement>): void {
  const target = e.target as HTMLElement;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
  const key = e.key.toLowerCase();
  if (key !== 'j' && key !== 'k') return;
  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
  if (buttons.length === 0) return;
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (key === 'j') {
    if (current + 1 < buttons.length) {
      e.preventDefault();
      buttons[current + 1].focus();
    }
  } else if (current > 0) {
    e.preventDefault();
    buttons[current - 1].focus();
  }
}

export default function DashboardView({
  onNavigate,
  onOpenQuestion
}: {
  onNavigate?: (tab: string) => void;
  onOpenQuestion?: (id: string) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBriefingModal, setShowBriefingModal] = useState(false);
  const [showFullSummary, setShowFullSummary] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.fetchDashboard());
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[#6e7d92]" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading program status…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-rose-300">{error}</p>
        <button
          onClick={() => void load()}
          className="flex min-h-[44px] items-center gap-2 rounded-lg border border-[#3b4658] px-4 text-sm text-[#a8b3c4] hover:bg-[#11151d]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden /> Retry
        </button>
      </div>
    );
  }

  if (!data) return null;
  const { project, roadmap } = data;
  const fin = project.financials;
  const varianceOver = fin.netVariance > 0;
  const activePhaseId = project.activePhase;
  const completed = roadmap.filter(p => p.status === 'COMPLETED').length;
  const activePhase = roadmap.find(p => p.id === activePhaseId)
    ?? roadmap.find(p => p.status === 'IN_PROGRESS')
    ?? roadmap[0];
  const activeIdx = roadmap.indexOf(activePhase);
  const nextMilestone = roadmap[Math.min(activeIdx + 1, roadmap.length - 1)];

  const renderActionPane = (d: DashboardData): JSX.Element => {
    const ps = d.portalSummary;
    const topItems = ps?.topItems ?? [];
    const shopFloorFlags = d.issues.filter(i => i.type === 'non_conformance');

    if (!ps && d.issues.length === 0) {
      // S9: autopilot OFF → shop-floor only + CTA
      return (
        <div className="space-y-3 p-4">
          <div className="rounded-lg border border-[#2a3342] bg-[#0d1017]/70 p-4 text-center">
            <p className="text-sm text-[#a8b3c4]">
              Start Autopilot to auto-draft all 13 documents.
            </p>
            {/* Real start flow via StartAutopilotButton (board #57): disabled
                while pending, 409 busy surfaced as inline alert, dashboard
                reloaded on success so the pane switches to the live portal. */}
            <div className="mt-3 flex justify-center">
              <StartAutopilotButton
                running={false}
                onStart={async () => {
                  await api.autopilotStart();
                  await load();
                }}
                onStop={async () => {
                  await api.autopilotStop();
                }}
              />
            </div>
          </div>
          {shopFloorFlags.length > 0 && (
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#a8b3c4] px-1">Shop Floor Flags</h3>
              <ul className="divide-y divide-[#2a3342]/70">
                {shopFloorFlags.slice(0, 4).map(issue => (
                  <li key={issue.id} className="flex items-center gap-3 px-1 py-2">
                    <Flag className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <p className="min-w-0 flex-1 truncate text-sm text-[#a8b3c4]">{issue.title}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      );
    }

    // 4-tier ranking: rose blocking → amber parked → violet needs-input → slate shop-floor
    const blockingItems = topItems.filter((i: PortalItem) => i.severity === 'blocking' && i.status === 'open');
    const parkedItems = topItems.filter((i: PortalItem) => i.type === 'parked' && i.status === 'open');
    const questionItems = topItems.filter((i: PortalItem) => i.type === 'question' && i.status === 'open');
    const flagItems = topItems.filter((i: PortalItem) => i.type === 'flag' && i.status === 'open');

    const renderTier = (items: PortalItem[], icon: React.ReactNode, color: string, label: string, route?: string) => {
      if (items.length === 0) return null;
      return (
        <div className="space-y-1">
          <h3 className={`flex items-center gap-1.5 px-1 py-1 text-xs font-bold uppercase tracking-wider ${color}`}>
            {icon}
            {label}
            <span className="ml-auto font-mono text-[11px] font-normal text-[#6e7d92]">{items.length}</span>
          </h3>
          <div role="list" className="divide-y divide-[#2a3342]/70" onKeyDown={handleRowKeydown}>
            {items.slice(0, 4).map(item => (
              <div key={item.id} role="listitem">
                <button
                  type="button"
                  onClick={() => {
                    // Deep-link into the question panel; fall back to the old
                    // tab switch when no handler is wired (pre-Workstream D).
                    if (onOpenQuestion) onOpenQuestion(item.id);
                    else if (route && onNavigate) onNavigate(route);
                  }}
                  className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-[#11151d]/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#ff2a3c]/60"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="text-[11px] font-mono text-[#6e7d92]">
                      STARN · needs input · {item.docPath ? fileBase(item.docPath) : 'unknown'}
                    </div>
                    <div className="truncate text-sm text-[#e8edf5]">{item.title}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 self-center">
                    <span className="text-[11px] text-[#6e7d92] tabular-nums">
                      {relativeTime(item.createdAt)}
                    </span>
                    <ArrowRight className="h-3 w-3 text-[#6e7d92]" aria-hidden />
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-2 p-2">
        {renderTier(blockingItems, <CircleAlert className="h-3.5 w-3.5" aria-hidden />, 'text-rose-300', 'Blocking', 'development')}
        {renderTier(parkedItems, <AlertTriangle className="h-3.5 w-3.5" aria-hidden />, 'text-rose-300', 'Parked', 'development')}
        {renderTier(questionItems, <MessageSquare className="h-3.5 w-3.5" aria-hidden />, 'text-[#ffb3bd]', 'Needs Input', 'development')}
        {renderTier(flagItems, <Flag className="h-3.5 w-3.5" aria-hidden />, 'text-[#a8b3c4]', 'Shop Floor Flags', 'build')}
        {topItems.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-[#6e7d92]">
            All systems nominal. 🎉
          </p>
        )}
      </div>
    );
  };

  const extractLede = (text: string): string => {
    const trimmed = text.trim();
    const match = trimmed.match(/^([^.!?]*[.!?])\s/);
    if (match && match[1].length >= 40) return match[1];
    return trimmed.length > 140 ? trimmed.slice(0, trimmed.lastIndexOf(' ', 140)) + '…' : trimmed;
  };

  return (
    // `isolate` + `relative` create a stacking context so the -z-10 Galaxy
    // layer paints above this root's own background but below all content.
    <div className="relative isolate h-full overflow-y-auto p-4 lg:p-6 bg-[#05070c] text-[#e8edf5]">
      {/* React Bits Galaxy: decorative WebGL starfield, dashboard only.
          pointer-events-none + aria-hidden + mouseInteraction/clickWarp off so
          it never intercepts input; low twinkle + ≤4 layers keeps it calm. */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <Galaxy
          mouseInteraction={false}
          clickWarp={false}
          opacity={0.6}
          twinkleIntensity={0.1}
          layers={3}
          starColors={['#ff2a3c', '#ffb3bd', '#d9a441', '#e8edf5']}
          glowIntensity={0.3}
        />
      </div>
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Project Overview / Charter Card */}
        <section aria-label="Project overview and charter" className="rounded-2xl border border-[#2a3342] bg-[#0d1017]/70 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5 flex-1 min-w-[280px]">
              <div className="flex items-center gap-2">
                <span className="rounded bg-violet-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-violet-300 border border-violet-600/40">
                  SYSTEM OVERVIEW &amp; CHARTER
                </span>
                <span className="rounded bg-[#11151d] px-2 py-0.5 font-mono text-[11px] text-[#a8b3c4]">
                  Gate: [{project.activePhase.toUpperCase()}]
                </span>
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight">
                <ShinyText text={project.name} color="#e8edf5" shineColor="#ffb3bd" speed={4} trigger="loop" />
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <button
                id="export-briefing-btn"
                onClick={() => setShowBriefingModal(true)}
                className="cut-corner flex min-h-[44px] items-center gap-2 rounded-none bg-[#d61f2c] px-4 text-xs font-bold text-white shadow-md hover:bg-[#e11d3f] transition-all cursor-pointer"
              >
                <FileText className="h-4 w-4" />
                Export 2-Page Executive Briefing
              </button>
            </div>
          </div>

          {/* Body: Charter Subsections Grid (if present), or Fallback Prose */}
          {project.charter && project.charter.length > 0 ? (
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-[#2a3342]/80 pt-4">
              {project.charter.map((section, idx) => (
                <div key={idx} className="rounded-xl border border-[#2a3342]/80 bg-[#05070c]/60 p-4">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-violet-400 mb-1.5">
                    {section.heading}
                  </h2>
                  <div className="text-sm leading-relaxed text-[#e8edf5]">
                    <Markdown content={section.body} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 pt-3 border-t border-[#2a3342]/80">
              {project.summarySource === 'none' ? (
                <p className="text-sm text-[#a8b3c4]">
                  No overview yet. Start the CONOPS intake in Development to define the project.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-base md:text-lg font-bold text-white leading-snug max-w-prose">
                    {extractLede(project.summary)}
                  </p>
                  <button
                    onClick={() => setShowFullSummary(!showFullSummary)}
                    className="flex min-h-[44px] items-center gap-1.5 text-xs font-mono font-bold text-[#ff2a3c] hover:text-[#ffb3bd] transition-colors"
                    aria-expanded={showFullSummary}
                    aria-controls="charter-full-text"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${showFullSummary ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                    {showFullSummary ? 'Collapse full charter' : 'Read full charter'}
                  </button>
                  <div
                    id="charter-full-text"
                    className={`overflow-hidden transition-all duration-300 ${
                      showFullSummary ? 'max-h-[999px]' : 'max-h-0'
                    }`}
                  >
                    <p className="whitespace-pre-line text-sm leading-relaxed text-[#e8edf5]">
                      {project.summary}
                    </p>
                  </div>
                  {project.summarySource === 'intake' && (
                    <p className="text-xs text-amber-300 mt-2">Charter pending: showing your intake answer until the CONOPS is drafted.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Financial rollup cards */}
        <section aria-label="Financial rollup" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-[#2a3342] bg-[#0d1017]/70 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#a8b3c4]">
              <Wallet className="h-3.5 w-3.5 text-[#d9a441]" aria-hidden /> Estimated budget
            </div>
            <p className="mt-2 text-2xl font-bold text-[#e8edf5]">{money(fin.totalEstimated)}</p>
          </div>
          <div className="rounded-xl border border-[#2a3342] bg-[#0d1017]/70 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#a8b3c4]">
              <Receipt className="h-3.5 w-3.5 text-[#d9a441]" aria-hidden /> Actual spend
            </div>
            <p className="mt-2 text-2xl font-bold text-[#e8edf5]">{money(fin.totalActual)}</p>
          </div>
          <div className={`rounded-xl border p-4 ${varianceOver ? 'border-rose-900/70 bg-rose-950/30' : 'border-[#35714a]/70 bg-[#0f2318]/30'}`}>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#a8b3c4]">
              {varianceOver ? <TrendingUp className="h-3.5 w-3.5 text-rose-400" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5 text-[#86efac]" aria-hidden />}
              Net variance
            </div>
            <p className={`mt-2 text-2xl font-bold ${varianceOver ? 'text-rose-300' : 'text-[#86efac]'}`}>
              {varianceOver ? '+' : ''}{money(fin.netVariance)}
            </p>
          </div>
          <div className="rounded-xl border border-[#2a3342] bg-[#0d1017]/70 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#a8b3c4]">
              <PackageCheck className="h-3.5 w-3.5 text-[#d9a441]" aria-hidden /> Parts received
            </div>
            <p className="mt-2 text-2xl font-bold text-[#e8edf5]">{fin.procurementProgressPercent}%</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#11151d]" aria-hidden>
              <div className="h-full rounded-full bg-violet-500" style={{ width: `${fin.procurementProgressPercent}%` }} />
            </div>
          </div>
        </section>

        {/* Compact build progress — replaces full TreasureMapRoadmap */}
        <section aria-label="Build progress" className="rounded-2xl border border-[#2a3342] bg-[#0d1017]/70 p-5 backdrop-blur-sm">
          <div
            className="flex items-center gap-[2px]"
            role="progressbar"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={roadmap.length}
            aria-label={`${completed} of ${roadmap.length} milestones complete`}
          >
            {roadmap.slice(0, 13).map(p => (
              <span
                key={p.id}
                title={`${p.name} — ${p.status}`}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  p.status === 'COMPLETED'
                    ? 'bg-[#2c5e3b]'
                    : p.status === 'IN_PROGRESS'
                      ? 'bg-[#ff2a3c] motion-safe:animate-pulse'
                      : p.status === 'PENDING_REVIEW'
                        ? 'bg-amber-500'
                        : 'bg-[#11151d]'
                }`}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1a0208] text-[#ffb3bd] border border-[#ff2a3c]/45">
                <Compass className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-bold text-[#a8b3c4]">
                  PHASE {completed + 1} OF 13 · GATE [{activePhaseId.toUpperCase()}]
                </p>
                {nextMilestone && (
                  <p className="mt-0.5 truncate text-sm text-[#e8edf5]">
                    <span className="font-bold text-[#ffb3bd]">
                      Next: {nextMilestone.name}
                    </span>
                    <span className="hidden md:inline text-[#a8b3c4]">
                      {' '}— {PHASE_SUBTITLES[nextMilestone.id] || 'Milestone Deliverable'}
                    </span>
                  </p>
                )}
              </div>
            </div>
            {onNavigate && (
              <button
                onClick={() => onNavigate('roadmap')}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-[#ffb3bd] bg-[#1a0208] border border-[#ff2a3c]/45 hover:bg-[#1a0208]/70 transition-colors min-h-[44px]"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                Full Roadmap
                <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
        </section>

        {/* S8/S9: Ranked action pane — replaces "Open Issues & Questions" */}
        <section aria-label="Open actions" className="rounded-xl border border-[#2a3342] bg-[#0d1017]/70">
          <header className="border-b border-[#2a3342] px-4 py-3">
            <h2 className="text-sm font-bold text-[#e8edf5]">
              <ShinyText text="Open Actions" color="#e8edf5" shineColor="#ffb3bd" speed={4} trigger="loop" />
              {data.portalSummary && (() => {
                const ps = data.portalSummary!;
                const total = ps.blocking + ps.parked + ps.questions + ps.flags;
                return (
                  <span className="ml-2 text-xs font-normal text-[#a8b3c4]">
                    ({total} ·{' '}
                    {ps.blocking > 0 && <span className="text-rose-300">{ps.blocking} blocking</span>}
                    {ps.blocking > 0 && ps.parked > 0 && <span>, </span>}
                    {ps.parked > 0 && <span className="text-rose-300">{ps.parked} parked</span>}
                    {(ps.blocking > 0 || ps.parked > 0) && ps.questions > 0 && <span>, </span>}
                    {ps.questions > 0 && <span className="text-[#ffb3bd]">{ps.questions} needs input</span>}
                    {(ps.blocking > 0 || ps.parked > 0 || ps.questions > 0) && ps.flags > 0 && <span>, </span>}
                    {ps.flags > 0 && <span className="text-[#a8b3c4]">{ps.flags} flags</span>}
                    )
                  </span>
                );
              })()}
            </h2>
          </header>
          {renderActionPane(data)}
        </section>
      </div>

      {/* 2-Page Executive Briefing Modal */}
      {showBriefingModal && (
        <ExecutiveBriefingModal data={data} onClose={() => setShowBriefingModal(false)} />
      )}
    </div>
  );
}
