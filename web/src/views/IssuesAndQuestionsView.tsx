import { useEffect, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  TriangleAlert,
  MessageCircleQuestion,
  Bot,
  Image as ImageIcon,
  PartyPopper
} from 'lucide-react';
import { api } from '../api/client';
import { IssuesSummary, ProjectIssue } from '../types/api';

export interface IssuesAndQuestionsViewProps {
  onPushToAgent: (prompt: string) => Promise<void> | void;
}

export default function IssuesAndQuestionsView({ onPushToAgent }: IssuesAndQuestionsViewProps) {
  const [summary, setSummary] = useState<IssuesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);

  const load = async () => {
    try {
      setSummary(await api.fetchIssues());
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load issues');
    }
  };

  useEffect(() => { void load(); }, []);

  const push = async (issue: ProjectIssue) => {
    setPushingId(issue.id);
    setError(null);
    try {
      const { prompt } = await api.pushIssueToAgent(issue.id);
      await onPushToAgent(prompt);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to route issue to agent');
    } finally {
      setPushingId(null);
    }
  };

  if (!summary && !error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Scanning project for open issues…
      </div>
    );
  }

  const nonConformances = summary?.issues.filter(i => i.type === 'non_conformance') ?? [];
  const questions = summary?.issues.filter(i => i.type === 'open_question') ?? [];

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-100">Questions, Actions &amp; Issues Flagged</h1>
            <p className="mt-0.5 text-xs text-slate-400">
              {summary ? `${summary.nonConformanceCount} open non-conformance(s) · ${summary.openQuestionCount} open question(s)` : '—'}
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            aria-label="Refresh issues"
            title="Refresh issues"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {error && (
          <p className="rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-2 text-xs text-rose-300" role="alert">{error}</p>
        )}

        {summary && summary.issues.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center">
            <PartyPopper className="h-10 w-10 text-emerald-500" aria-hidden />
            <p className="text-sm font-medium text-slate-200">All clear</p>
            <p className="max-w-sm text-xs leading-relaxed text-slate-500">
              No open hardware non-conformances and no unresolved builder questions anywhere in the
              program documents.
            </p>
          </div>
        )}

        {/* Non-conformances */}
        {nonConformances.length > 0 && (
          <section aria-label="Hardware non-conformances" className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-rose-300">
              <TriangleAlert className="h-4 w-4" aria-hidden /> Hardware non-conformances
            </h2>
            {nonConformances.map(issue => (
              <article key={issue.id} className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-4">
                <header className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-rose-950/80 px-2.5 py-0.5 font-mono text-[11px] font-bold text-rose-300">
                    {issue.actionId ?? 'DEFECT'}
                  </span>
                  {issue.subsystem && (
                    <span className="rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-[11px] text-slate-300">
                      {issue.subsystem}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-slate-600">{issue.source}</span>
                </header>
                <h3 className="mt-2 text-sm font-semibold text-slate-100">{issue.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">{issue.description}</p>
                {issue.evidence && issue.evidence !== '—' && (
                  <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden /> {issue.evidence}
                  </p>
                )}
                <div className="mt-3">
                  <button
                    onClick={() => void push(issue)}
                    disabled={pushingId !== null}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:opacity-40"
                  >
                    {pushingId === issue.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Bot className="h-4 w-4" aria-hidden />
                    )}
                    Push to AI agent for impact analysis &amp; shop repair WI
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}

        {/* Open questions */}
        {questions.length > 0 && (
          <section aria-label="Open builder questions" className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-amber-300">
              <MessageCircleQuestion className="h-4 w-4" aria-hidden /> Open builder questions
            </h2>
            {questions.map(issue => (
              <article key={issue.id} className="rounded-xl border border-amber-900/50 bg-amber-950/10 p-4">
                <header className="flex items-center gap-2">
                  <span className="rounded-full bg-amber-950/80 px-2.5 py-0.5 font-mono text-[11px] font-bold text-amber-300">
                    {issue.title}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-slate-600">{issue.source}</span>
                </header>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{issue.description}</p>
                <div className="mt-3">
                  <button
                    onClick={() => void push(issue)}
                    disabled={pushingId !== null}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg border border-amber-800 px-4 text-sm font-semibold text-amber-300 transition hover:bg-amber-950/50 disabled:opacity-40"
                  >
                    {pushingId === issue.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Bot className="h-4 w-4" aria-hidden />
                    )}
                    Ask the agent to resolve
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
