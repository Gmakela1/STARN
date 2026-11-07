// The full record for one question, shown in the right pane (design
// 2026-11-03 §3b.5). Reading order: meta line → title → BLUF → research
// findings → sources → verification status → background → main suggestion →
// alternatives → defer → answer history → original detail. Never a proposal or
// recorded-answer card — those stay in the conversation (§3b.7.2) — and at most
// three interactive elements: Open document, Follow-up, Original detail.
import { useState } from 'react';
import { Check, FileText, RotateCcw } from 'lucide-react';
import { cleanQuestionTitle, itemTopic } from '../../lib/portalGrouping';
import { extractRequirementIds } from '../../lib/requirementAnchor';
import type { PortalItem, ResearchSource } from '../../types/api';

/** One memo section: card + uppercase label + pre-line body. */
const CARD = 'rounded-lg border border-[var(--sf-border-weak)] bg-[var(--sf-panel)]/60 px-3 py-2';
const LABEL = 'text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--sf-text-mut)]';
/** Brass = the memo's primary tone (§3b.5.8); amber stays reserved for needs-input. */
const BRASS_LABEL = 'text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--sf-brass)]';

export interface QuestionDetailsProps {
  /** The question whose record is shown. Read-only. */
  item: PortalItem;
  /** 1-based position in the panel list — identity, never a Q-number (§8.13). */
  pagerIndex: number;
  /** Panel list length, rendered as "{pagerIndex} of {total}". */
  total: number;
  /** Basename of the right pane's doc; `Open document` shows only when it differs. */
  selectedDocName?: string;
  /** Opens `item.docPath` and flips the right pane back to Document (§3b.6(iv)). */
  onOpenDocument?: (docPath: string) => void;
}

/** Host of a source URL; the raw string when it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Derived one-sentence verification status (§3b.5.6) — no new backend field.
 * Precedence: researching → proposal → auto-applied → no verified source.
 */
function verificationSentence(item: PortalItem): string {
  if (item.meta?.researching) return 'Research in progress — nothing verified yet.';
  const proposed = item.meta?.proposedAnswer;
  if (proposed) {
    return `Unverified proposal (${Math.round(proposed.confidence * 100)}% confidence) — awaiting your decision in the conversation.`;
  }
  const auto = item.meta?.autoApplied;
  if (auto) {
    return `Verified against ${auto.sources.length} sources (${Math.round(auto.confidence * 100)}% confidence) — auto-applied.`;
  }
  return 'No verified external source — treat as uncorroborated. No confidence figure is shown.';
}

/**
 * Right-pane question record. Inputs/outputs: see `QuestionDetailsProps`.
 * Owner of exactly two local disclosures (Follow-up, Original detail); the
 * component is keyed by item in the parent, so neither leaks across items.
 * Throws: never.
 */
export default function QuestionDetails({
  item,
  pagerIndex,
  total,
  selectedDocName,
  onOpenDocument
}: QuestionDetailsProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);

  const sections = item.meta?.sections;
  const options = sections?.options ?? [];
  const hasSections =
    !!sections &&
    !!(
      sections.bluf ||
      sections.findings ||
      sections.suggestion ||
      sections.alternatives ||
      options.length > 0 ||
      sections.defer ||
      sections.background
    );

  const topic = itemTopic(item);
  const cleanTitle = cleanQuestionTitle(item.title);
  const docPath = item.docPath;
  const docName = docPath ? (docPath.split('/').pop() ?? '') : '';
  const reqId = extractRequirementIds(`${item.title} ${item.detail ?? ''}`)[0];
  /** The derived source row / meta tag: "RTM.md · SS-04.e" ('' without a doc). */
  const docTail = docName + (reqId ? ` · ${reqId}` : '');
  const showOpenDocument = !!onOpenDocument && docName !== '' && docName !== selectedDocName;
  const sources: ResearchSource[] =
    item.meta?.proposedAnswer?.sources ?? item.meta?.autoApplied?.sources ?? [];
  const history = item.meta?.answerHistory ?? [];

  return (
    <div className="max-w-[70ch] space-y-2 px-4 py-3.5">
      {/* 1. Meta line */}
      <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10px] text-[var(--sf-text-mut)]">
        {topic && (
          <span className="shrink-0 rounded-full border border-[var(--sf-review)]/55 bg-[var(--sf-review-fill)]/50 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.06em] text-violet-200">
            {topic}
          </span>
        )}
        <span className="shrink-0 tabular-nums">
          {pagerIndex} of {total}
        </span>
        {docName && (
          <span className="truncate">
            from <b className="font-semibold text-[var(--sf-text-2)]">{docName}</b>
            {reqId && ` · ${reqId}`}
          </span>
        )}
        {showOpenDocument && docPath && (
          <button
            type="button"
            onClick={() => onOpenDocument(docPath)}
            className="ml-auto inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-md border border-[var(--sf-border-strong)] bg-[var(--sf-panel)] px-2.5 text-[11px] font-semibold text-violet-300 transition hover:bg-[var(--sf-hover)] focus:ring-2 focus:ring-[#ff2a3c]/60"
          >
            Open document
          </button>
        )}
      </div>

      {/* 2. Title — never clamped */}
      {cleanTitle && (
        <h1 className="text-[15px]/[1.3] font-bold text-[var(--sf-text)]">{cleanTitle}</h1>
      )}

      {hasSections ? (
        <>
          {/* 3. BLUF — the one deliberate duplicate of the context header */}
          {sections?.bluf && (
            <div className="sf-bluf-callout">
              <p className="sf-bluf-label">BLUF</p>
              <p className="whitespace-pre-line text-[13px] font-bold leading-relaxed text-[var(--sf-text)]">
                {sections.bluf}
              </p>
            </div>
          )}

          {/* 4. Research findings — cited source names stay inline as written */}
          {sections?.findings && (
            <div className={CARD}>
              <p className={LABEL}>Research findings</p>
              <p className="mt-0.5 whitespace-pre-line text-[12.5px]/[1.45] text-[var(--sf-text-2)]">
                {sections.findings}
              </p>
            </div>
          )}

          {/* 5. Sources — text rows, never icon-only */}
          {(sources.length > 0 || docTail !== '') && (
            <div className={CARD}>
              <p className={LABEL}>Sources</p>
              <ul className="mt-1 space-y-0.5">
                {sources.length > 0 ? (
                  sources.map((source, i) => (
                    <li
                      key={`${source.title}-${i}`}
                      className="flex items-start gap-1.5 text-[11.5px] text-[var(--sf-text-2)]"
                    >
                      <FileText className="mt-0.5 h-3 w-3 shrink-0 text-[var(--sf-text-mut)]" aria-hidden />
                      <span>
                        {source.title}
                        {source.url && (
                          <span className="text-[var(--sf-text-mut)]"> · {hostOf(source.url)}</span>
                        )}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="flex items-start gap-1.5 text-[11.5px] text-[var(--sf-text-2)]">
                    <FileText className="mt-0.5 h-3 w-3 shrink-0 text-[var(--sf-text-mut)]" aria-hidden />
                    <span>{docTail} (source row)</span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* 6. Verification status — one derived sentence */}
          <div className={CARD}>
            <p className={LABEL}>Verification status</p>
            <p className="mt-0.5 text-[11.5px]/[1.45] text-[var(--sf-text-2)]">
              {verificationSentence(item)}
            </p>
          </div>

          {/* 7. Background */}
          {sections?.background && (
            <div className={CARD}>
              <p className={LABEL}>Background</p>
              <p className="mt-0.5 whitespace-pre-line text-[12.5px]/[1.45] text-[var(--sf-text-2)]">
                {sections.background}
              </p>
            </div>
          )}

          {/* 8. Main suggestion — brass highlighted variant, never amber */}
          {sections?.suggestion && (
            <div className={`${CARD} border-l-[3px] border-l-[var(--sf-brass)]`}>
              <p className={BRASS_LABEL}>Main suggestion</p>
              <p className="mt-0.5 whitespace-pre-line text-[12.5px]/[1.45] text-[var(--sf-text)]">
                {sections.suggestion}
              </p>
            </div>
          )}

          {/* 9. Alternatives — parsed A/B/C rows, prose fallback for legacy text */}
          {(options.length > 0 || sections?.alternatives) && (
            <div className={CARD}>
              <p className={LABEL}>Alternatives</p>
              {options.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {options.map(option => {
                    const recommended = option.recommended === true;
                    return (
                      <li
                        key={option.id}
                        aria-label={`Option ${option.id}${recommended ? ', recommended' : ''}`}
                        className={`flex min-h-[44px] items-start gap-2 py-1 ${recommended ? 'border-l-[3px] border-[var(--sf-brass)] pl-2' : ''}`}
                      >
                        <span className="shrink-0 rounded border border-[var(--sf-border-strong)] bg-[var(--sf-raised)] px-1.5 font-mono text-[11px] font-bold text-[var(--sf-text)]">
                          {option.id}
                        </span>
                        <span className="min-w-0">
                          <span className="text-[13px]/[1.45] text-[var(--sf-text-2)]">
                            {option.text}
                          </span>
                          {recommended && (
                            <span className={`mt-1 flex items-center gap-1 ${BRASS_LABEL}`}>
                              <Check className="h-[10px] w-[10px]" aria-hidden /> Recommended
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-0.5 whitespace-pre-line text-[12.5px]/[1.45] text-[var(--sf-text-2)]">
                  {sections?.alternatives}
                </p>
              )}
            </div>
          )}

          {/* 10. If deferred */}
          {sections?.defer && (
            <div className={CARD}>
              <p className={LABEL}>Defer</p>
              <p className="mt-0.5 whitespace-pre-line text-[12.5px]/[1.45] text-[var(--sf-text-2)]">
                {sections.defer}
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Degraded record (§3b.4): plain sentence + the original body, no card. */}
          <p className="text-[11.5px] text-[var(--sf-text-mut)]">
            No decision memo for this question yet
          </p>
          {item.detail && (
            <p className="whitespace-pre-line text-[12.5px]/[1.45] text-[var(--sf-text-2)]">
              {item.detail}
            </p>
          )}
        </>
      )}

      {/* 11. Answer history — existing Follow-up disclosure, oldest first */}
      {history.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setHistoryOpen(prev => !prev)}
            aria-expanded={historyOpen}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-amber-500/40 bg-amber-950/40 px-2.5 text-[11px] font-medium text-amber-300 transition hover:bg-amber-900/40 focus:ring-2 focus:ring-amber-500/40"
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> Follow-up
          </button>
          {historyOpen && (
            <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--sf-border-weak)] bg-[var(--sf-panel)]/70 p-2">
              {history.map((entry, i) => (
                <li key={`${entry.at}-${i}`} className="text-[11px] text-[var(--sf-text-2)]">
                  <time dateTime={entry.at} className="text-[var(--sf-text-mut)]">
                    {entry.at.slice(0, 10)}
                  </time>{' '}
                  <span className="text-[var(--sf-text)]">{entry.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 12. Original detail — a disclosure when sections exist (primary body
          otherwise, already rendered above). */}
      {hasSections && item.detail && (
        <div>
          <button
            type="button"
            onClick={() => setOriginalOpen(prev => !prev)}
            aria-expanded={originalOpen}
            className="inline-flex min-h-[44px] items-center rounded-md text-[11px] font-medium text-[var(--sf-text-mut)] transition hover:text-[var(--sf-text-2)] focus:ring-2 focus:ring-[#ff2a3c]/60"
          >
            Original detail
          </button>
          {originalOpen && (
            <p className="mt-1 whitespace-pre-line rounded-md border border-[var(--sf-border-weak)] bg-[var(--sf-void)]/60 p-2.5 text-xs leading-relaxed text-[var(--sf-text-2)]">
              {item.detail}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
