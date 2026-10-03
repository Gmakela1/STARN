import { useState } from 'react';
import { CheckCircle2, MessageCircleMore, Trash2, Loader2 } from 'lucide-react';
import { PendingCheckpoint } from '../types/api';
import { api } from '../api/client';
import CriticScorecard from './CriticScorecard';

export interface CheckpointPanelProps {
  checkpoint: PendingCheckpoint;
  onResolved: (outcome: 'approved' | 'discarded') => void;
  onRevisionRequested: (revisionPrompt: string) => void;
}

/**
 * Human-on-the-loop checkpoint: shown when a specialist completes a
 * critic-gated draft. Mirrors the terminal checkpoint (accept / feedback /
 * discard) with critic context automatically attached to revisions.
 */
export default function CheckpointPanel({ checkpoint, onResolved, onRevisionRequested }: CheckpointPanelProps) {
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'approve' | 'revise' | 'discard') => {
    setSubmitting(decision);
    setError(null);
    try {
      const result = await api.submitCheckpointDecision(decision, decision === 'revise' ? feedback : undefined);
      if (result.status === 'revision_requested' && result.revisionPrompt) {
        onRevisionRequested(result.revisionPrompt);
      } else {
        onResolved(result.status === 'approved' ? 'approved' : 'discarded');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Decision failed');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <aside
      className="rounded-xl border border-sky-800/70 bg-sky-950/30 p-3 shadow-lg shadow-sky-950/40"
      aria-label="Pending human checkpoint"
    >
      <p className="text-xs font-bold uppercase tracking-wider text-sky-300">
        Checkpoint — {checkpoint.specialistName} draft awaiting review
      </p>

      {checkpoint.criticResult && (
        <div className="mt-2">
          <CriticScorecard result={checkpoint.criticResult} />
        </div>
      )}

      {error && (
        <p className="mt-2 rounded border border-rose-900 bg-rose-950/60 px-2 py-1 text-xs text-rose-300" role="alert">
          {error}
        </p>
      )}

      {showFeedback ? (
        <div className="mt-3 space-y-2">
          <label htmlFor="checkpoint-feedback" className="text-xs font-medium text-slate-300">
            Revision guidance for the specialist
          </label>
          <textarea
            id="checkpoint-feedback"
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            rows={3}
            placeholder="e.g. Section 3 needs torque specs for every fastener…"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void decide('revise')}
              disabled={!feedback.trim() || submitting !== null}
              className="flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting === 'revise' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageCircleMore className="h-4 w-4" aria-hidden />}
              Send for revision
            </button>
            <button
              onClick={() => setShowFeedback(false)}
              disabled={submitting !== null}
              className="min-h-[44px] rounded-lg border border-slate-700 px-4 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void decide('approve')}
            disabled={submitting !== null}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
          >
            {submitting === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
            Approve & record
          </button>
          <button
            onClick={() => setShowFeedback(true)}
            disabled={submitting !== null}
            className="flex min-h-[44px] items-center gap-2 rounded-lg border border-sky-700 px-4 text-sm font-semibold text-sky-300 transition hover:bg-sky-950"
          >
            <MessageCircleMore className="h-4 w-4" aria-hidden />
            Request changes
          </button>
          <button
            onClick={() => void decide('discard')}
            disabled={submitting !== null}
            className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-700 px-4 text-sm text-slate-400 transition hover:border-rose-800 hover:text-rose-300"
          >
            {submitting === 'discard' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
            Discard draft
          </button>
        </div>
      )}
    </aside>
  );
}
