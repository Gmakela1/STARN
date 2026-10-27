import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import QuestionBar from './QuestionBar';
import type { AnswerState, PortalItem } from '../types/api';

const openItem: PortalItem = {
  id: 'q1',
  type: 'question',
  severity: 'normal',
  docPath: 'docs/conops.md',
  title: 'Pick a voltage',
  detail: 'What voltage should the controller expect?',
  status: 'open',
  source: 'autopilot',
  createdAt: '2026-11-03T00:00:00Z',
  updatedAt: '2026-11-03T00:00:00Z',
};

function renderBar(answerStates: Record<string, AnswerState> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onDismiss = vi.fn().mockResolvedValue(undefined);
  render(
    <QuestionBar
      items={[openItem]}
      onSubmit={onSubmit}
      onDismiss={onDismiss}
      checkpointVisible={false}
      answerStates={answerStates}
    />
  );
  return { onSubmit, onDismiss };
}

/** Expand the collapsed bar first so the per-item cards (and their chips) render. */
function expand() {
  fireEvent.click(screen.getByText('Needs Input'));
}

describe('QuestionBar', () => {
  it('renders an amber Clock3 chip for a queued answer', () => {
    renderBar({ q1: { phase: 'queued' } });
    expand();
    const chip = screen.getByText('Queued — applies after this phase').closest('span') as HTMLElement;
    expect(chip).toHaveClass('text-amber-300');
    expect(chip.querySelector('svg')).not.toBeNull(); // Clock3 icon
  });

  it('renders a cyan spinning Loader2 chip while applying', () => {
    renderBar({ q1: { phase: 'applying' } });
    expand();
    const chip = screen.getByText('Applying…').closest('span') as HTMLElement;
    expect(chip).toHaveClass('text-cyan-300');
    const icon = chip.querySelector('svg') as SVGElement;
    expect(icon.classList.contains('animate-spin')).toBe(true);
  });

  it('renders an emerald Check chip once applied (after the 8s dwell releases)', () => {
    vi.useFakeTimers();
    renderBar({ q1: { phase: 'applied' } });
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expand();
    const chip = screen.getByText('Applied').closest('span') as HTMLElement;
    expect(chip).toHaveClass('text-emerald-300');
    expect(chip.querySelector('svg')).not.toBeNull(); // Check icon
    vi.useRealTimers();
  });

  it('renders a rose chip with a Retry affordance when applying failed', () => {
    renderBar({ q1: { phase: 'failed', error: 'boom' } });
    expand();
    const chip = screen.getByText("Couldn't apply").closest('span') as HTMLElement;
    expect(chip).toHaveClass('text-rose-300');
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders the collapsed-bar queued counter (queued + applying) with the Clock3 icon', () => {
    renderBar({ q1: { phase: 'queued' }, q2: { phase: 'applying' } });
    const badge = screen.getByText('2 queued');
    expect(badge).toHaveClass('text-amber-300');
    expect(badge.querySelector('svg')).not.toBeNull(); // Clock3 icon
  });

  it('suppresses aria-live announcements for pre-existing answer states on mount', () => {
    const { container } = render(
      <QuestionBar
        items={[openItem]}
        onSubmit={vi.fn()}
        onDismiss={vi.fn()}
        checkpointVisible={false}
        answerStates={{ q1: { phase: 'queued' } }}
      />
    );
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).toHaveClass('sr-only');
    expect(live?.textContent).toBe('');
  });
});