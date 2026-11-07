// One question's glance header for the left pane (design 2026-11-03 §3b.4):
// meta row (topic tag, "3 of 13", "from RTM.md · SS-04.e", Details) + a 2-line
// clamped title + a 2-line clamped BLUF. Reference only — the one action is the
// Details switch. No BLUF means no element at all (§3b.7.5), and nothing here
// invents a Q-number: identity is the pager position plus the requirement tag.
import { List } from 'lucide-react';
import { cleanQuestionTitle, itemTopic } from '../../lib/portalGrouping';
import { extractRequirementIds } from '../../lib/requirementAnchor';
import type { PortalItem } from '../../types/api';

export interface QuestionContextHeaderProps {
  /** The active question. Read-only: only its own title/detail/meta/docPath. */
  item: PortalItem;
  /** 1-based position of `item` in the panel list — the only "Qn" shown. */
  pagerIndex: number;
  /** Panel list length, rendered as "{pagerIndex} of {total}". */
  total: number;
  /** Flips the right pane to Details. Focus does not move (§3b.6(vi)). */
  onOpenDetails: () => void;
  /**
   * Basename of the doc selected in the right pane. Not read here — the header
   * shows the item's own doc unconditionally; the prop exists so Part 2 can pass
   * one stable shape to both header and Details (§3b.5.1 owns the comparison).
   */
  selectedDocName?: string;
}

/**
 * Left-pane question context header. Inputs/outputs: see
 * `QuestionContextHeaderProps`. Throws: never.
 */
export default function QuestionContextHeader({
  item,
  pagerIndex,
  total,
  onOpenDetails
}: QuestionContextHeaderProps) {
  const topic = itemTopic(item);
  const cleanTitle = cleanQuestionTitle(item.title);
  const docName = item.docPath ? (item.docPath.split('/').pop() ?? '') : '';
  const reqId = extractRequirementIds(`${item.title} ${item.detail ?? ''}`)[0];
  const bluf = item.meta?.sections?.bluf;

  return (
    <section
      aria-label="Question context"
      className="shrink-0 border-b border-[var(--sf-border-weak)] bg-[var(--sf-raised)]/55 px-3 pt-1.5 pb-2"
    >
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
        <button
          type="button"
          onClick={onOpenDetails}
          className="ml-auto inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-md border border-[var(--sf-review)]/55 bg-[var(--sf-review-fill)]/35 px-2 text-[10.5px] font-semibold text-violet-200 transition hover:bg-[var(--sf-review-fill)]/50 focus:ring-2 focus:ring-[#ff2a3c]/60"
        >
          <List className="h-[10px] w-[10px]" aria-hidden />
          Details
        </button>
      </div>
      {cleanTitle && (
        <h2 className="mt-0.5 line-clamp-2 text-[13px]/[1.35] font-bold text-[var(--sf-text)]">
          {cleanTitle}
        </h2>
      )}
      {/* §3b.4: no BLUF → no element at all (no box, no placeholder, no height). */}
      {bluf && (
        <p className="mt-1 line-clamp-2 text-[11.5px]/[1.4] text-[var(--sf-text-2)]">
          <b className="mr-1.5 text-[9.5px] font-bold tracking-[0.07em] text-[var(--sf-brass)]">
            BLUF
          </b>
          {bluf}
        </p>
      )}
    </section>
  );
}
