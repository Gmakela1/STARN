import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import QuestionBadge from './QuestionBadge';

describe('QuestionBadge', () => {
  // ————— 1. Hidden state —————
  it('renders null when all counts are zero', () => {
    const { container } = render(
      <QuestionBadge
        count={0}
        queuedCount={0}
        blockingCount={0}
        resolvedCount={0}
        surface="closed"
        subdued={false}
        onOpen={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  // ————— 2. Full strip —————
  it('renders Needs Input, count pill, correct aria attributes, and fires onOpen on click', async () => {
    const onOpen = vi.fn();
    const { user } = renderWithUser(
      <QuestionBadge
        count={3}
        queuedCount={1}
        blockingCount={0}
        resolvedCount={0}
        surface="closed"
        subdued={false}
        onOpen={onOpen}
      />,
    );

    // "Needs Input" label present
    expect(screen.getByText('Needs Input')).toBeInTheDocument();

    // Count pill renders with the number
    expect(screen.getByText('3')).toBeInTheDocument();

    // Aria-label contains pending and queued counts
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute(
      'aria-label',
      'Open questions from AI, 3 pending, 1 queued',
    );

    // aria-expanded reflects surface === 'closed'
    expect(button).toHaveAttribute('aria-expanded', 'false');

    // aria-controls
    expect(button).toHaveAttribute('aria-controls', 'question-panel');

    // Click fires onOpen
    await user.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // ————— 3. Blocking state —————
  it('shows rose classes on pill and dot when blockingCount > 0, includes blocking in aria-label', () => {
    render(
      <QuestionBadge
        count={2}
        queuedCount={0}
        blockingCount={1}
        resolvedCount={0}
        surface="open"
        subdued={false}
        onOpen={() => {}}
      />,
    );

    const button = screen.getByRole('button');
    // aria-label includes blocking
    expect(button).toHaveAttribute(
      'aria-label',
      'Open questions from AI, 2 pending, 1 blocking',
    );

    // aria-expanded is true when surface === 'open'
    expect(button).toHaveAttribute('aria-expanded', 'true');

    // The count pill should contain rose classes
    const pill = screen.getByText('2');
    expect(pill.className).toContain('rose');
  });

  // ————— 4. Queued chip and resolved readout —————
  it('renders queued chip and resolved readout when respective counts are present', () => {
    render(
      <QuestionBadge
        count={2}
        queuedCount={3}
        blockingCount={0}
        resolvedCount={5}
        surface="closed"
        subdued={false}
        onOpen={() => {}}
      />,
    );

    // Queued chip renders count text
    expect(screen.getByText('3 queued')).toBeInTheDocument();

    // Resolved readout renders count text
    expect(screen.getByText('5 resolved')).toBeInTheDocument();
  });

  // ————— 5. Subdued (checkpoint) variant —————
  it('renders compact subdued line that is still operable and fires onOpen', async () => {
    const onOpen = vi.fn();
    const { user } = renderWithUser(
      <QuestionBadge
        count={1}
        queuedCount={0}
        blockingCount={0}
        resolvedCount={0}
        surface="closed"
        subdued={true}
        onOpen={onOpen}
      />,
    );

    // The subdued strip is a button
    const button = screen.getByRole('button');
    // It has the h-8 class (compact)
    expect(button.className).toContain('h-8');

    // It is operable: clicking fires onOpen
    await user.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // ————— 6. buttonRef (regression lock for BUG 2) —————
  it('passes buttonRef to the button element', () => {
    const ref: { current: HTMLButtonElement | null } = { current: null };
    render(
      <QuestionBadge
        count={1}
        queuedCount={0}
        blockingCount={0}
        resolvedCount={0}
        surface="closed"
        subdued={false}
        onOpen={() => {}}
        buttonRef={ref}
      />,
    );

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current).toBe(screen.getByRole('button'));
  });
});