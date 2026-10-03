import { Fragment, ReactNode } from 'react';

/**
 * Lightweight, dependency-free Markdown renderer for project documents and
 * agent chat output. Supports headings, bold/italic/code spans, links,
 * bullet & numbered lists, task checkboxes, tables, hr, and code fences.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Tokenize: code spans, bold, italic, links
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key} className="font-semibold text-slate-50">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (match[5] !== undefined && match[6] !== undefined) {
      nodes.push(
        <a
          key={key}
          href={match[6]}
          target="_blank"
          rel="noreferrer"
          className="text-sky-400 underline decoration-sky-700 underline-offset-2 hover:text-sky-300"
        >
          {match[5]}
        </a>
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderTable(rows: string[], key: string): ReactNode {
  const parseRow = (row: string) =>
    row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  const header = parseRow(rows[0]);
  const body = rows.slice(2).map(parseRow);
  return (
    <div key={key} className="overflow-x-auto">
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

export default function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockIdx = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${blockIdx++}`;

    // Code fence
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre key={key} className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
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
      blocks.push(<Tag key={key}>{renderInline(heading[2], key)}</Tag>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key} className="my-3 border-slate-800" />);
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
                  done ? 'border-emerald-600 bg-emerald-900/60 text-emerald-300' : 'border-slate-600 bg-slate-900'
                }`}
              >
                {done ? '✓' : ''}
              </span>
              <span className={done ? 'text-slate-400 line-through decoration-slate-600' : ''}>
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
        <ul key={key} className="my-2 ml-4 list-disc space-y-1 marker:text-slate-600">
          {items}
        </ul>
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
      !lines[i].startsWith('```')
    ) {
      buf.push(lines[i++]);
    }
    blocks.push(
      <p key={key} className="my-1.5">
        {buf.map((l, idx) => (
          <Fragment key={idx}>
            {renderInline(l, `${key}-l${idx}`)}
            {idx < buf.length - 1 ? ' ' : null}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div className="doc-prose text-slate-200">{blocks}</div>;
}
