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
  { state: 'working', word: 'Working…', aria: 'Agent status: Working…', icon: 'svg.lucide-loader-circle' },
  {
    state: 'waiting',
    word: 'Waiting for your answer',
    aria: 'Agent status: Waiting for your answer',
    icon: 'svg.lucide-message-square',
  },
  { state: 'finished', word: 'Finished', aria: 'Agent status: Finished', icon: 'svg.lucide-circle-check' },
  { state: 'failed', word: 'Needs attention', aria: 'Agent status: Needs attention', icon: 'svg.lucide-triangle-alert' },
  { state: 'ready', word: 'AI Ready', aria: 'Agent status: AI Ready' },
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
    expect(container.querySelector('span.h-2.w-2.rounded-full.bg-emerald-400')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('spins the working marker and never pulses the ready state', () => {
    const { container, rerender } = render(<RunStateCluster runState="working" />);
    expect(container.querySelector('svg.lucide-loader-circle')?.getAttribute('class')).toContain(
      'motion-safe:animate-spin',
    );

    rerender(<RunStateCluster runState="ready" />);
    expect(container.querySelector('span.bg-emerald-400')?.getAttribute('class')).not.toContain('animate-pulse');
  });

  it('renders the phase chip only when a phase is provided', () => {
    const { rerender } = render(<RunStateCluster runState="working" />);
    expect(screen.queryByText('SS-09')).toBeNull();

    rerender(<RunStateCluster runState="working" phase="SS-09" />);
    const chip = screen.getByText('SS-09');
    expect(chip.className).toContain('bg-cyan-950/60');
    expect(chip.className).toContain('text-cyan-300');
    expect(chip.className).toContain('uppercase');
  });

  it('renders the step with truncation only when non-empty', () => {
    const { rerender } = render(<RunStateCluster runState="working" step={null} />);
    expect(screen.queryByText('Drafting the system spec')).toBeNull();

    rerender(<RunStateCluster runState="working" step="Drafting the system spec" />);
    const step = screen.getByText('Drafting the system spec');
    expect(step.className).toContain('truncate');
    expect(step.className).toContain('max-w-[180px]');
  });

  it('omits the step when it is an empty string', () => {
    const { container } = render(<RunStateCluster runState="working" step="" />);
    expect(container.querySelector('[class*="max-w-[180px]"]')).toBeNull();
  });

  it('orders label, then phase chip, then step', () => {
    const { container } = render(<RunStateCluster runState="working" phase="SS-09" step="Drafting" />);
    const text = container.querySelector('[data-run-state="working"]')?.textContent ?? '';
    const iLabel = text.indexOf('Working…');
    const iPhase = text.indexOf('SS-09');
    const iStep = text.indexOf('Drafting');
    expect(iLabel).toBeGreaterThanOrEqual(0);
    expect(iPhase).toBeGreaterThan(iLabel);
    expect(iStep).toBeGreaterThan(iPhase);
    expect(text).toContain('·');
  });
});
