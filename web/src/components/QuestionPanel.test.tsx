import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { cleanup, renderWithUser } from '../test/render';
import QuestionPanel, { type QuestionPanelProps } from './QuestionPanel';
import type { PortalItem } from '../types/api';

afterEach(() => {
  cleanup();
});

/** Minimal valid PortalItem fixture. */
function makeItem(overrides: Partial<PortalItem> = {}): PortalItem {
  const base: PortalItem = {
    id: 'A',
    type: 'question',
    severity: 'normal',
    title: 'Question A',
    status: 'open',
    source: 'autopilot',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

/** Base props — every test overrides what it needs. Mocks are per-call fresh. */
function baseProps(overrides: Partial<QuestionPanelProps> = {}): QuestionPanelProps {
  return {
    surface: 'open',
    items: [makeItem()],
    answerStates: {},
    onSubmit: vi.fn(async () => {}),
    onDismiss: vi.fn(async () => {}),
    onResume: vi.fn(async () => {}),
    onEditDoc: vi.fn(),
    onExpand: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('QuestionPanel', () => {
  // ————— 1. BUG 1 regression: minimized strip Expand must call onExpand —————
  it('minimized: "Expand questions" calls onExpand', async () => {
    const props = baseProps({ surface: 'minimized' });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    const expandBtn = screen.getByRole('button', { name: 'Expand questions' });
    await user.click(expandBtn);

    expect(props.onExpand).toHaveBeenCalledTimes(1);
  });

  it('minimized: shows active title and "Close questions" calls onClose', async () => {
    const item = makeItem({ id: 'A', title: 'Question A' });
    const props = baseProps({ surface: 'minimized', items: [item] });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    // Region is present in the dock strip
    expect(screen.getByRole('region', { name: 'Questions from AI' })).toBeInTheDocument();

    // Active item title renders in the strip
    expect(screen.getByText('Question A')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: 'Close questions' });
    await user.click(closeBtn);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  // ————— 3. Open surface structure —————
  it('open: renders region with id/aria-label; header has only a Close button', async () => {
    const props = baseProps();
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    const region = screen.getByRole('region', { name: 'Questions from AI' });
    expect(region).toHaveAttribute('id', 'question-panel');

    expect(screen.queryByRole('button', { name: /minimize/i })).not.toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: 'Close questions' });
    await user.click(closeBtn);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  // ————— 4. Composer submit —————
  it('open: typing + Enter submits the trimmed text with the item id', async () => {
    const props = baseProps();
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    const textarea = screen.getByLabelText('Your answer');
    await user.type(textarea, '  my answer  ');
    await user.keyboard('{Enter}');

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith('A', 'my answer');
  });

  it('open: Shift+Enter does not submit and keeps the draft', async () => {
    const props = baseProps();
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    const textarea = screen.getByLabelText('Your answer');
    await user.type(textarea, 'keep me');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(props.onSubmit).not.toHaveBeenCalled();
    // Shift+Enter inserts a newline natively (no preventDefault on the shift
    // path) and the draft must be preserved — assert it was not cleared.
    expect((textarea as HTMLTextAreaElement).value).toContain('keep me');
  });

  it('open: Enter while composing (IME) does not submit', () => {
    const props = baseProps();
    renderWithUser(<QuestionPanel {...props} />);

    const textarea = screen.getByLabelText('Your answer');
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  // ————— 5. Composer disabled while queued/applying —————
  it.each(['queued', 'applying'] as const)(
    'open: composer disabled while phase is %s',
    (phase) => {
      const props = baseProps({ answerStates: { A: { phase } } });
      renderWithUser(<QuestionPanel {...props} />);
      expect(screen.getByLabelText('Your answer')).toBeDisabled();
    },
  );

  // ————— 6. Escape handler —————
  it('open + empty draft: Escape calls onClose', () => {
    const props = baseProps();
    renderWithUser(<QuestionPanel {...props} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('open + non-empty draft: Escape clears the draft, does not call onClose', async () => {
    const props = baseProps();
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    const textarea = screen.getByLabelText('Your answer');
    await user.type(textarea, 'draft text');
    expect((textarea as HTMLTextAreaElement).value).toBe('draft text');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect((textarea as HTMLTextAreaElement).value).toBe('');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('minimized: Escape does nothing', () => {
    const props = baseProps({ surface: 'minimized' });
    renderWithUser(<QuestionPanel {...props} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onExpand).not.toHaveBeenCalled();
  });

  // ————— 7. renderDetail bullets + "Show full question" —————
  it('open: long detail renders 3 bullets with +N more and toggles full text', async () => {
    const longDetail = [
      'The widget under test exposes three call sites to the parser.',
      'Two of those pathways are already covered by integration tests.',
      'The third path is only exercised when the throttle is engaged.',
      'A fourth observation about the cold-start behavior in the harness.',
      'A fifth detail about the final verification step in the sequence.',
    ].join(' ');
    const props = baseProps({ items: [makeItem({ id: 'A', detail: longDetail })] });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    const list = screen.getByRole('list');
    const bullets = within(list).getAllByRole('listitem');
    expect(bullets).toHaveLength(3);
    expect(bullets[2]).toHaveTextContent('+2 more');

    const toggle = screen.getByRole('button', { name: 'Show full question' });
    await user.click(toggle);

    expect(screen.getByText(longDetail)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show full question' })).not.toBeInTheDocument();
  });

  // ————— 8. Empty state —————
  it('open + no items: shows "All questions resolved", Return button focused, closes on click', async () => {
    const props = baseProps({ surface: 'open', items: [] });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    expect(screen.getByText('All questions resolved')).toBeInTheDocument();

    const returnBtn = screen.getByRole('button', { name: 'Return to document' });
    expect(returnBtn).toHaveFocus();

    await user.click(returnBtn);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  // ————— 9. Advance-on-vanish (D6) —————
  it('advances selection when the active item disappears from the pool', () => {
    const A = makeItem({ id: 'A', title: 'Question A' });
    const B = makeItem({ id: 'B', title: 'Question B' });
    const C = makeItem({ id: 'C', title: 'Question C' });

    const props = baseProps({ items: [A, B, C] });
    const view = renderWithUser(<QuestionPanel {...props} />);

    // A is active while present
    const chipA = screen.getByRole('button', { name: /Question A/ });
    expect(chipA).toHaveAttribute('aria-current', 'true');

    // A vanishes from the pool — selection must advance to B
    view.rerender(<QuestionPanel {...baseProps({ items: [B, C] })} />);

    expect(screen.queryByRole('button', { name: /Question A/ })).not.toBeInTheDocument();

    const chipB = screen.getByRole('button', { name: /Question B/ });
    expect(chipB).toHaveAttribute('aria-current', 'true');

    const chipC = screen.getByRole('button', { name: /Question C/ });
    expect(chipC).not.toHaveAttribute('aria-current');
  });

  // ————— 10. Retry replays submitted text —————
  it('failed answer: Retry button re-submits the previously submitted text', async () => {
    const props = baseProps();
    const view = renderWithUser(<QuestionPanel {...props} />);

    // Submit once — the panel remembers the text for retry
    const textarea = screen.getByLabelText('Your answer');
    await view.user.type(textarea, 'apply this fix');
    await view.user.keyboard('{Enter}');
    expect(props.onSubmit).toHaveBeenCalledWith('A', 'apply this fix');

    // Answer fails: Retry appears and replays the same text.
    // Rerender with the SAME props (same mocks), only answerStates changes.
    view.rerender(<QuestionPanel {...props} answerStates={{ A: { phase: 'failed' } }} />);

    const retryBtn = screen.getByRole('button', { name: /Retry/ });
    await view.user.click(retryBtn);

    expect(props.onSubmit).toHaveBeenCalledTimes(2);
    expect(props.onSubmit).toHaveBeenLastCalledWith('A', 'apply this fix');
  });

  // ————— 11. Workstream C: onFocusDocument wiring —————
  it('chip click: onFocusDocument fires with the clicked item', async () => {
    const A = makeItem({ id: 'A', title: 'Question A' });
    const B = makeItem({ id: 'B', title: 'Question B' });
    const onFocusDocument = vi.fn();
    const props = baseProps({ items: [A, B], onFocusDocument });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    const chipB = screen.getByRole('button', { name: /Question B/ });
    await user.click(chipB);

    expect(onFocusDocument).toHaveBeenCalledTimes(1);
    expect(onFocusDocument).toHaveBeenCalledWith(B);
  });

  it('open onto an item: onFocusDocument fires for the active item once', () => {
    const item = makeItem({ id: 'A', title: 'Question A', detail: 'About SS-09.a' });
    const onFocusDocument = vi.fn();
    const props = baseProps({ surface: 'closed', items: [item], onFocusDocument });
    const view = renderWithUser(<QuestionPanel {...props} />);

    expect(onFocusDocument).not.toHaveBeenCalled();

    view.rerender(<QuestionPanel {...props} surface="open" />);
    expect(onFocusDocument).toHaveBeenCalledTimes(1);
    expect(onFocusDocument).toHaveBeenCalledWith(item);
  });

  it('mounted inside a left-pane wrapper keeps the region role and docked composer', () => {
    renderWithUser(
      <div className="relative flex min-h-0 flex-col">
        <QuestionPanel {...baseProps()} />
      </div>,
    );

    const region = screen.getByRole('region', { name: 'Questions from AI' });
    expect(region).toHaveAttribute('id', 'question-panel');
    expect(screen.getByLabelText('Your answer')).toBeInTheDocument();
  });

  // ————— 14. focusRequest deep-link adoption (design §5.E) —————
  it('focusRequest: adopts the item as active and emits onFocusDocument once per token', () => {
    const A = makeItem({ id: 'A', title: 'Question A' });
    const B = makeItem({ id: 'B', title: 'Question B' });
    const onFocusDocument = vi.fn();
    const props = baseProps({ items: [A, B], onFocusDocument });
    const view = renderWithUser(<QuestionPanel {...props} />);

    expect(screen.getByRole('button', { name: /Question A/ })).toHaveAttribute('aria-current', 'true');

    view.rerender(<QuestionPanel {...props} focusRequest={{ id: 'B', token: 1 }} />);

    expect(screen.getByRole('button', { name: /Question B/ })).toHaveAttribute('aria-current', 'true');
    expect(onFocusDocument).toHaveBeenCalledTimes(1);
    expect(onFocusDocument).toHaveBeenCalledWith(B);

    // Same token again — no re-emit.
    view.rerender(<QuestionPanel {...props} focusRequest={{ id: 'B', token: 1 }} />);
    expect(onFocusDocument).toHaveBeenCalledTimes(1);
  });

  it('focusRequest for an unknown id is ignored without side effects', () => {
    const onFocusDocument = vi.fn();
    const props = baseProps({ onFocusDocument });
    const view = renderWithUser(<QuestionPanel {...props} />);

    view.rerender(<QuestionPanel {...props} focusRequest={{ id: 'nope', token: 2 }} />);

    expect(onFocusDocument).not.toHaveBeenCalled();
  });
});