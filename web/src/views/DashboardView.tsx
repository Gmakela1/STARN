import { useEffect, useState } from 'react';
import {
  Wallet,
  Receipt,
  TrendingUp,
  TrendingDown,
  PackageCheck,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Lock,
  FileClock,
  Loader2,
  MessageSquareWarning,
  RefreshCw
} from 'lucide-react';
import { api } from '../api/client';
import { DashboardData, RoadmapPhase } from '../types/api';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function PhaseStatusIcon({ status }: { status: RoadmapPhase['status'] }) {
  switch (status) {
    case 'COMPLETED':
      return <CircleCheck className="h-4 w-4 text-emerald-400" aria-hidden />;
    case 'IN_PROGRESS':
      return <CircleDot className="h-4 w-4 animate-pulse text-sky-400" aria-hidden />;
    case 'PENDING_REVIEW':
      return <FileClock className="h-4 w-4 text-amber-400" aria-hidden />;
    case 'LOCKED':
      return <Lock className="h-4 w-4 text-slate-600" aria-hidden />;
    default:
      return <CircleDashed className="h-4 w-4 text-slate-600" aria-hidden />;
  }
}

const STATUS_LABEL: Record<RoadmapPhase['status'], { label: string; tone: string }> = {
  COMPLETED: { label: 'Approved', tone: 'text-emerald-300' },
  IN_PROGRESS: { label: 'In progress', tone: 'text-sky-300' },
  PENDING_REVIEW: { label: 'Draft on disk', tone: 'text-amber-300' },
  PENDING: { label: 'Pending', tone: 'text-slate-500' },
  LOCKED: { label: 'Locked', tone: 'text-slate-600' }
};

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
  const approvedCount = roadmap.filter(p => p.status === 'COMPLETED').length;
  const varianceOver = fin.netVariance > 0;

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
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

        {/* Roadmap */}
        <section aria-label="Program roadmap" className="rounded-xl border border-slate-800 bg-slate-900/40">
          <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-200">Program Roadmap</h2>
            <span className="text-xs text-slate-400">
              <span className="font-semibold text-emerald-300">{approvedCount}</span> / {roadmap.length} phases approved
            </span>
          </header>
          <ol className="divide-y divide-slate-800/70">
            {roadmap.map((phase, idx) => (
              <li key={phase.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-5 text-right font-mono text-[11px] text-slate-500">{idx + 1}</span>
                <PhaseStatusIcon status={phase.status} />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-medium ${phase.status === 'LOCKED' ? 'text-slate-600' : 'text-slate-200'}`}>
                    {phase.name}
                  </p>
                  <p className="truncate font-mono text-[11px] text-slate-500">{phase.artifactPath}</p>
                </div>
                {phase.openQuestions > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-amber-950/70 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                    <MessageSquareWarning className="h-3 w-3" aria-hidden />
                    {phase.openQuestions} open
                  </span>
                )}
                {phase.criticScore !== undefined && (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
                    Critic {phase.criticScore.toFixed(1)}
                  </span>
                )}
                <span className={`w-24 text-right text-[11px] font-medium ${STATUS_LABEL[phase.status].tone}`}>
                  {STATUS_LABEL[phase.status].label}
                </span>
              </li>
            ))}
          </ol>
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
