import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

// Module-scope stable fixtures for the mocked voice recorder (§2 talk-to-text).
const voiceMock = {
  recording: false,
  startRecording: vi.fn(),
  stopRecording: vi.fn<(chunkMs?: number) => Promise<string | null>>(async () => 'Transcribed answer text'),
  error: null as string | null,
};
vi.mock('../hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: vi.fn(() => voiceMock),
}));
import { cleanup, renderWithUser } from '../test/render';
import QuestionPanel, { resetQuestionDraftsForTests, type QuestionPanelProps } from './QuestionPanel';
import { deriveQueuedAnswerStates } from '../lib/queuedStates';
import type { PortalItem } from '../types/api';

afterEach(async () => {
  cleanup();
  // A test may leave fake timers active (caret-restore tests); restore real
  // timers first so the flush below never hangs.
  vi.useRealTimers();
  // Board #53A — the module draft store (and its localStorage mirror) is shared
  // across mounts. The recorder-flush microtask (stopRecording().then… append)
  // is feature behavior on close/unmount, so let it land BEFORE the reset or
  // it pollutes the next test's seeded drafts.
  await new Promise(resolve => setTimeout(resolve, 0));
  resetQuestionDraftsForTests();
  voiceMock.recording = false;
  voiceMock.error = null;
  voiceMock.startRecording.mockClear();
  voiceMock.stopRecording.mockClear();
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

/** The single per-question textarea — QuestionChat's composer owns it. */
function textbox(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

describe('QuestionPanel', () => {
  // ————— 0. One conversation replaces the answer + ask boxes —————
  it('open: the card renders exactly ONE textbox', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('open: the removed copy is gone (Your answer / Ask the specialist / Advisory only / helper line)', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);
    // `ignore: '.sr-only'` keeps the sr-only composer label out of the match:
    // the assertion is about VISIBLE copy.
    expect(screen.queryByText('Your answer', { ignore: '.sr-only' })).not.toBeInTheDocument();
    expect(screen.queryByText('Ask the specialist', { ignore: '.sr-only' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Advisory only/, { ignore: '.sr-only' })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Usually 1–3 sentences/, { ignore: '.sr-only' })
    ).not.toBeInTheDocument();
  });
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

  // ————— 4. Composer submit (answer mode is the recording verb) —————
  it('open: answer mode + Enter submits the trimmed text with the item id', async () => {
    const props = baseProps();
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    await user.click(screen.getByRole('radio', { name: 'Answer' }));
    await user.type(textbox(), '  my answer  ');
    await user.keyboard('{Enter}');

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith('A', 'my answer');
  });

  it('open: Shift+Enter does not send and keeps the draft', async () => {
    const onThreadMessage = vi.fn(async () => {});
    const props = baseProps({ onThreadMessage });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    const textarea = textbox();
    await user.type(textarea, 'keep me');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(onThreadMessage).not.toHaveBeenCalled();
    // Shift+Enter inserts a newline natively (no preventDefault on the shift
    // path) and the draft must be preserved — assert it was not cleared.
    expect(textbox().value).toContain('keep me');
  });

  it('open: Enter while composing (IME) does not send', () => {
    const props = baseProps();
    renderWithUser(<QuestionPanel {...props} />);

    fireEvent.keyDown(textbox(), { key: 'Enter', isComposing: true });

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  // ————— 5. Composer replaced by one locked row while queued/applying —————
  it.each(['queued', 'applying'] as const)(
    'open: composer is one locked row while phase is %s',
    (phase) => {
      const props = baseProps({ answerStates: { A: { phase } } });
      renderWithUser(<QuestionPanel {...props} />);
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByText('Answer recorded — applies after this phase')).toBeInTheDocument();
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

    await user.type(textbox(), 'draft text');
    expect(textbox().value).toBe('draft text');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(textbox().value).toBe('');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('open + answer mode + draft: Escape returns the composer to advisory (R3)', async () => {
    const props = baseProps();
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    await user.click(screen.getByRole('radio', { name: 'Answer' }));
    expect(screen.getByRole('radio', { name: 'Answer' })).toHaveAttribute('aria-checked', 'true');
    await user.type(textbox(), 'draft text');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByRole('radio', { name: 'Advisory' })).toHaveAttribute('aria-checked', 'true');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('minimized: Escape does nothing', () => {
    const props = baseProps({ surface: 'minimized' });
    renderWithUser(<QuestionPanel {...props} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onExpand).not.toHaveBeenCalled();
  });

  // ————— 6b. Board #57: 4KB write-time cap + Escape persistence —————
  it('caps the persisted draft at 4KB so a remount reads a bounded prefix', () => {
    const big = 'x'.repeat(5000);
    const props = baseProps();
    const { unmount } = renderWithUser(<QuestionPanel {...props} />);

    fireEvent.change(textbox(), {
      target: { value: big }
    });

    // The persisted mirror is capped at write time (4096 chars), not just at
    // persist-sweep time, so a reload can never resurrect >4KB from storage.
    const stored: Record<string, string> = JSON.parse(
      window.localStorage.getItem('starn.questionDrafts.v1') ?? '{}'
    );
    expect(stored.A).toHaveLength(4096);

    unmount();
    renderWithUser(<QuestionPanel {...props} />);
    expect(textbox().value).toHaveLength(4096);
  });

  it('Escape then remount: the draft is gone from the store (persists nothing)', () => {
    const props = baseProps();
    const { unmount } = renderWithUser(<QuestionPanel {...props} />);

    fireEvent.change(textbox(), { target: { value: 'draft text' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(textbox().value).toBe('');

    unmount();
    renderWithUser(<QuestionPanel {...props} />);
    expect(textbox().value).toBe('');
    const stored: Record<string, string> = JSON.parse(
      window.localStorage.getItem('starn.questionDrafts.v1') ?? '{}'
    );
    expect(stored.A).toBeUndefined();
  });

  // ————— 7. The detail body moved to the right pane (design §3b.3.6) —————
  it('open: the detail body and its "Show full question" disclosure leave the left pane', () => {
    const longDetail = [
      'The widget under test exposes three call sites to the parser.',
      'Two of those pathways are already covered by integration tests.',
      'The third path is only exercised when the throttle is engaged.',
      'A fourth observation about the cold-start behavior in the harness.',
      'A fifth detail about the final verification step in the sequence.',
    ].join(' ');
    const props = baseProps({ items: [makeItem({ id: 'A', detail: longDetail })] });
    renderWithUser(<QuestionPanel {...props} />);

    // QuestionDetails owns the record now: the left pane is chips → context
    // header → conversation, with no bullet list and no expander.
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show full question' })).not.toBeInTheDocument();
    expect(screen.queryByText(longDetail)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Question context' })).toBeInTheDocument();
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
  // ————— Board #53A: answer drafts survive close/reopen, unmount, reload —————
  it('draft survives close → reopen of the panel', async () => {
    const props = baseProps();
    const view = renderWithUser(<QuestionPanel {...props} />);

    await view.user.type(textbox(), 'typed but not sent');

    // Close (surface 'closed' → panel renders nothing) then reopen.
    view.rerender(<QuestionPanel {...props} surface="closed" />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    view.rerender(<QuestionPanel {...props} />);

    expect(textbox()).toHaveValue('typed but not sent');
  });

  it('draft survives unmount + remount (page reload) via the persisted store', async () => {
    const props = baseProps();
    const first = renderWithUser(<QuestionPanel {...props} />);

    await first.user.type(textbox(), 'survives a reload');
    first.unmount();

    // Fresh mount, as after a full page reload (same module store + storage).
    renderWithUser(<QuestionPanel {...baseProps()} />);
    expect(textbox()).toHaveValue('survives a reload');
  });

  it('successful submit clears the draft (state and persisted store)', async () => {
    const props = baseProps();
    const view = renderWithUser(<QuestionPanel {...props} />);

    await view.user.click(screen.getByRole('radio', { name: 'Answer' }));
    await view.user.type(textbox(), 'send this');
    await view.user.keyboard('{Enter}');
    expect(props.onSubmit).toHaveBeenCalledTimes(1);

    expect(textbox()).toHaveValue('');
    // The store cleared too: a fresh mount shows no draft.
    view.unmount();
    renderWithUser(<QuestionPanel {...baseProps()} />);
    expect(textbox()).toHaveValue('');
  });

  it('failed submit keeps the draft in the composer', async () => {
    const failing = vi.fn(async () => { throw new Error('nope'); });
    const props = baseProps({ onSubmit: failing });
    const view = renderWithUser(<QuestionPanel {...props} />);

    await view.user.click(screen.getByRole('radio', { name: 'Answer' }));
    await view.user.type(textbox(), 'keep me');
    await view.user.keyboard('{Enter}');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    expect(textbox()).toHaveValue('keep me');
  });

  // ————— Board #53B: queued chip rebuilt from portal data after reload —————
  it('item with meta.answerQueued renders the Queued chip after reload with no SSE frame', () => {
    const item = makeItem({ id: 'A', meta: { answerQueued: true } });
    // No answer frames ever fired in this fresh mount — chip state comes
    // purely from the derived portal payload (server queue bookkeeping).
    const answerStates = deriveQueuedAnswerStates([item]);
    renderWithUser(
      <QuestionPanel {...baseProps({ items: [item], answerStates })} />
    );

    expect(screen.getByText('Queued — applies after this phase')).toBeInTheDocument();
  });

  it('failed answer: Retry button re-submits the previously submitted text', async () => {
    const props = baseProps();
    const view = renderWithUser(<QuestionPanel {...props} />);

    // Submit once — the panel remembers the text for retry
    await view.user.click(screen.getByRole('radio', { name: 'Answer' }));
    await view.user.type(textbox(), 'apply this fix');
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

  // ————— R6: display-only title cleanup (stored title untouched) —————
  it('chip text strips markdown junk from the title (display only)', () => {
    const item = makeItem({ id: 'J', title: 'Foo bar.**' });
    const props = baseProps({ items: [item, makeItem({ id: 'K', title: 'Other question' })] });
    renderWithUser(<QuestionPanel {...props} />);

    const chip = screen.getByRole('button', { name: /Foo bar./ });
    expect(chip).toHaveTextContent('Foo bar.');
    expect(chip.textContent).not.toContain('*');
    expect(item.title).toBe('Foo bar.**');
  });

  // ————— P5 — ICD-system topic grouping of the chip strip —————
  it('groups the chip strip by meta.topic with labeled headers and counts', () => {
    const e1 = makeItem({ id: 'E1', title: 'Bus voltage', meta: { topic: 'electrical' } });
    const e2 = makeItem({ id: 'E2', title: 'Connector pinout', meta: { topic: 'electrical' } });
    const t1 = makeItem({ id: 'T1', title: 'Cooling airflow', meta: { topic: 'thermal' } });
    const props = baseProps({ items: [e1, e2, t1] });
    renderWithUser(<QuestionPanel {...props} />);

    // Group headers carry the label and count as text (no color-only signal).
    expect(screen.getByRole('heading', { name: 'Electrical (2)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Thermal (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Other/ })).not.toBeInTheDocument();
    // Every chip still renders.
    expect(screen.getByRole('button', { name: /Bus voltage/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cooling airflow/ })).toBeInTheDocument();
  });

  it('untagged and unknown-topic items land in the "Other" group (null-safe)', () => {
    const untagged = makeItem({ id: 'U', title: 'Legacy untagged' });
    const unknown = makeItem({ id: 'K', title: 'Software cadence', meta: { topic: 'software' } });
    const props = baseProps({ items: [untagged, unknown] });
    renderWithUser(<QuestionPanel {...props} />);

    expect(screen.getByRole('heading', { name: 'Other (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Legacy untagged/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Software cadence/ })).toBeInTheDocument();
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
    expect(textbox()).toBeInTheDocument();
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

  // ————— 15. Voice input in the chat composer (design §2) —————
  it('voice: the composer mic keeps the aria-label "Record answer"', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);

    expect(screen.getByRole('button', { name: 'Record answer' })).toBeInTheDocument();
  });

  it('voice: mic aria-pressed follows the recorder state', () => {
    const view = renderWithUser(<QuestionPanel {...baseProps()} />);

    expect(screen.getByRole('button', { name: 'Record answer' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    voiceMock.recording = true;
    view.rerender(<QuestionPanel {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Record answer' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('voice: holding the mic records, releasing appends the transcript into the one draft', async () => {
    const view = renderWithUser(<QuestionPanel {...baseProps()} />);

    await view.user.type(textbox(), 'typed ');

    const mic = screen.getByRole('button', { name: 'Record answer' });
    fireEvent.pointerDown(mic);
    expect(voiceMock.startRecording).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(mic);

    await vi.waitFor(() => {
      expect(textbox().value).toBe('typed Transcribed answer text');
    });
    expect(voiceMock.stopRecording).toHaveBeenCalledTimes(1);
  });

  it('voice: Alt-hold starts and releasing appends the transcription', async () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);

    fireEvent.keyDown(window, { key: 'Alt' });
    expect(voiceMock.startRecording).toHaveBeenCalledTimes(1);

    fireEvent.keyUp(window, { key: 'Alt' });
    await vi.waitFor(() => {
      expect(textbox().value).toBe('Transcribed answer text');
    });
  });

  it('voice: no mic while the answer is queued/applying (composer is one locked row)', () => {
    renderWithUser(<QuestionPanel {...baseProps({ answerStates: { A: { phase: 'queued' } } })} />);

    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument();
    expect(screen.getByText('Answer recorded — applies after this phase')).toBeInTheDocument();
  });

  it('voice: no mic button when minimized or resolved dwell', () => {
    const { rerender } = renderWithUser(<QuestionPanel {...baseProps({ surface: 'minimized' })} />);
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument();

    rerender(<QuestionPanel {...baseProps({ answerStates: { A: { phase: 'applied' } } })} />);
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument();
  });

  it('voice: surfaces recorder errors without console errors', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    voiceMock.error = 'Microphone access denied';
    renderWithUser(<QuestionPanel {...baseProps()} />);

    expect(screen.getByText('Microphone access denied')).toBeInTheDocument();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('voice: a recorder error is announced politely next to the composer', () => {
    voiceMock.error = 'Microphone access denied';
    renderWithUser(<QuestionPanel {...baseProps()} />);

    expect(screen.getByText('Microphone access denied')).toHaveAttribute('aria-live', 'polite');
  });

  it('voice: closing the panel while recording stops the recorder and keeps the transcript', async () => {
    const view = renderWithUser(<QuestionPanel {...baseProps()} />);

    voiceMock.recording = true;
    view.rerender(<QuestionPanel {...baseProps()} />);

    view.rerender(<QuestionPanel {...baseProps({ surface: 'closed' })} />);

    // The mic must be released, not orphaned.
    expect(voiceMock.stopRecording).toHaveBeenCalledTimes(1);

    // The late transcription result is flushed into the item draft and
    // survives both the close reset and the reopen.
    await act(async () => { await Promise.resolve(); });
    view.rerender(<QuestionPanel {...baseProps()} />);
    await vi.waitFor(() => {
      expect(textbox().value).toBe('Transcribed answer text');
    });
  });

  it('voice: minimizing while recording stops the recorder and keeps the transcript', async () => {
    const view = renderWithUser(<QuestionPanel {...baseProps()} />);

    voiceMock.recording = true;
    view.rerender(<QuestionPanel {...baseProps()} />);

    view.rerender(<QuestionPanel {...baseProps({ surface: 'minimized' })} />);

    expect(voiceMock.stopRecording).toHaveBeenCalledTimes(1);

    await act(async () => { await Promise.resolve(); });
    view.rerender(<QuestionPanel {...baseProps()} />);
    await vi.waitFor(() => {
      expect(textbox().value).toBe('Transcribed answer text');
    });
  });

  it('voice: AltGr (Ctrl+Alt) does not start or stop recording', () => {
    voiceMock.recording = true;
    renderWithUser(<QuestionPanel {...baseProps()} />);

    fireEvent.keyDown(window, { key: 'Alt', ctrlKey: true });
    expect(voiceMock.startRecording).not.toHaveBeenCalled();

    fireEvent.keyUp(window, { key: 'Alt', ctrlKey: true });
    expect(voiceMock.stopRecording).not.toHaveBeenCalled();
  });

  // ————— 15b. The one send verb obeys the visible mode —————
  it('send: the verb is Ask in advisory mode and disabled while the draft is empty', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);

    const ask = screen.getByRole('button', { name: 'Ask' });
    expect(ask).toBeDisabled();
    expect(ask).toHaveAttribute('title', 'Send as a question — nothing is recorded (Enter)');
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
  });

  it('send: Ask calls onThreadMessage (records nothing) and clears the draft', async () => {
    const onThreadMessage = vi.fn(async () => {});
    const props = baseProps({ onThreadMessage });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    await user.type(textbox(), '  is 48 V enough?  ');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(onThreadMessage).toHaveBeenCalledTimes(1);
    expect(onThreadMessage).toHaveBeenCalledWith('A', 'is 48 V enough?');
    expect(props.onSubmit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(textbox()).toHaveValue(''));
  });

  it('send: the Record verb submits the trimmed text in answer mode', async () => {
    const props = baseProps();
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    await user.click(screen.getByRole('radio', { name: 'Answer' }));
    await user.type(textbox(), '  my answer  ');
    await user.click(screen.getByRole('button', { name: 'Record' }));

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith('A', 'my answer');
  });

  it('send: disabled while the submit is in flight', async () => {
    let resolveSubmit!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>(res => { resolveSubmit = res; }));
    const props = baseProps({ onSubmit });
    const view = renderWithUser(<QuestionPanel {...props} />);

    await view.user.click(screen.getByRole('radio', { name: 'Answer' }));
    await view.user.type(textbox(), 'answer');
    const send = screen.getByRole('button', { name: 'Record' });

    const click = view.user.click(send);
    await vi.waitFor(() => expect(send).toBeDisabled());

    // Success clears the draft (board #53A), so the verb is empty-disabled again.
    // The clear continuation runs outside act; flush it before asserting.
    resolveSubmit();
    await click;
    await act(async () => { await Promise.resolve(); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(textbox()).toHaveValue('');
  });

  it('send: a failed answer keeps the draft, shows the error, and re-enables', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('boom'); });
    const view = renderWithUser(<QuestionPanel {...baseProps({ onSubmit })} />);

    await view.user.click(screen.getByRole('radio', { name: 'Answer' }));
    await view.user.type(textbox(), 'answer');
    await view.user.click(screen.getByRole('button', { name: 'Record' }));

    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(textbox()).toHaveValue('answer');
    // R5 — a failed answer returns the composer to advisory and keeps the draft.
    expect(screen.getByRole('radio', { name: 'Advisory' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled();
  });

  // ————— 15c. Caret retention after a voice append (design §2) —————
  it('voice: caret sits at the end of the appended text and the composer regains focus', async () => {
    const view = renderWithUser(<QuestionPanel {...baseProps()} />);

    await view.user.type(textbox(), 'typed ');

    voiceMock.recording = true;
    view.rerender(<QuestionPanel {...baseProps()} />);
    const mic = screen.getByRole('button', { name: 'Record answer' });
    fireEvent.pointerDown(mic);
    fireEvent.pointerUp(mic);

    await vi.waitFor(() => {
      const textarea = textbox();
      expect(textarea.value).toBe('typed Transcribed answer text');
      expect(document.activeElement).toBe(textarea);
      expect(textarea.selectionStart).toBe(textarea.value.length);
      expect(textarea.selectionEnd).toBe(textarea.value.length);
    });
  });

  it('voice: no caret refocus when focus has already moved elsewhere after the append', async () => {
    vi.useFakeTimers();
    let resolveStop: (text: string | null) => void = () => {};
    voiceMock.stopRecording.mockImplementationOnce(
      () => new Promise<string | null>(res => { resolveStop = res; })
    );
    const view = renderWithUser(<QuestionPanel {...baseProps()} />);

    voiceMock.recording = true;
    view.rerender(<QuestionPanel {...baseProps()} />);
    fireEvent.keyDown(window, { key: 'Alt' });
    fireEvent.keyUp(window, { key: 'Alt' });
    expect(voiceMock.stopRecording).toHaveBeenCalledTimes(1);

    // Land the transcript: append runs as a microtask, the caret restore is
    // deferred one task — focus can move in between.
    await act(async () => {
      resolveStop('Transcribed answer text');
      await Promise.resolve();
    });

    // The user focused something else after the append; the restore must not
    // steal focus back.
    screen.getByRole('button', { name: 'Close questions' }).focus();
    act(() => { vi.runAllTimers(); });

    const textarea = textbox();
    expect(textarea.value).toBe('Transcribed answer text');
    expect(document.activeElement).not.toBe(textarea);

    vi.useRealTimers();
  });

  // ————— 16. Lifecycle colors + follow-up chip (design §3, board #52) —————
  it('lifecycle: queued state chip is violet (icon + word, never color alone)', () => {
    renderWithUser(<QuestionPanel {...baseProps({ answerStates: { A: { phase: 'queued' } } })} />);

    const chip = screen.getByText('Queued — applies after this phase');
    expect(chip.className).toContain('text-violet-300');
    expect(chip.className).not.toContain('amber');
  });

  it('lifecycle: the Follow-up disclosure moved to the right pane (none in the left pane)', () => {
    const item = makeItem({
      id: 'A',
      meta: { answerHistory: [{ text: '42V nominal', at: '2025-01-01T00:00:00.000Z' }] },
    });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    // QuestionDetails renders the disclosure (and its amber styling); the left
    // pane keeps only the chips, the context header and the conversation.
    expect(screen.queryByText('Follow-up')).not.toBeInTheDocument();
    // The question itself still renders: context header title + conversation label.
    expect(screen.getByRole('heading', { level: 2, name: 'Question A' })).toBeInTheDocument();
  });

  it('lifecycle: no follow-up chip without answer history', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);

    expect(screen.queryByText('Follow-up')).not.toBeInTheDocument();
  });

  it('lifecycle: prior answers render no rows in the left pane (the disclosure is in Details)', () => {
    const item = makeItem({
      id: 'A',
      meta: {
        answerHistory: [
          { text: 'First reply', at: '2025-01-01T00:00:00.000Z' },
          { text: 'Second reply', at: '2025-01-02T00:00:00.000Z' },
        ],
      },
    });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    expect(screen.queryByRole('button', { name: 'Follow-up' })).not.toBeInTheDocument();
    expect(screen.queryByText('First reply')).not.toBeInTheDocument();
    expect(screen.queryByText('Second reply')).not.toBeInTheDocument();
  });

  it('lifecycle: nav dots — amber pending, violet queued, rose parked', () => {
    const A = makeItem({ id: 'A', title: 'Question A' }); // queued → violet
    const B = makeItem({ id: 'B', title: 'Question B', type: 'parked' }); // parked → rose
    const C = makeItem({ id: 'C', title: 'Question C' }); // pending → amber
    renderWithUser(
      <QuestionPanel
        {...baseProps({ items: [A, B, C], answerStates: { A: { phase: 'queued' } } })}
      />,
    );

    const dotOf = (name: string) =>
      screen.getByRole('button', { name: new RegExp(name) }).querySelector('span.rounded-full');
    expect(dotOf('Question A')?.className).toContain('bg-violet-400');
    expect(dotOf('Question B')?.className).toContain('bg-rose-400');
    expect(dotOf('Question C')?.className).toContain('bg-amber-400');
  });
});
// ————— Research gate states (portal research gate package) —————

describe('QuestionPanel research gate', () => {
  it('researching item shows a "Researching…" status chip', () => {
    const item = makeItem({ meta: { researching: true } });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);
    expect(screen.getByText('Researching…')).toBeTruthy();
  });

  it('non-researching plain item shows no researching chip', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);
    expect(screen.queryByText('Researching…')).toBeNull();
  });

  it('proposed answer card: renders answer, sources, confidence; YES/EDIT/NO call the gate handlers', async () => {
    const item = makeItem({
      meta: {
        proposedAnswer: {
          answer: '48V per the vendor datasheet.',
          sources: [{ title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' }],
          confidence: 0.7,
          rationale: 'Stated verbatim.'
        },
      },
    });
    const props = baseProps({
      items: [item],
      onConfirmProposal: vi.fn(async () => {}),
      onRejectProposal: vi.fn(async () => {}),
      onUndoAuto: vi.fn(async () => {}),
    });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    expect(screen.getByText('Research proposal — 70% confidence')).toBeTruthy();
    expect(screen.getByText('48V per the vendor datasheet.')).toBeTruthy();
    const sourceLink = screen.getByRole('link', { name: 'Vendor datasheet' });
    expect(sourceLink.getAttribute('href')).toBe('https://vendor.example/ds.pdf');

    await user.click(screen.getByRole('button', { name: 'Use proposal' }));
    expect(props.onConfirmProposal).toHaveBeenCalledWith(item.id, undefined);

    // EDIT: inline textarea pre-filled with the proposal, confirm-with-text.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByLabelText('Edit proposal') as HTMLTextAreaElement;
    expect(textarea.value).toBe('48V per the vendor datasheet.');
    await user.type(textarea, ' (edited)');
    await user.click(screen.getByRole('button', { name: 'Use edited answer' }));
    expect(props.onConfirmProposal).toHaveBeenCalledWith(item.id, '48V per the vendor datasheet. (edited)');

    // NO: reject clears the proposal, item stays open plain.
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(props.onRejectProposal).toHaveBeenCalledWith(item.id);
  });

  it('proposal action failure surfaces an alert (no color-only signal)', async () => {
    const item = makeItem({
      meta: {
        proposedAnswer: { answer: '48V', sources: [], confidence: 0.7, rationale: '' },
      },
    });
    const props = baseProps({
      items: [item],
      onConfirmProposal: vi.fn(async () => { throw new Error('Item no longer open'); }),
    });
    const { user } = renderWithUser(<QuestionPanel {...props} />);
    await user.click(screen.getByRole('button', { name: 'Use proposal' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Item no longer open')).toBeTruthy();
  });

  it('auto-applied banner: UNDO visible pre-incorporation and calls onUndoAuto', async () => {
    const item = makeItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: {
          answer: '48V',
          appendedText: '\n\n## User Answers (Pending Incorporation)\n\n**Q**\nAnswer: 48V\n',
          confidence: 0.96,
          sources: [],
          rationale: 'Vendor datasheet.',
        },
      },
    });
    const props = baseProps({
      items: [item],
      onConfirmProposal: vi.fn(async () => {}),
      onRejectProposal: vi.fn(async () => {}),
      onUndoAuto: vi.fn(async () => {}),
    });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    expect(screen.getByText(/Auto-applied from research \(96% confidence\) — pending incorporation/)).toBeTruthy();
    const undo = screen.getByRole('button', { name: 'Undo auto-applied answer' });
    await user.click(undo);
    expect(props.onUndoAuto).toHaveBeenCalledWith(item.id);
  });

  it('auto-applied banner: incorporated items show NO undo button', () => {
    const item = makeItem({
      status: 'answered',
      answer: '48V',
      meta: {
        autoApplied: {
          answer: '48V',
          confidence: 0.96,
          sources: [],
          rationale: '',
          incorporated: true,
        },
      },
    });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);
    expect(screen.queryByRole('button', { name: 'Undo auto-applied answer' })).toBeNull();
    expect(screen.getByText(/Auto-applied from research \(96% confidence\)/)).toBeTruthy();
  });

  // ————— F2: topic grouping header shows a real group when meta.topic exists —————
  it('topic grouping: items with meta.topic land under their real group header', () => {
    const a = makeItem({ title: 'Bus voltage', meta: { topic: 'electrical' } });
    const b = makeItem({ id: 'C', title: 'Coolant loop', meta: { topic: 'thermal' } });
    renderWithUser(<QuestionPanel {...baseProps({ items: [a, b] })} />);
    expect(screen.getByText('Electrical (1)')).toBeInTheDocument();
    expect(screen.getByText('Thermal (1)')).toBeInTheDocument();
    expect(screen.queryByText(/Other \(/)).toBeNull();
  });

  // ————— Left pane composition (design §3b.3.1, §3b.4, §3b.3.6) —————
  describe('left pane = chips + context header + conversation', () => {
    const withMeta = makeItem({
      id: 'A',
      title: 'Is the 2 A fuse selective?',
      detail: 'SS-04.e asks whether the 2 A fuse coordinates with the 50 A upstream fuse.',
      docPath: 'docs/RTM.md',
      meta: {
        topic: 'electrical',
        sections: {
          bluf: 'Use the 2 A slow-blow fuse.',
          findings: 'Vendor datasheet: 2 A at 48 V.',
          suggestion: 'Fit the 2 A slow-blow fuse.',
          alternatives: 'Use a 3 A fuse.',
          defer: 'Blocks the charger build.',
          background: 'The rail feeds the charger.',
        },
      },
    });

    it('renders the context header: topic tag, pager position, source line and BLUF', () => {
      renderWithUser(<QuestionPanel {...baseProps({ items: [withMeta] })} />);

      const header = screen.getByRole('region', { name: 'Question context' });
      expect(within(header).getByText('electrical')).toBeInTheDocument();
      expect(within(header).getByText('1 of 1')).toBeInTheDocument();
      expect(within(header).getByText('RTM.md')).toBeInTheDocument();
      expect(within(header).getByText(/· SS-04\.e/)).toBeInTheDocument();
      expect(within(header).getByText(/Use the 2 A slow-blow fuse\./)).toBeInTheDocument();
      expect(within(header).getByRole('heading', { level: 2 })).toHaveTextContent(
        'Is the 2 A fuse selective?'
      );
    });

    it('the panel header keeps no doc chip and no pager (both moved into the header above)', () => {
      const { container } = renderWithUser(<QuestionPanel {...baseProps({ items: [withMeta] })} />);

      const panelHeader = container.querySelector('#question-panel > header');
      expect(panelHeader).not.toBeNull();
      expect(panelHeader!.textContent).toContain('Questions from AI');
      expect(panelHeader!.textContent).not.toContain('RTM.md');
      expect(panelHeader!.textContent).not.toMatch(/\d+ of \d+/);
    });

    it('no memo section renders in the left pane (the record lives in QuestionDetails)', () => {
      renderWithUser(<QuestionPanel {...baseProps({ items: [withMeta] })} />);

      for (const label of [
        'Research findings',
        'Main suggestion',
        'Alternatives',
        'Defer',
        'Background',
        'Sources',
        'Original detail',
      ]) {
        expect(screen.queryByText(label), label).not.toBeInTheDocument();
      }
      expect(screen.queryByText('Vendor datasheet: 2 A at 48 V.')).not.toBeInTheDocument();
      expect(screen.queryByText('Blocks the charger build.')).not.toBeInTheDocument();
    });

    it('onActiveItemChange emits once per active-item change', async () => {
      const A = makeItem({ id: 'A', title: 'Question A' });
      const B = makeItem({ id: 'B', title: 'Question B' });
      const onActiveItemChange = vi.fn();
      const props = baseProps({ items: [A, B], onActiveItemChange });
      const view = renderWithUser(<QuestionPanel {...props} />);

      expect(onActiveItemChange).toHaveBeenCalledTimes(1);
      expect(onActiveItemChange).toHaveBeenLastCalledWith(A);

      await view.user.click(screen.getByRole('button', { name: /^Question B/ }));
      expect(onActiveItemChange).toHaveBeenCalledTimes(2);
      expect(onActiveItemChange).toHaveBeenLastCalledWith(B);

      // A poll hands over a fresh array of the same items — no re-emission.
      view.rerender(<QuestionPanel {...props} items={[{ ...A }, { ...B }]} />);
      expect(onActiveItemChange).toHaveBeenCalledTimes(2);
    });

    it('the header Details button hands the active item to onOpenDetails', async () => {
      const onOpenDetails = vi.fn();
      const { user } = renderWithUser(
        <QuestionPanel {...baseProps({ items: [withMeta], onOpenDetails })} />
      );

      await user.click(screen.getByRole('button', { name: 'Details' }));
      expect(onOpenDetails).toHaveBeenCalledTimes(1);
      expect(onOpenDetails).toHaveBeenCalledWith(withMeta);
    });

    it('a parked item shows gaps and the manual actions, with no conversation or context header', () => {
      const parked = makeItem({
        id: 'P',
        type: 'parked',
        title: 'Fuse coordination unverified',
        docPath: 'docs/RTM.md',
        gaps: ['SS-04.e missing', 'SS-09.a missing'],
      });
      renderWithUser(<QuestionPanel {...baseProps({ items: [parked] })} />);

      expect(screen.getByText('Critic blocked')).toBeInTheDocument();
      expect(screen.getByText('Fuse coordination unverified')).toBeInTheDocument();
      expect(screen.getByText('Missing requirements:')).toBeInTheDocument();
      expect(screen.getByText('SS-04.e missing')).toBeInTheDocument();
      expect(screen.getByText('SS-09.a missing')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Resolve & Resume/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Edit Manually/ })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /Conversation about/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Question context' })).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  // ————— F3: empty-title items never render a bare button —————
  it('empty-title item is filtered out (no bare nav chip), real items still render', () => {
    const blank = makeItem({ id: 'B', title: '   ' });
    const real = makeItem({ id: 'C', title: 'Real open question' });
    const real2 = makeItem({ id: 'D', title: 'Second real question' });
    const { container } = renderWithUser(<QuestionPanel {...baseProps({ items: [blank, real, real2] })} />);
    // Nav chips (topic-group buttons) render the item title — no chip may be bare.
    const chips = Array.from(container.querySelectorAll('button')).filter(btn =>
      btn.querySelector('span[class*="max-w-[140px]"]')
    );
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.textContent!.trim().length).toBeGreaterThan(0);
    }
    // Header count matches the filtered item list.
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
