import { useEffect, useState } from 'react';
import {
  Wallet,
  Receipt,
  TrendingUp,
  TrendingDown,
  PackageCheck,
  Loader2,
  RefreshCw,
  FileText
} from 'lucide-react';
import { api } from '../api/client';
import { DashboardData } from '../types/api';
import TreasureMapRoadmap from '../components/TreasureMapRoadmap';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Project Overview / White Paper Card */}
        <section aria-label="Project overview" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="rounded bg-sky-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-sky-300 border border-sky-500/30">
                  SYSTEM OVERVIEW
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                  Gate: [{project.activePhase.toUpperCase()}]
                </span>
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight">{project.name}</h1>
              <p className="text-xs text-slate-300 leading-relaxed">
                {project.summary || 'Hardware engineering program governed by rigorous specialist phase-gates.'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
              <button
                id="export-briefing-btn"
                onClick={() => {
                  const event = new CustomEvent('open-executive-briefing');
                  window.dispatchEvent(event);
                }}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 px-4 text-xs font-bold text-white shadow-md hover:from-sky-500 hover:to-indigo-500 transition-all"
              >
                <FileText className="h-4 w-4" />
                Export 2-Page Executive Briefing
              </button>
            </div>
          </div>
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

        {/* Serpentine Treasure Map Roadmap */}
        <section aria-label="Milestone trail">
          <TreasureMapRoadmap roadmap={roadmap} />
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
    </div>
  );
}
