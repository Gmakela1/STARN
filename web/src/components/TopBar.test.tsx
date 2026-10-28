import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import { TopBar } from './TopBar';
import type { TopBarProps } from './TopBar';
import type { ProjectInfo } from '../types/api';

/**
 * TopBar (design §5.G + §5.E + §5.H).
 * ONE 56px header: brand · tablist · run-state cluster. The cluster is
 * shrink-0 and always visible — never inside the overflow region.
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

function setup(overrides: Partial<TopBarProps> = {}) {
  const onSelectTab = vi.fn();
  const onToggleMobileMenu = vi.fn();
  const props: TopBarProps = {
    project,
    tab: 'development',
    onSelectTab,
    runState: 'ready',
    connected: true,
    openQuestions: 0,
    mobileMenuOpen: false,
    onToggleMobileMenu,
    ...overrides,
  };
  return { ...renderWithUser(<TopBar {...props} />), onSelectTab, onToggleMobileMenu };
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

  it('shows no hub badge when there are no open questions', () => {
    setup({ openQuestions: 0 });
    const devTab = screen.getByRole('tab', { name: /Engineering Studio/ });
    expect(within(devTab).queryByText('0')).toBeNull();
  });

  it('shows the needs-input count badge on the Engineering Studio tab', () => {
    setup({ openQuestions: 2 });
    const devTab = screen.getByRole('tab', { name: 'Engineering Studio, 2 needs input' });
    expect(within(devTab).getByText('2')).toBeInTheDocument();
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
    ...overrides,
  };
}
