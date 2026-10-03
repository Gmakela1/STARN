import { ShieldCheck, ShieldAlert, Lightbulb } from 'lucide-react';
import { CriticResult } from '../types/api';

function scoreTone(score: number, passed: boolean) {
  if (passed && score >= 8.5) return { bar: 'bg-emerald-500', text: 'text-emerald-300', border: 'border-emerald-800/70', chip: 'bg-emerald-950/60' };
  if (passed) return { bar: 'bg-emerald-500', text: 'text-emerald-300', border: 'border-emerald-900/70', chip: 'bg-emerald-950/50' };
  if (score >= 6) return { bar: 'bg-amber-500', text: 'text-amber-300', border: 'border-amber-900/70', chip: 'bg-amber-950/50' };
  return { bar: 'bg-rose-500', text: 'text-rose-300', border: 'border-rose-900/70', chip: 'bg-rose-950/50' };
}

export default function CriticScorecard({ result, compact }: { result: CriticResult; compact?: boolean }) {
  const tone = scoreTone(result.score, result.passed);
  const pct = Math.max(0, Math.min(100, (result.score / 10) * 100));

  return (
    <section
      className={`rounded-xl border ${tone.border} ${tone.chip} p-3`}
      aria-label={`Critic review: score ${result.score.toFixed(1)} out of 10, ${result.passed ? 'passed' : 'failed'}`}
    >
      <div className="flex items-center gap-2.5">
        {result.passed ? (
          <ShieldCheck className={`h-5 w-5 shrink-0 ${tone.text}`} aria-hidden />
        ) : (
          <ShieldAlert className={`h-5 w-5 shrink-0 ${tone.text}`} aria-hidden />
        )}
        <span className={`text-sm font-bold ${tone.text}`}>
          Critic {result.passed ? 'PASS' : 'FAIL'} — {result.score.toFixed(1)}/10
        </span>
        <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-slate-800" aria-hidden>
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {result.summary && <p className="mt-2 text-xs leading-relaxed text-slate-300">{result.summary}</p>}

      {!compact && (
        <div className="mt-2 space-y-2">
          {result.strengths?.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">Strengths</p>
              <ul className="mt-0.5 ml-4 list-disc space-y-0.5 text-xs text-slate-300 marker:text-emerald-700">
                {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {result.weaknesses?.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-400">Weaknesses</p>
              <ul className="mt-0.5 ml-4 list-disc space-y-0.5 text-xs text-slate-300 marker:text-rose-700">
                {result.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          {result.actionableGuidance && (
            <p className="flex items-start gap-1.5 text-xs text-amber-200/90">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
              {result.actionableGuidance}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
