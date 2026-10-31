import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import { TopBar } from './TopBar';
import type { TopBarProps } from './TopBar';
import type { ProjectInfo, RoadmapPhase } from '../types/api';

/**
 * TopBar (design §5.G + §5.E + §5.H).
 * ONE 56px header: brand · tablist · DocProgressBar · run-state cluster.
 */

const project = {
  id: 'p1',
  name: 'Tractor Project',
  activePhase: 'SS-01',
  summary: '',
  summarySource: 'none',
  openQuestionsCount: 0,
  openRisksCount: 0,
  models: { agent: 'gpt' },
  financials: { totalEstimated: 0, totalActual: 0, netVariance: 0, procurementProgressPercent: 0 },
} as ProjectInfo;

const defaultPhases: RoadmapPhase[] = [
  { id: 'SS-01', name: 'SS-01', status: 'COMPLETED', artifactPath: '', contentHash: null, docExists: false, openQuestions: 0 },
];

function setup(overrides: Partial<TopBarProps> = {}) {
  const onSelectTab = vi.fn();
  const onToggleMobileMenu = vi.fn();
  const onNavigateToDashboard = vi.fn();
  const props: TopBarProps = {
    project,
    tab: 'development',
    onSelectTab,
    runState: 'ready',
    connected: true,
    openQuestions: 0,
    mobileMenuOpen: false,
    onToggleMobileMenu,
    progressPhases: defaultPhases,
    progressDocStatus: {},
    progressTotalPhases: 13,
    onNavigateToDashboard,
    ...overrides,
  };
  return { ...renderWithUser(<TopBar {...props} />), onSelectTab, onToggleMobileMenu, onNavigateToDashboard };
}

describe('TopBar', () => {
  it('renders exactly one 56px header element', () => {
    const { container } = setup();
    const headers = container.querySelectorAll('header');
    expect(headers).toHaveLength(1);
    expect(headers[0].className).toContain('h-14');
  });

  it('renders the STARN brand and project name, with a connecting placeholder', () => {
    const { rerender } = renderWithUser(<TopBar {...baseProps()} />);
    expect(screen.getByRole('heading', { name: 'STARN' })).toBeInTheDocument();
    expect(screen.getByText('Tractor Project')).toBeInTheDocument();

    rerender(<TopBar {...baseProps({ project: null })} />);
    expect(screen.getByText('Connecting to project…')).toBeInTheDocument();
  });

  it('renders five tabs inside the tablist, each with aria-selected', () => {
    setup({ tab: 'roadmap' });
    const tablist = screen.getByRole('tablist', { name: 'Maker Lifecycle Hubs' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    tabs.forEach(tab => expect(tab).toHaveAttribute('aria-selected'));

    const selected = tabs.filter(tab => tab.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAccessibleName(/Roadmap/);
  });

  it('calls onSelectTab with the hub id on click', async () => {
    const { user, onSelectTab } = setup();
    await user.click(screen.getByRole('tab', { name: /Roadmap/ }));
    expect(onSelectTab).toHaveBeenCalledWith('roadmap');
  });

  it('renders the hub tagline as title + aria-label only, never visible text', () => {
    setup();
    expect(screen.queryByText('Collaborative AI Workbench')).toBeNull();
    const devTab = screen.getByRole('tab', { name: /Engineering Studio/ });
    expect(devTab).toHaveAttribute('title', 'Collaborative AI Workbench');
    expect(devTab).toHaveAccessibleName(/Collaborative AI Workbench/);
  });

  it('renders the run-state cluster with data-run-state', () => {
    setup({ runState: 'waiting' });
    const cluster = screen.getByRole('status');
    expect(cluster).toHaveAttribute('data-run-state', 'waiting');
    expect(screen.getByText('Waiting for your answer')).toBeInTheDocument();
  });

  it('keeps the cluster outside the tablist, in a shrink-0 container', () => {
    setup();
    const cluster = screen.getByRole('status');
    expect(cluster.closest('[role="tablist"]')).toBeNull();
    expect(cluster.parentElement?.className).toContain('shrink-0');
  });

  it('renders DocProgressBar as a progressbar in the right section', () => {
    setup();
    const bar = screen.getByRole('progressbar');
    expect(bar).toBeInTheDocument();
    // Should be outside the tablist
    expect(bar.closest('[role="tablist"]')).toBeNull();
  });

  it('stacks the header above page content (z-40, relative)', () => {
    const { container } = setup();
    const cls = container.querySelector('header')?.className ?? '';
    expect(cls).toContain('relative');
    expect(cls).toContain('z-40');
  });

  it('renders no document-name chips: neither the active phase nor a run-state phase/step', () => {
    // project.activePhase is 'SS-01'; the old pill / cluster chip rendered it.
    setup();
    expect(screen.queryByText('SS-01')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Agents Ready');
  });

  it('compact brand block: h-7 w-7 logo box, 11px wordmark and project name with title', () => {
    const { container } = setup();
    const logo = container.querySelector('header svg.lucide-satellite') as SVGElement;
    expect(logo.getAttribute('class')).toContain('h-4');
    expect(logo.getAttribute('class')).toContain('w-4');
    const box = logo.parentElement as HTMLElement;
    expect(box.className).toContain('h-7');
    expect(box.className).toContain('w-7');
    expect(box.className).not.toContain('h-9');
    expect(screen.getByRole('heading', { name: 'STARN' }).className).toContain('text-[11px]');
    const name = screen.getByText('Tractor Project');
    expect(name.className).toContain('text-[11px]');
    expect(name.className).toContain('max-w-[120px]');
    expect(name.className).toContain('xl:max-w-[200px]');
    expect(name.className).toContain('truncate');
    expect(name).toHaveAttribute('title', 'Tractor Project');
  });

  it('tabs never shrink or clip: every tab is shrink-0 + nowrap, tab list is min-w-0 flex-1', () => {
    setup();
    const tablist = screen.getByRole('tablist');
    expect(tablist.className).toContain('min-w-0');
    expect(tablist.className).toContain('flex-1');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    tabs.forEach(tab => {
      expect(tab.className).toContain('shrink-0');
      expect(tab.className).toContain('px-2');
      expect(tab.className).toContain('py-1.5');
      expect(tab.className).toContain('text-xs');
    });
    expect(tablist.className).toContain('gap-1');
    expect(tablist.className).not.toContain('overflow-hidden');
  });

  it('right cluster is shrink-0 so it never overlaps the tabs', () => {
    setup();
    const cluster = screen.getByRole('progressbar').closest('[class*="shrink-0"]') as HTMLElement;
    expect(cluster).not.toBeNull();
    expect(cluster.closest('[role="tablist"]')).toBeNull();
  });

  it('shows the Docs label next to the progress bar in the top bar', () => {
    setup({ progressDocStatus: { 'SS-01': 'passed' } });
    expect(screen.getByText('Docs 1/13')).toBeInTheDocument();
  });

  it('forwards failed detail to the run-state cluster', () => {
    setup({ runState: 'failed', runDetail: '2 documents parked' });
    expect(screen.getByText('2 documents parked')).toBeInTheDocument();
  });

  it('reflects mobileMenuOpen on the hamburger and fires the toggle', async () => {
    const { user, onToggleMobileMenu } = setup({ mobileMenuOpen: false });
    const button = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(onToggleMobileMenu).toHaveBeenCalledTimes(1);
  });

  it('shows the close label when the drawer is open', () => {
    setup({ mobileMenuOpen: true });
    expect(screen.getByRole('button', { name: 'Close navigation menu' })).toHaveAttribute('aria-expanded', 'true');
  });

  describe('open-questions pill', () => {
    it('shows the count on the Engineering Studio tab only', () => {
      setup({ openQuestions: 3 });
      const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
      const withPill = tabs.filter(tab => tab.textContent?.includes('3'));
      expect(withPill).toHaveLength(1);
      expect(withPill[0]).toHaveAttribute('title', 'Collaborative AI Workbench');
      const pill = within(withPill[0]).getByText('3');
      expect(pill).toHaveAttribute('aria-hidden', 'true');
      expect(pill.className).toContain('bg-amber-500/20');
    });

    it('is not rendered on the other tabs', () => {
      setup({ openQuestions: 3 });
      const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
      const others = tabs.filter(tab => !/Engineering Studio/.test(tab.getAttribute('aria-label') ?? ''));
      expect(others).toHaveLength(4);
      others.forEach(tab => expect(tab.querySelector('[class*="bg-amber-500"]')).toBeNull());
    });

    it('is hidden when there are no open questions', () => {
      setup({ openQuestions: 0 });
      const devTab = screen.getByRole('tab', { name: /Engineering Studio/ });
      expect(devTab.querySelector('[class*="bg-amber-500"]')).toBeNull();
      expect(devTab).toHaveAttribute('aria-label', 'Engineering Studio — Collaborative AI Workbench');
    });

    it('includes the count in the tab aria-label', () => {
      setup({ openQuestions: 3 });
      expect(screen.getByRole('tab', { name: 'Engineering Studio, 3 needs input' })).toBeInTheDocument();
    });

    it('caps the displayed count at 99+', () => {
      setup({ openQuestions: 150 });
      const devTab = screen.getByRole('tab', { name: /Engineering Studio/ });
      expect(within(devTab).getByText('99+')).toBeInTheDocument();
      expect(screen.queryByText('150')).toBeNull();
    });

    it('shows 99 uncapped at the boundary', () => {
      setup({ openQuestions: 99 });
      expect(screen.getByText('99')).toBeInTheDocument();
    });

    it('stays visible in icon-only mode (not wrapped in an xl-only class)', () => {
      setup({ openQuestions: 3 });
      const pill = screen.getByText('3');
      expect(pill.className).not.toMatch(/hidden/);
      expect(pill.closest('[class*="hidden xl:inline"]')).toBeNull();
    });
  });

  it('shows the Reconnecting badge only when disconnected', () => {
    const { rerender } = renderWithUser(<TopBar {...baseProps()} />);
    expect(screen.queryByText('Reconnecting…')).toBeNull();

    rerender(<TopBar {...baseProps({ connected: false })} />);
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });
});

function baseProps(overrides: Partial<TopBarProps> = {}): TopBarProps {
  return {
    project,
    tab: 'development',
    onSelectTab: vi.fn(),
    runState: 'ready',
    connected: true,
    openQuestions: 0,
    mobileMenuOpen: false,
    onToggleMobileMenu: vi.fn(),
    progressPhases: defaultPhases,
    progressDocStatus: {},
    progressTotalPhases: 13,
    onNavigateToDashboard: vi.fn(),
    ...overrides,
  };
}