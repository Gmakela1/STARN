import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import DashboardView from './DashboardView';
import type { DashboardData, PortalItem } from '../types/api';

/**
 * DashboardView design §5.E (Workstream D).
 * "Open Actions" needs-input rows are real buttons that deep-link into the
 * studio: clicking a row calls `onOpenQuestion(item.id)` — carrying the item
 * id, not just a tab name. Rows render a provenance line + relative timestamp,
 * and J/K move focus between rows (guarded for typing elements).
 */

vi.mock('../api/client', () => ({
  api: {
    fetchDashboard: vi.fn()
  }
}));

import { api } from '../api/client';

const fetchDashboardMock = vi.mocked(api.fetchDashboard);

/** createdAt 2.5h in the past — renders as "2h ago" regardless of run skew. */
function buildItem(overrides: Partial<PortalItem> = {}): PortalItem {
  return {
    id: 'q-1',
    type: 'question',
    severity: 'normal',
    title: 'What operating voltage does the traction motor require?',
    docPath: 'conops/REQUIREMENTS.md',
    status: 'open',
    source: 'autopilot',
    createdAt: new Date(Date.now() - 150 * 60000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function buildData(items: PortalItem[]): DashboardData {
  return {
    project: {
      id: 'p1',
      name: 'Tractor Project',
      activePhase: 'SS-01',
      summary: 'Traction drive system for the field tractor.',
      summarySource: 'conops',
      openQuestionsCount: items.length,
      openRisksCount: 0,
      models: { agent: 'gpt' },
      financials: { totalEstimated: 0, totalActual: 0, netVariance: 0, procurementProgressPercent: 0 }
    },
    roadmap: [],
    issues: [],
    recentActions: [],
    documents: [],
    portalSummary: {
      blocking: 0,
      parked: 0,
      questions: items.length,
      flags: 0,
      topItems: items
    }
  };
}

beforeEach(() => {
  fetchDashboardMock.mockReset();
});

describe('DashboardView needs-input rows (design §5.E)', () => {
  it('calls onOpenQuestion with the item id when a needs-input row is clicked — not a tab switch', async () => {
    fetchDashboardMock.mockResolvedValue(buildData([buildItem({ id: 'q-7' })]));
    const onOpenQuestion = vi.fn();
    const onNavigate = vi.fn();
    const { user } = renderWithUser(
      <DashboardView onNavigate={onNavigate} onOpenQuestion={onOpenQuestion} />
    );

    const row = await screen.findByRole('button', { name: /What operating voltage/i });
    await user.click(row);

    expect(onOpenQuestion).toHaveBeenCalledWith('q-7');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('renders the provenance line and a relative timestamp on each row', async () => {
    fetchDashboardMock.mockResolvedValue(
      buildData([buildItem({ docPath: 'conops/REQUIREMENTS.md' })])
    );
    renderWithUser(<DashboardView />);

    const provenance = await screen.findByText((content, el) =>
      el?.tagName === 'DIV' && content.includes('STARN · needs input · REQUIREMENTS.md')
    );
    expect(provenance.textContent).toContain('needs input');
    expect(provenance.textContent).toContain('REQUIREMENTS.md');
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('falls back to onNavigate(development) when onOpenQuestion is not provided', async () => {
    fetchDashboardMock.mockResolvedValue(buildData([buildItem({ id: 'q-1' })]));
    const onNavigate = vi.fn();
    const { user } = renderWithUser(<DashboardView onNavigate={onNavigate} />);

    const row = await screen.findByRole('button', { name: /What operating voltage/i });
    await user.click(row);

    expect(onNavigate).toHaveBeenCalledWith('development');
  });

  it('renders the row inside list semantics so keyboard users get one button per item', async () => {
    fetchDashboardMock.mockResolvedValue(buildData([buildItem(), buildItem({ id: 'q-2' })]));
    const { container } = renderWithUser(<DashboardView />);

    const list = await screen.findByRole('list');
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(list.querySelectorAll('button')).toHaveLength(2);
  });

  it('moves focus between rows with J and K', async () => {
    fetchDashboardMock.mockResolvedValue(
      buildData([
        buildItem({ id: 'q-1', title: 'First question' }),
        buildItem({ id: 'q-2', title: 'Second question' })
      ])
    );
    const { user } = renderWithUser(<DashboardView />);

    const rows = await screen.findAllByRole('button', { name: /question/i });
    expect(rows).toHaveLength(2);

    rows[0].focus();
    await user.keyboard('[KeyJ]');
    expect(rows[1]).toHaveFocus();

    await user.keyboard('[KeyK]');
    expect(rows[0]).toHaveFocus();
  });

  it('ignores J/K when the key event originates from a typing element', async () => {
    fetchDashboardMock.mockResolvedValue(
      buildData([
        buildItem({ id: 'q-1', title: 'First question' }),
        buildItem({ id: 'q-2', title: 'Second question' })
      ])
    );
    const { user } = renderWithUser(<DashboardView />);

    const list = await screen.findByRole('list');
    const input = document.createElement('input');
    list.appendChild(input);
    input.focus();
    expect(input).toHaveFocus();

    await user.keyboard('[KeyJ]');
    expect(input).toHaveFocus();
  });

  it('renders the decorative Galaxy layer on a non-scrolling parent, behind the scroll container', async () => {
    fetchDashboardMock.mockResolvedValue(buildData([buildItem()]));
    const { container } = renderWithUser(<DashboardView />);

    // Wait for data to land so the full (non-loading) tree is mounted.
    await screen.findByRole('list');

    // Wrapper exists, is aria-hidden decoration, and hosts the Galaxy canvas.
    const layer = container.querySelector('[data-testid="galaxy-layer"]');
    expect(layer).not.toBeNull();
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer?.querySelector('canvas')).not.toBeNull();

    // Scroll fix: wrapper is a sibling of (not inside) the scrolling pane,
    // so the canvas resolves to viewport height instead of padding-box height.
    const scroller = layer?.nextElementSibling as HTMLElement | null;
    expect(scroller?.className).toContain('overflow-y-auto');
    expect(scroller?.className).not.toContain('bg-');
  });
});