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
  ChevronDown
} from 'lucide-react';
import { api } from '../api/client';
import { DashboardData } from '../types/api';
import ExecutiveBriefingModal from '../components/ExecutiveBriefingModal';
import Markdown from '../components/Markdown';
import { PHASE_SUBTITLES } from '../components/roadmapMeta';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function DashboardView({ onNavigate }: { onNavigate?: (tab: string) => void }) {
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
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500" role="status">
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
          className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-700 px-4 text-sm text-slate-300 hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" aria-hidden /> Retry
        </button>
      </div>
    );
  }

  if (!data) return null;
  const { project, roadmap, issues } = data;
  const fin = project.financials;
  const varianceOver = fin.netVariance > 0;
  const activePhaseId = project.activePhase;
  const completed = roadmap.filter(p => p.status === 'COMPLETED').length;
  const activePhase = roadmap.find(p => p.id === activePhaseId)
    ?? roadmap.find(p => p.status === 'IN_PROGRESS')
    ?? roadmap[0];
  const activeIdx = roadmap.indexOf(activePhase);
  const nextMilestone = roadmap[Math.min(activeIdx + 1, roadmap.length - 1)];

  const extractLede = (text: string): string => {
    const trimmed = text.trim();
    const match = trimmed.match(/^([^.!?]*[.!?])\s/);
    if (match && match[1].length >= 40) return match[1];
    return trimmed.length > 140 ? trimmed.slice(0, trimmed.lastIndexOf(' ', 140)) + '…' : trimmed;
  };

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Project Overview / Charter Card */}
        <section aria-label="Project overview and charter" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5 flex-1 min-w-[280px]">
              <div className="flex items-center gap-2">
                <span className="rounded bg-sky-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-sky-300 border border-sky-500/30">
                  SYSTEM OVERVIEW &amp; CHARTER
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                  Gate: [{project.activePhase.toUpperCase()}]
                </span>
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight">{project.name}</h1>
            </div>

            <div className="flex items-center gap-3">
              <button
                id="export-briefing-btn"
                onClick={() => setShowBriefingModal(true)}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-cyan-600 px-4 text-xs font-bold text-white shadow-md hover:bg-cyan-500 transition-all cursor-pointer"
              >
                <FileText className="h-4 w-4" />
                Export 2-Page Executive Briefing
              </button>
            </div>
          </div>

          {/* Body: Charter Subsections Grid (if present), or Fallback Prose */}
          {project.charter && project.charter.length > 0 ? (
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-800/80 pt-4">
              {project.charter.map((section, idx) => (
                <div key={idx} className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-sky-400 mb-1.5">
                    {section.heading}
                  </h2>
                  <div className="text-sm leading-relaxed text-slate-200">
                    <Markdown content={section.body} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 pt-3 border-t border-slate-800/80">
              {project.summarySource === 'none' ? (
                <p className="text-sm text-slate-400">
                  No overview yet. Start the CONOPS intake in Development to define the project.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-base md:text-lg font-bold text-white leading-snug max-w-prose">
                    {extractLede(project.summary)}
                  </p>
                  <button
                    onClick={() => setShowFullSummary(!showFullSummary)}
                    className="flex min-h-[44px] items-center gap-1.5 text-xs font-mono font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
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
                    <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">
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
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <Wallet className="h-3.5 w-3.5" aria-hidden /> Estimated budget
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-100">{money(fin.totalEstimated)}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <Receipt className="h-3.5 w-3.5" aria-hidden /> Actual spend
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-100">{money(fin.totalActual)}</p>
          </div>
          <div className={`rounded-xl border p-4 ${varianceOver ? 'border-rose-900/70 bg-rose-950/30' : 'border-emerald-900/70 bg-emerald-950/30'}`}>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {varianceOver ? <TrendingUp className="h-3.5 w-3.5 text-rose-400" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5 text-emerald-400" aria-hidden />}
              Net variance
            </div>
            <p className={`mt-2 text-2xl font-bold ${varianceOver ? 'text-rose-300' : 'text-emerald-300'}`}>
              {varianceOver ? '+' : ''}{money(fin.netVariance)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <PackageCheck className="h-3.5 w-3.5" aria-hidden /> Parts received
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-100">{fin.procurementProgressPercent}%</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden>
              <div className="h-full rounded-full bg-sky-500" style={{ width: `${fin.procurementProgressPercent}%` }} />
            </div>
          </div>
        </section>

        {/* Compact build progress — replaces full TreasureMapRoadmap */}
        <section aria-label="Build progress" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
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
                    ? 'bg-emerald-500'
                    : p.status === 'IN_PROGRESS'
                      ? 'bg-cyan-500 motion-safe:animate-pulse'
                      : p.status === 'PENDING_REVIEW'
                        ? 'bg-amber-500'
                        : 'bg-slate-800'
                }`}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                <Compass className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-bold text-slate-400">
                  PHASE {completed + 1} OF 13 · GATE [{activePhaseId.toUpperCase()}]
                </p>
                {nextMilestone && (
                  <p className="mt-0.5 truncate text-sm text-slate-200">
                    <span className="font-bold text-cyan-300">
                      Next: {nextMilestone.name}
                    </span>
                    <span className="hidden md:inline text-slate-400">
                      {' '}— {PHASE_SUBTITLES[nextMilestone.id] || 'Milestone Deliverable'}
                    </span>
                  </p>
                )}
              </div>
            </div>
            {onNavigate && (
              <button
                onClick={() => onNavigate('roadmap')}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors min-h-[44px]"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                Full Roadmap
                <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
        </section>

        {/* Issues snapshot */}
        <section aria-label="Open issues snapshot" className="rounded-xl border border-slate-800 bg-slate-900/40">
          <header className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-200">Open Issues & Questions</h2>
          </header>
          {issues.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              No open non-conformances or builder questions. 🎉
            </p>
          ) : (
            <ul className="divide-y divide-slate-800/70">
              {issues.slice(0, 6).map(issue => (
                <li key={issue.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                      issue.type === 'non_conformance'
                        ? 'bg-rose-950/70 text-rose-300'
                        : 'bg-amber-950/70 text-amber-300'
                    }`}
                  >
                    {issue.type === 'non_conformance' ? 'Defect' : 'Question'}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm text-slate-300">{issue.title}</p>
                  <span className="font-mono text-[11px] text-slate-500">{issue.source}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* 2-Page Executive Briefing Modal */}
      {showBriefingModal && (
        <ExecutiveBriefingModal data={data} onClose={() => setShowBriefingModal(false)} />
      )}
    </div>
  );
}
