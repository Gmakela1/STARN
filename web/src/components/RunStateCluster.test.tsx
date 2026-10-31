import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RunStateCluster from './RunStateCluster';
import type { RunState } from '../lib/runState';

/**
 * RunStateCluster (design §5.H + §6).
 * Every state must carry a distinct icon AND a distinct word — never color
 * alone — plus an `aria-label` carrying the word so the icon choice is
 * verifiable. `data-run-state` keys the root for tests.
 */

const CASES: Array<{ state: RunState; word: string; aria: string; icon?: string }> = [
  { state: 'working', word: 'Working…', aria: 'Agents status: Working…', icon: 'svg.lucide-loader-circle' },
  {
    state: 'waiting',
    word: 'Waiting for your answer',
    aria: 'Agents status: Waiting for your answer',
    icon: 'svg.lucide-message-square',
  },
  { state: 'finished', word: 'Finished', aria: 'Agents status: Finished', icon: 'svg.lucide-circle-check' },
  { state: 'failed', word: 'Needs attention', aria: 'Agents status: Needs attention', icon: 'svg.lucide-triangle-alert' },
  { state: 'ready', word: 'Agents Ready', aria: 'Agents status: Agents Ready' },
];

describe('RunStateCluster', () => {
  it.each(CASES)('renders a distinct word, ARIA label and marker for $state', ({ state, word, aria, icon }) => {
    const { container } = render(<RunStateCluster runState={state} />);

    const root = container.querySelector(`[data-run-state="${state}"]`) as HTMLElement;
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('role', 'status');
    expect(root).toHaveAttribute('aria-label', aria);
    expect(screen.getByText(word)).toBeInTheDocument();

    if (icon) {
      expect(container.querySelector(icon)).not.toBeNull();
    }
  });

  it('renders the ready state as a plain dot (no icon)', () => {
    const { container } = render(<RunStateCluster runState="ready" />);
    expect(container.querySelector('span[class*="2c5e3b"]')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('spins the working marker and never pulses the ready state', () => {
    const { container, rerender } = render(<RunStateCluster runState="working" />);
    expect(container.querySelector('svg.lucide-loader-circle')?.getAttribute('class')).toContain(
      'motion-safe:animate-spin',
    );

    rerender(<RunStateCluster runState="ready" />);
    expect(container.querySelector('span[class*="2c5e3b"]')?.getAttribute('class')).not.toContain('animate-pulse');
  });

  it('renders only the status word: no phase chip, no step text, no separators', () => {
    const { container } = render(<RunStateCluster runState="working" />);
    const root = container.querySelector('[data-run-state="working"]') as HTMLElement;
    expect(root.textContent).toBe('Working…');
    expect(container.querySelector('[class*="bg-[#1a0208]"]')).toBeNull();
    expect(container.querySelector('[class*="max-w-[180px]"]')).toBeNull();
  });

  it('keeps the failed detail as the only text', () => {
    const { container } = render(<RunStateCluster runState="failed" detail="2 documents parked" />);
    const root = container.querySelector('[data-run-state="failed"]') as HTMLElement;
    expect(root.textContent).toBe('2 documents parked');
  });

  it('renders the failed detail instead of the generic word, with a tooltip and aria-label', () => {
    render(
      <RunStateCluster runState="failed" detail="2 documents parked" detailTitle="Autopilot parked 2 documents" />,
    );
    const root = screen.getByRole('status');
    expect(root).toHaveAttribute('aria-label', 'Agents status: 2 documents parked');
    expect(screen.getByText('2 documents parked')).toHaveAttribute('title', 'Autopilot parked 2 documents');
    expect(screen.queryByText('Needs attention')).toBeNull();
  });

  it('falls back to Needs attention when failed has no detail', () => {
    render(<RunStateCluster runState="failed" />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Agents status: Needs attention');
  });

  it('ignores detail for non-failed states', () => {
    render(<RunStateCluster runState="working" detail="2 documents parked" />);
    expect(screen.getByText('Working…')).toBeInTheDocument();
    expect(screen.queryByText('2 documents parked')).toBeNull();
  });
});
