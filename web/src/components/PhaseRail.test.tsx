import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import PhaseRail from './PhaseRail';
import { PhaseRailView, RailState } from '../lib/workflowState';

// Design §5.F + §5.G + §6 — 5-state rail with per-dot buttons, aria-current,
// legend popover, sr-only count/legend, and narrow summary-chip compaction.

const STATE_LABELS: Record<RailState, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  drafted: 'Drafted — awaiting review',
  'needs-review': 'Completed — needs approval',
  approved: 'Approved',
  'error-parked': 'Error — needs attention',
};

const rv = (state: RailState, over: Partial<PhaseRailView> = {}): PhaseRailView => ({
  state,
  auto: false,
  locked: false,
  label: STATE_LABELS[state],
  ...over,
});

const PHASE_NAMES = [
  'CONOPS', 'Architecture', 'ICD', 'Capabilities', 'Requirements', 'BOM', 'RTM',
  'Milestones', 'Risk', 'Build Seq', 'WI', 'Test Plans', 'SOW',
];

// 13 items: 6 approved, 1 in-progress (active), 6 not-started.
function buildItems(overrides: Array<Partial<PhaseRailView> & { id?: string; name?: string; isActive?: boolean }> = []) {
  const items = PHASE_NAMES.map((name, i) => {
    const view = i < 6 ? rv('approved') : i === 6 ? rv('in-progress') : rv('not-started');
    return { id: `p${i}`, name, view, isActive: i === 6 };
  });
  return items.map((item, i) => ({ ...item, ...(overrides[i] ?? {}) })) as Array<{
    id: string;
    name: string;
    view: PhaseRailView;
    isActive: boolean;
  }>;
}

function getPopover(toggle: HTMLElement): HTMLElement {
  const id = toggle.getAttribute('aria-controls');
  expect(id).not.toBeNull();
  return document.getElementById(id!)!;
}

describe('PhaseRail', () => {
  it('renders 13 dots as list items in the rail', () => {
    const { container } = render(<PhaseRail items={buildItems()} approvedCount={6} onSelect={vi.fn()} />);
    const rail = container.querySelector('ol[role="list"]')!;
    expect(rail.querySelectorAll('li')).toHaveLength(13);
    expect(container.querySelector('[role="group"]')).toHaveAttribute('aria-label', 'Build phases');
  });

  it('marks exactly one dot with aria-current="step"', () => {
    const { container } = render(<PhaseRail items={buildItems()} approvedCount={6} onSelect={vi.fn()} />);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'RTM — In progress' })).toHaveAttribute('aria-current', 'step');
  });

  it('labels every dot with its phase name and state label', () => {
    const items = buildItems();
    render(<PhaseRail items={items} approvedCount={6} onSelect={vi.fn()} />);
    for (const item of items) {
      expect(screen.getByRole('button', { name: `${item.name} — ${item.view.label}` })).toBeInTheDocument();
    }
  });

  it('toggles a legend popover listing all five state labels', async () => {
    const { user } = renderWithUser(<PhaseRail items={buildItems()} approvedCount={6} onSelect={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Show phase state legend' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const popover = getPopover(toggle);
    for (const label of Object.values(STATE_LABELS)) {
      expect(within(popover).getByText(label)).toBeInTheDocument();
    }
  });

  it('calls onSelect with the clicked dot id', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithUser(<PhaseRail items={buildItems()} approvedCount={6} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'RTM — In progress' }));
    expect(onSelect).toHaveBeenCalledWith('p6');
  });

  it('renders the sr-only count and the sr-only legend vocabulary', () => {
    const { container } = render(<PhaseRail items={buildItems()} approvedCount={6} onSelect={vi.fn()} />);
    expect(screen.getByText('6 of 13 approved')).toBeInTheDocument();
    const srLegend = container.querySelector('ul[aria-label="Phase state legend"]')!;
    expect(srLegend.querySelectorAll('li')).toHaveLength(6);
    expect(srLegend.className).toContain('sr-only');
  });

  it('shows the summary chip in narrow mode with the full dot list + legend inside the popover', async () => {
    const { user } = renderWithUser(<PhaseRail items={buildItems()} approvedCount={6} narrow onSelect={vi.fn()} />);
    expect(screen.getByText('6/13 · RTM')).toBeInTheDocument();

    const chip = screen.getByRole('button', { name: /6\/13/ });
    await user.click(chip);
    const popover = getPopover(chip);
    expect(popover.querySelectorAll('ol[role="list"] li')).toHaveLength(13);
    for (const label of Object.values(STATE_LABELS)) {
      expect(within(popover).getByText(label)).toBeInTheDocument();
    }
  });

  it('renders a locked sub-flag affordance in the label', () => {
    const items = buildItems();
    items[0] = {
      ...items[0],
      view: rv('not-started', { locked: true, label: 'Locked — reopen the upstream document' }),
    };
    render(<PhaseRail items={items} approvedCount={6} onSelect={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'CONOPS — Locked — reopen the upstream document' }),
    ).toBeInTheDocument();
  });

  // Design §6 — needs-review dot: violet family + Eye icon + word in legend
  // (never color alone).
  it('renders the needs-review dot with an Eye icon in violet, distinct from in-progress crimson', () => {
    const items = buildItems();
    items[0] = { ...items[0], view: rv('needs-review') };
    render(<PhaseRail items={items} approvedCount={6} onSelect={vi.fn()} />);

    const dot = screen.getByRole('button', { name: 'CONOPS — Completed — needs approval' });
    expect(dot).toBeInTheDocument();
    const marker = dot.querySelector('svg.lucide-eye');
    expect(marker).not.toBeNull();
    // violet family — same hue family, different shade than approved forest green
    expect(dot.querySelector('span')!.className).toContain('violet');
    // distinct icon from in-progress (Loader2 spinner) and drafted (Hourglass)
    expect(dot.querySelector('.lucide-loader-circle')).toBeNull();
    expect(dot.querySelector('.lucide-hourglass')).toBeNull();
  });

  it('lists the needs-review label in the legend with its icon', async () => {
    const { user } = renderWithUser(<PhaseRail items={buildItems()} approvedCount={6} onSelect={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Show phase state legend' });
    await user.click(toggle);
    const popover = getPopover(toggle);
    expect(within(popover).getByText('Completed — needs approval')).toBeInTheDocument();
    // icon rendered next to the word (shape + word, not color alone)
    const row = within(popover).getByText('Completed — needs approval').closest('li')!;
    expect(row.querySelector('svg')).not.toBeNull();
  });
});