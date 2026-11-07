import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { cleanup, renderWithUser } from '../../test/render';
import QuestionContextHeader, { type QuestionContextHeaderProps } from './QuestionContextHeader';
import type { PortalItem } from '../../types/api';

afterEach(() => cleanup());

/** Fully-populated question: topic, requirement id in the detail, BLUF. */
function question(overrides: Partial<PortalItem> = {}): PortalItem {
  return {
    id: 'opaque-portal-id',
    type: 'question',
    severity: 'normal',
    status: 'open',
    source: 'autopilot',
    title: '**Fuse selectivity** for the 48 V rail',
    detail: 'The rail feeds the charger — SS-04.e asks whether the 2 A fuse coordinates.',
    docPath: 'docs/RTM.md',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    meta: { topic: 'electrical', sections: { bluf: 'Use the 2 A slow-blow fuse.' } },
    ...overrides
  };
}

function props(overrides: Partial<QuestionContextHeaderProps> = {}): QuestionContextHeaderProps {
  return {
    item: question(),
    pagerIndex: 3,
    total: 13,
    onOpenDetails: vi.fn(),
    selectedDocName: 'RTM.md',
    ...overrides
  };
}

describe('QuestionContextHeader — meta row', () => {
  it('renders the topic as a text tag', () => {
    renderWithUser(<QuestionContextHeader {...props()} />);
    expect(screen.getByText('electrical')).toBeInTheDocument();
  });

  it('omits the topic tag when meta.topic is absent', () => {
    const { container } = renderWithUser(
      <QuestionContextHeader {...props({ item: question({ meta: {} }) })} />
    );
    expect(container.textContent).not.toContain('electrical');
  });

  it('shows the pager position, never a Q-number', () => {
    const { container } = renderWithUser(<QuestionContextHeader {...props()} />);
    expect(screen.getByText(/3 of 13/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bQ\d/);
  });

  it('shows "from <doc> · <requirement id>"', () => {
    renderWithUser(<QuestionContextHeader {...props()} />);
    expect(screen.getByText('RTM.md')).toBeInTheDocument();
    expect(screen.getByText(/· SS-04\.e/)).toBeInTheDocument();
  });

  it('shows only the doc name when no requirement id is present', () => {
    const { container } = renderWithUser(
      <QuestionContextHeader
        {...props({
          item: question({ title: 'Is the fuse rated?', detail: 'No reference here.' })
        })}
      />
    );
    expect(screen.getByText('RTM.md')).toBeInTheDocument();
    expect(container.textContent).not.toContain('·');
  });
});

describe('QuestionContextHeader — Details button', () => {
  it('fires onOpenDetails and its accessible name is exactly "Details"', async () => {
    const onOpenDetails = vi.fn();
    const { user } = renderWithUser(<QuestionContextHeader {...props({ onOpenDetails })} />);
    const button = screen.getByRole('button', { name: 'Details' });
    await user.click(button);
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });
});

describe('QuestionContextHeader — title and BLUF', () => {
  it('renders the cleaned title clamped to 2 lines (never truncate)', () => {
    renderWithUser(<QuestionContextHeader {...props()} />);
    const title = screen.getByRole('heading', { level: 2 });
    expect(title).toHaveTextContent('Fuse selectivity for the 48 V rail');
    expect(title.className).toContain('line-clamp-2');
    expect(title.className).not.toContain('truncate');
  });

  it('shows the BLUF label and text when sections.bluf exists', () => {
    renderWithUser(<QuestionContextHeader {...props()} />);
    expect(screen.getByText('BLUF')).toBeInTheDocument();
    expect(screen.getByText(/Use the 2 A slow-blow fuse\./)).toBeInTheDocument();
  });

  it('renders no BLUF element at all (no placeholder, no box) when sections are absent', () => {
    const { container } = renderWithUser(
      <QuestionContextHeader {...props({ item: question({ meta: { topic: 'electrical' } }) })} />
    );
    expect(screen.queryByText('BLUF')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(container.textContent).not.toContain('No BLUF');
  });
});
