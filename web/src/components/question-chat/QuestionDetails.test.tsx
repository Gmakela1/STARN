import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { cleanup, renderWithUser } from '../../test/render';
import QuestionDetails, { type QuestionDetailsProps } from './QuestionDetails';
import type { PortalItem } from '../../types/api';

afterEach(() => cleanup());

/** Every memo section plus a proposal source and one answer-history entry. */
function fullItem(overrides: Partial<PortalItem> = {}): PortalItem {
  return {
    id: 'opaque-portal-id',
    type: 'question',
    severity: 'normal',
    status: 'open',
    source: 'autopilot',
    title: '**Fuse selectivity** for the 48 V rail',
    detail: 'Original wording of the question, as the model wrote it.',
    docPath: 'docs/RTM.md',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    meta: {
      topic: 'electrical',
      sections: {
        bluf: 'Use the 2 A slow-blow fuse.',
        findings: 'The datasheet lists a 2 A rating at 48 V.',
        background: 'The rail feeds the charger.',
        suggestion: 'Fit the 2 A slow-blow fuse.',
        alternatives: 'Use a 3 A fuse with a derated load.',
        defer: 'Deferring blocks the charger build.'
      },
      proposedAnswer: {
        answer: 'Fit the 2 A fuse.',
        confidence: 0.72,
        rationale: 'Datasheet rating.',
        sources: [{ title: 'Fuse datasheet', url: 'https://example.com/ds/1234' }]
      },
      answerHistory: [{ text: 'An earlier answer', at: '2026-10-01T00:00:00.000Z' }]
    },
    ...overrides
  };
}

function props(overrides: Partial<QuestionDetailsProps> = {}): QuestionDetailsProps {
  return {
    item: fullItem(),
    pagerIndex: 3,
    total: 13,
    selectedDocName: 'RTM.md',
    onOpenDocument: vi.fn(),
    ...overrides
  };
}

describe('QuestionDetails — reading order', () => {
  it('renders all twelve sections in the §3b.5 order', () => {
    const { container } = renderWithUser(<QuestionDetails {...props()} />);
    const text = container.textContent ?? '';
    const order = [
      '3 of 13',
      'from RTM.md',
      'Fuse selectivity for the 48 V rail',
      'BLUF',
      'Research findings',
      'Sources',
      'Verification status',
      'Background',
      'Main suggestion',
      'Alternatives',
      'Defer',
      'Follow-up',
      'Original detail'
    ];
    const positions = order.map(marker => text.indexOf(marker));
    positions.forEach((position, i) => {
      expect(position, `missing or out of order: ${order[i]}`).toBeGreaterThanOrEqual(0);
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('shows the title unclamped and the BLUF in the brass callout', () => {
    const { container } = renderWithUser(<QuestionDetails {...props()} />);
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Fuse selectivity for the 48 V rail');
    expect(title.className).not.toContain('line-clamp');
    const callout = container.querySelector('.sf-bluf-callout');
    expect(callout?.textContent).toContain('Use the 2 A slow-blow fuse.');
  });

  it('renders source rows as text with the url host', () => {
    renderWithUser(<QuestionDetails {...props()} />);
    expect(screen.getByText('Fuse datasheet')).toBeInTheDocument();
    expect(screen.getByText(/example\.com/)).toBeInTheDocument();
  });

  it('falls back to the derived doc row when there are no research sources', () => {
    const item = fullItem({ detail: 'SS-04.e asks whether the 2 A fuse coordinates.' });
    item.meta = { ...item.meta, proposedAnswer: undefined, autoApplied: undefined };
    renderWithUser(<QuestionDetails {...props({ item })} />);
    expect(screen.getByText('RTM.md · SS-04.e (source row)')).toBeInTheDocument();
  });

  it('uses the brass token for the main suggestion, never amber', () => {
    renderWithUser(<QuestionDetails {...props()} />);
    const body = screen.getByText('Fit the 2 A slow-blow fuse.');
    const card = body.parentElement;
    expect(card?.className).toContain('var(--sf-brass)');
    expect(card?.outerHTML ?? '').not.toMatch(/amber/);
  });
});

describe('QuestionDetails — sections omitted when data is absent', () => {
  it('drops findings, sources, background, suggestion, alternatives, defer, history and detail', () => {
    const item = fullItem({
      detail: undefined,
      docPath: undefined,
      meta: { topic: 'electrical', sections: { bluf: 'Use the 2 A slow-blow fuse.' } }
    });
    const { container } = renderWithUser(
      <QuestionDetails {...props({ item, selectedDocName: undefined, onOpenDocument: undefined })} />
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Use the 2 A slow-blow fuse.');
    for (const absent of [
      'Research findings',
      'Sources',
      'Background',
      'Main suggestion',
      'Alternatives',
      'Defer',
      'Follow-up',
      'Original detail'
    ]) {
      expect(text).not.toContain(absent);
    }
    expect(text).not.toContain('No decision memo');
  });
});

describe('QuestionDetails — verification status sentence', () => {
  it('says research is in progress while researching', () => {
    const item = fullItem();
    item.meta = { ...item.meta, researching: true };
    renderWithUser(<QuestionDetails {...props({ item })} />);
    expect(screen.getByText('Research in progress — nothing verified yet.')).toBeInTheDocument();
  });

  it('reports an unverified proposal with its confidence', () => {
    renderWithUser(<QuestionDetails {...props()} />);
    expect(
      screen.getByText(
        'Unverified proposal (72% confidence) — awaiting your decision in the conversation.'
      )
    ).toBeInTheDocument();
  });

  it('reports an auto-applied answer with its source count and confidence', () => {
    const item = fullItem();
    item.meta = {
      topic: 'electrical',
      sections: item.meta?.sections,
      autoApplied: {
        answer: 'Fit the 2 A fuse.',
        confidence: 0.9,
        rationale: 'Two sources agree.',
        sources: [{ title: 'Fuse datasheet' }, { title: 'App note' }]
      }
    };
    renderWithUser(<QuestionDetails {...props({ item })} />);
    expect(
      screen.getByText('Verified against 2 sources (90% confidence) — auto-applied.')
    ).toBeInTheDocument();
  });

  it('says no verified source exists when nothing is researching, proposed or applied', () => {
    const item = fullItem();
    item.meta = { topic: 'electrical', sections: item.meta?.sections };
    renderWithUser(<QuestionDetails {...props({ item })} />);
    expect(
      screen.getByText(
        'No verified external source — treat as uncorroborated. No confidence figure is shown.'
      )
    ).toBeInTheDocument();
  });
});

describe('QuestionDetails — actions stay in the conversation', () => {
  it('never renders a proposal card or a recorded-answer card', () => {
    renderWithUser(<QuestionDetails {...props()} />);
    expect(screen.queryByRole('group', { name: 'Proposed answer' })).toBeNull();
    expect(screen.queryByText('Use proposal')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
    expect(screen.queryByText('Undo')).toBeNull();
  });

  it('shows Open document only when the item doc differs from the selected doc', () => {
    const onOpenDocument = vi.fn();
    const { unmount } = renderWithUser(<QuestionDetails {...props({ onOpenDocument })} />);
    expect(screen.queryByRole('button', { name: 'Open document' })).toBeNull();
    unmount();

    const other = renderWithUser(
      <QuestionDetails {...props({ onOpenDocument, selectedDocName: 'BOM.md' })} />
    );
    const open = other.getByRole('button', { name: 'Open document' });
    expect(open).toBeInTheDocument();
  });

  it('opens the item document when Open document is clicked', async () => {
    const onOpenDocument = vi.fn();
    const { user } = renderWithUser(
      <QuestionDetails {...props({ onOpenDocument, selectedDocName: 'BOM.md' })} />
    );
    await user.click(screen.getByRole('button', { name: 'Open document' }));
    expect(onOpenDocument).toHaveBeenCalledWith('docs/RTM.md');
  });

  it('expands the answer history and the original detail on demand', async () => {
    const { user } = renderWithUser(<QuestionDetails {...props()} />);
    expect(screen.queryByText('An earlier answer')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Follow-up' }));
    expect(screen.getByText('An earlier answer')).toBeInTheDocument();

    expect(screen.queryByText(/Original wording of the question/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Original detail' }));
    expect(screen.getByText(/Original wording of the question/)).toBeInTheDocument();
  });
});

describe('QuestionDetails — answer history (moved out of the left pane)', () => {
  it('is an amber, worded disclosure listing the prior answers oldest first', async () => {
    const item = fullItem({
      meta: {
        answerHistory: [
          { text: 'First reply', at: '2025-01-01T00:00:00.000Z' },
          { text: 'Second reply', at: '2025-01-02T00:00:00.000Z' }
        ]
      }
    });
    const { user } = renderWithUser(<QuestionDetails {...props({ item })} />);

    const toggle = screen.getByRole('button', { name: 'Follow-up' });
    expect(toggle.className).toContain('text-amber-300');
    expect(toggle.className).toContain('bg-amber-950/40');
    expect(toggle.className).toContain('border-amber-500/40');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('First reply');
    expect(entries[0]).toHaveTextContent('2025-01-01');
    expect(entries[1]).toHaveTextContent('Second reply');
    expect(entries[1]).toHaveTextContent('2025-01-02');
  });
});

describe('QuestionDetails — degraded record', () => {
  it('shows the plain sentence and the original body when meta.sections is absent', () => {
    const item = fullItem({ meta: { topic: 'electrical' } });
    renderWithUser(<QuestionDetails {...props({ item })} />);
    const sentence = screen.getByText('No decision memo for this question yet');
    expect(sentence.className).toContain('text-[var(--sf-text-mut)]');
    expect(sentence.className).not.toMatch(/amber/);
    expect(sentence.className).not.toContain('rounded');
    expect(screen.queryByText('Main suggestion')).toBeNull();
    expect(screen.getByText('Original wording of the question, as the model wrote it.')).toBeInTheDocument();
  });
});

describe('QuestionDetails — decision options A/B/C', () => {
  /** One memo whose Alternatives parsed into three rows, B recommended. */
  function optionsItem(overrides: Partial<PortalItem> = {}): PortalItem {
    const item = fullItem();
    item.meta = {
      topic: 'electrical',
      sections: {
        bluf: 'Use the 2 A slow-blow fuse.',
        suggestion: 'Fit the 2 A slow-blow fuse.',
        alternatives: '',
        options: [
          { id: 'A', text: 'Use a 1.5 A fuse.' },
          { id: 'B', text: 'Use the 2 A slow-blow fuse.', recommended: true },
          { id: 'C', text: 'Use a 3 A fuse with a derated load.' }
        ],
        recommendation: 'B'
      }
    };
    return { ...item, ...overrides };
  }

  /** The option rows only (the pane's other lists are not options). */
  function optionRows(): HTMLElement[] {
    return screen.getAllByRole('listitem', { name: /^Option / });
  }

  it('renders one row per option, in order, with its monospace id chip', () => {
    const { container } = renderWithUser(<QuestionDetails {...props({ item: optionsItem() })} />);
    const rows = optionRows();
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual([
      'Option A',
      'Option B, recommended',
      'Option C'
    ]);
    expect(rows[0]).toHaveTextContent('A');
    expect(rows[0]).toHaveTextContent('Use a 1.5 A fuse.');
    expect(rows[2]).toHaveTextContent('Use a 3 A fuse with a derated load.');
    const chips = container.querySelectorAll('.font-mono');
    expect(Array.from(chips).map(chip => chip.textContent)).toEqual(['A', 'B', 'C']);
  });

  it('marks exactly one row recommended with words and a brass left rule', () => {
    renderWithUser(<QuestionDetails {...props({ item: optionsItem() })} />);
    const rows = optionRows();
    const recommendedRows = rows.filter(row => (row.className ?? '').includes('var(--sf-brass)'));
    expect(recommendedRows).toHaveLength(1);
    expect(recommendedRows[0]).toHaveAttribute('aria-label', 'Option B, recommended');
    expect(recommendedRows[0].className).toContain('border-l-[3px]');

    const chips = screen.getAllByText('Recommended');
    expect(chips).toHaveLength(1);
    expect(chips[0].className).toContain('text-[var(--sf-brass)]');
    expect(recommendedRows[0]).toHaveTextContent('Recommended');
  });

  it('keeps the prose fallback when only alternatives text exists', () => {
    const { container } = renderWithUser(<QuestionDetails {...props()} />);
    expect(screen.getByText('Alternatives')).toBeInTheDocument();
    expect(container.textContent).toContain('Use a 3 A fuse with a derated load.');
    expect(screen.queryByText('Recommended')).toBeNull();
    expect(screen.queryAllByRole('listitem', { name: /^Option / })).toHaveLength(0);
  });

  it('omits the section when neither options nor alternatives text exists', () => {
    const item = fullItem();
    item.meta = { topic: 'electrical', sections: { bluf: 'Use the 2 A slow-blow fuse.' } };
    const { container } = renderWithUser(<QuestionDetails {...props({ item })} />);
    expect(container.textContent).not.toContain('Alternatives');
    expect(screen.queryAllByRole('listitem', { name: /^Option / })).toHaveLength(0);
  });

  it('ignores a recommendation id that names no option', () => {
    const item = optionsItem();
    item.meta = {
      topic: 'electrical',
      sections: {
        ...item.meta?.sections,
        options: [
          { id: 'A', text: 'Use a 1.5 A fuse.' },
          { id: 'B', text: 'Use the 2 A slow-blow fuse.' }
        ],
        recommendation: 'Z'
      }
    };
    renderWithUser(<QuestionDetails {...props({ item })} />);
    expect(optionRows()).toHaveLength(2);
    expect(screen.queryByText('Recommended')).toBeNull();
  });
});
