import { Fragment, ReactNode } from 'react';
import { Inbox, MessageSquare, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Lightweight, dependency-free Markdown renderer for project documents and
 * agent chat output. Supports headings, bold/italic/code spans, links,
 * bullet & numbered lists, task checkboxes, tables, hr, blockquotes, and code
 * fences. Document presentation v2: H2 sections group into optional callout
 * panels, requirement-ID tokens render as mono chips, and the root carries a
 * size variant ('document' | 'panel') shared by the doc pane and panels.
 */

/** Slug for H2 heading anchors (mini-TOC links target these ids). */
export function slugifyHeading(text: string): string {
  return text
    .replace(/[`*]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** Special H2 sections render their whole section inside a tinted callout. */
const SPECIAL_H2_CALLOUTS: Array<{ test: RegExp; cls: string; icon: LucideIcon }> = [
  { test: /^open questions$/i, cls: 'sf-callout-open-questions', icon: MessageSquare },
  { test: /^user answers \(pending incorporation\)$/i, cls: 'sf-callout-user-answers', icon: Inbox }
];

/**
 * Item count for a callout header chip (brief §4.3/§4.4): list items + sub
 * headings in the section body; a plain-prose section counts as one item.
 */
function countSectionItems(lines: string[]): number {
  const items = lines.filter(
    l => /^\s*(?:[-*]|\d+\.)\s+/.test(l) || /^#{3,6}\s/.test(l)
  ).length;
  return items > 0 ? items : 1;
}

/**
 * Requirement-ID chip (SS-3, ICD-2.a, BOM-14…). Boundary-anchored so it never
 * fires mid-word: a leading \w (e.g. "CLASS3") or trailing \w (e.g. "SS-1x")
 * blocks the match. Chips are click/keyboard-activatable; the doc pane's
 * delegated click handler (DevelopmentView.handleDocChipClick) does the jump.
 * Keyboard: Enter/Space synthesizes a real click event so delegation works.
 */
const REQ_CHIP = /\b(SS|ICD|DD|Cap|Req|BOM|WI|TP)-?[A-Z]?-?\d+(\.[a-z])?\b/g;

/**
 * Splits a plain-text segment into text + chip nodes. Only called for raw
 * text — never for code spans, link labels, or bold/italic interiors.
 */
function pushPlainText(nodes: ReactNode[], text: string, keyPrefix: string): void {
  REQ_CHIP.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = REQ_CHIP.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(
      <span
        key={`${keyPrefix}-chip${i++}`}
        className="sf-req-chip"
        tabIndex={0}
        role="button"
        aria-label={`Jump to requirement ${match[0]}`}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            // Span synthesization: only <button> auto-clicks on keypress, so
            // dispatch explicitly — the event bubbles to the doc-pane handler.
            e.currentTarget.click();
          }
        }}
      >
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Tokenize: code spans, bold, italic, links
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) pushPlainText(nodes, text.slice(last, match.index), `${keyPrefix}-pre${i}`);
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key} className="font-semibold text-[#e8edf5]">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (match[5] !== undefined && match[6] !== undefined) {
      // Security: only allow http/https/mailto schemes; anything else (e.g.
      // javascript:, data:) renders as inert plain text.
      const href = /^https?:\/\//i.test(match[6]) || /^mailto:/i.test(match[6]) ? match[6] : undefined;
      if (href) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-violet-400 underline decoration-violet-700 underline-offset-2 hover:text-violet-300"
          >
            {match[5]}
          </a>
        );
      } else {
        nodes.push(<span key={key}>{match[5]}</span>);
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) pushPlainText(nodes, text.slice(last), `${keyPrefix}-tail`);
  return nodes;
}

function renderTable(rows: string[], key: string): ReactNode {
  const parseRow = (row: string) =>
    row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  const header = parseRow(rows[0]);
  const body = rows.slice(2).map(parseRow);
  return (
    <div
      key={key}
      role="region"
      aria-label="Data table — scrolls horizontally"
      tabIndex={0}
      className="sf-table-wrap doc-table-scroll overflow-x-auto"
    >
      <table>
        <thead>
          <tr>{header.map((h, i) => <th key={i}>{renderInline(h, `${key}-h${i}`)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((cells, r) => (
            <tr key={r}>
              {cells.map((c, i) => <td key={i}>{renderInline(c, `${key}-r${r}c${i}`)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Renders markdown lines (a whole H2 section) into block nodes. */
function renderBlocks(lines: string[], keyPrefix: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockIdx = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `${keyPrefix}-b${blockIdx++}`;

    // Code fence
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre key={key} className="overflow-x-auto rounded-lg border border-[#2a3342] bg-[#0d1017] p-3 text-xs text-[#a8b3c4]">
          {buf.join('\n')}
        </pre>
      );
      continue;
    }

    // Table
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      blocks.push(renderTable(rows, key));
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = (`h${Math.min(level, 6)}`) as keyof JSX.IntrinsicElements;
      // H2 ids anchor the doc pane's mini-TOC links.
      blocks.push(
        <Tag key={key} id={level === 2 ? slugifyHeading(heading[2]) : undefined}>
          {renderInline(heading[2], key)}
        </Tag>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key} className="my-3 border-[#2a3342]" />);
      i++;
      continue;
    }

    // List (bullet / numbered / tasks)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: ReactNode[] = [];
      let itemIdx = 0;
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        const task = raw.match(/^\[([ xX])\]\s+(.*)$/);
        const itemKey = `${key}-i${itemIdx++}`;
        if (task) {
          const done = task[1].toLowerCase() === 'x';
          items.push(
            <li key={itemKey} className="flex items-start gap-2">
              <span
                aria-hidden
                className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                  done ? 'border-[#8b5cf6] bg-[#2e1065]/60 text-[#e8edf5]' : 'border-[#3b4658] bg-[#0d1017]'
                }`}
              >
                {done ? '✓' : ''}
              </span>
              <span className={done ? 'text-[#a8b3c4] line-through decoration-[#6e7d92]' : ''}>
                {renderInline(task[2], itemKey)}
              </span>
            </li>
          );
        } else {
          items.push(<li key={itemKey}>{renderInline(raw, itemKey)}</li>);
        }
        i++;
      }
      blocks.push(
        <ul key={key} className="my-2 ml-4 list-disc space-y-1 marker:text-[#6e7d92]">
          {items}
        </ul>
      );
      continue;
    }

    // Blockquote (left-rule obsidian-2 panel per the v2 brief)
    if (line.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(
        <blockquote key={key} className="sf-quote">
          {buf.map((l, idx) => (
            <Fragment key={idx}>
              {renderInline(l, `${key}-q${idx}`)}
              {idx < buf.length - 1 ? ' ' : null}
            </Fragment>
          ))}
        </blockquote>
      );
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (merge consecutive non-blank, non-structural lines)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('>')
    ) {
      buf.push(lines[i++]);
    }
    // "**BLUF:**" bold lead → recommendation callout (brief §4.5): brass
    // border-left, Target icon, "Bottom Line Up Front" label above the lead.
    const isBluf = buf[0].startsWith('**BLUF:**');
    const content = buf.map((l, idx) => (
      <Fragment key={idx}>
        {renderInline(l, `${key}-l${idx}`)}
        {idx < buf.length - 1 ? ' ' : null}
      </Fragment>
    ));
    if (isBluf) {
      blocks.push(
        <div key={key} className="sf-bluf-callout">
          <span className="sf-bluf-label">
            <Target className="h-3.5 w-3.5" aria-hidden />
            Bottom Line Up Front
          </span>
          <p className="my-1.5">{content}</p>
        </div>
      );
    } else {
      blocks.push(<p key={key} className="my-1.5">{content}</p>);
    }
  }

  return blocks;
}

export default function Markdown({
  content,
  variant = 'panel'
}: {
  content: string;
  /** 'document' = doc pane typography (75ch measure, relaxed leading); 'panel' = chat/panel sizing. */
  variant?: 'document' | 'panel';
}) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  // Group lines into sections at H2 boundaries; special H2s wrap their whole
  // section (heading + body) in a tinted callout panel, other H2s in document
  // variant get subtle card separation.
  const sections: Array<{ h2: string | null; lines: string[] }> = [{ h2: null, lines: [] }];
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) sections.push({ h2: h2[1].trim(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }

  return (
    <div className={`doc-prose ${variant === 'document' ? 'doc-prose-document' : 'doc-prose-panel'} text-[#e8edf5]`}>
      {sections.map((section, si) => {
        const callout = section.h2
          ? SPECIAL_H2_CALLOUTS.find(c => c.test.test(section.h2 as string))
          : undefined;
        const blocks = renderBlocks(section.lines, `s${si}`);
        if (callout) {
          // Callout header: lucide icon + label + count chip (brief §4.3/§4.4);
          // the H2 keeps its slug id so mini-TOC links still anchor.
          const Icon = callout.icon;
          return (
            <section key={si} className={`sf-h2-callout ${callout.cls}`}>
              <h2 id={slugifyHeading(section.h2 as string)} className="sf-callout-head">
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {renderInline(section.h2 as string, `s${si}-h`)}
                <span className="sf-callout-count">{countSectionItems(section.lines)}</span>
              </h2>
              {blocks}
            </section>
          );
        }
        if (variant === 'document' && section.h2) {
          // Section card: focusable target (tabIndex -1) for mini-TOC clicks;
          // the H2 keeps its slug id for the anchor link.
          return (
            <section key={si} className="sf-h2-section" tabIndex={-1}>
              <h2 id={slugifyHeading(section.h2 as string)}>
                {renderInline(section.h2 as string, `s${si}-h`)}
              </h2>
              {blocks}
            </section>
          );
        }
        return <Fragment key={si}>{blocks}</Fragment>;
      })}
    </div>
  );
}
