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

  // ————— 6b. Board #57: 4KB write-time cap + Escape persistence —————
  it('caps the persisted draft at 4KB so a remount reads a bounded prefix', () => {
    const big = 'x'.repeat(5000);
    const props = baseProps();
    const { unmount } = renderWithUser(<QuestionPanel {...props} />);

    fireEvent.change(screen.getByLabelText('Your answer'), {
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
    const remounted = screen.getByLabelText('Your answer') as HTMLTextAreaElement;
    expect(remounted.value).toHaveLength(4096);
  });

  it('Escape then remount: the draft is gone from the store (persists nothing)', () => {
    const props = baseProps();
    const { unmount } = renderWithUser(<QuestionPanel {...props} />);

    const textarea = screen.getByLabelText('Your answer');
    fireEvent.change(textarea, { target: { value: 'draft text' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect((textarea as HTMLTextAreaElement).value).toBe('');

    unmount();
    renderWithUser(<QuestionPanel {...props} />);
    expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value).toBe('');
    const stored: Record<string, string> = JSON.parse(
      window.localStorage.getItem('starn.questionDrafts.v1') ?? '{}'
    );
    expect(stored.A).toBeUndefined();
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
  // ————— Board #53A: answer drafts survive close/reopen, unmount, reload —————
  it('draft survives close → reopen of the panel', async () => {
    const props = baseProps();
    const view = renderWithUser(<QuestionPanel {...props} />);

    const textarea = screen.getByLabelText('Your answer');
    await view.user.type(textarea, 'typed but not sent');

    // Close (surface 'closed' → panel renders nothing) then reopen.
    view.rerender(<QuestionPanel {...props} surface="closed" />);
    expect(screen.queryByLabelText('Your answer')).not.toBeInTheDocument();
    view.rerender(<QuestionPanel {...props} />);

    expect(screen.getByLabelText('Your answer')).toHaveValue('typed but not sent');
  });

  it('draft survives unmount + remount (page reload) via the persisted store', async () => {
    const props = baseProps();
    const first = renderWithUser(<QuestionPanel {...props} />);

    const textarea = screen.getByLabelText('Your answer');
    await first.user.type(textarea, 'survives a reload');
    first.unmount();

    // Fresh mount, as after a full page reload (same module store + storage).
    renderWithUser(<QuestionPanel {...baseProps()} />);
    expect(screen.getByLabelText('Your answer')).toHaveValue('survives a reload');
  });

  it('successful submit clears the draft (state and persisted store)', async () => {
    const props = baseProps();
    const view = renderWithUser(<QuestionPanel {...props} />);

    const textarea = screen.getByLabelText('Your answer');
    await view.user.type(textarea, 'send this');
    await view.user.keyboard('{Enter}');
    expect(props.onSubmit).toHaveBeenCalledTimes(1);

    expect(screen.getByLabelText('Your answer')).toHaveValue('');
    // The store cleared too: a fresh mount shows no draft.
    view.unmount();
    renderWithUser(<QuestionPanel {...baseProps()} />);
    expect(screen.getByLabelText('Your answer')).toHaveValue('');
  });

  it('failed submit keeps the draft in the composer', async () => {
    const failing = vi.fn(async () => { throw new Error('nope'); });
    const props = baseProps({ onSubmit: failing });
    const view = renderWithUser(<QuestionPanel {...props} />);

    const textarea = screen.getByLabelText('Your answer');
    await view.user.type(textarea, 'keep me');
    await view.user.keyboard('{Enter}');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    expect(screen.getByLabelText('Your answer')).toHaveValue('keep me');
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

  // ————— 15. Voice input in the answer composer (design §2) —————
  it('voice: renders the mic button with aria-label "Record answer"', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);

    expect(screen.getByRole('button', { name: 'Record answer' })).toBeInTheDocument();
  });

  it('voice: click mic starts recording; recording indicator becomes visible', async () => {
    const view = renderWithUser(<QuestionPanel {...baseProps()} />);

    const mic = screen.getByRole('button', { name: 'Record answer' });
    await view.user.click(mic);
    expect(voiceMock.startRecording).toHaveBeenCalledTimes(1);

    // Simulate the hook flipping to recording state.
    voiceMock.recording = true;
    view.rerender(<QuestionPanel {...baseProps()} />);

    expect(screen.getByText(/Recording…/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record answer' })).not.toBeInTheDocument();
  });

  it('voice: stop appends the transcribed text into the answer textarea', async () => {
    const view = renderWithUser(<QuestionPanel {...baseProps()} />);

    const textarea = screen.getByLabelText('Your answer');
    await view.user.type(textarea, 'typed ');

    voiceMock.recording = true;
    view.rerender(<QuestionPanel {...baseProps()} />);
    await view.user.click(screen.getByRole('button', { name: 'Stop recording' }));

    await vi.waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('typed Transcribed answer text');
    });
    expect(voiceMock.stopRecording).toHaveBeenCalledTimes(1);
  });

  it('voice: Alt-hold starts and releasing appends the transcription', async () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);

    fireEvent.keyDown(window, { key: 'Alt' });
    expect(voiceMock.startRecording).toHaveBeenCalledTimes(1);

    fireEvent.keyUp(window, { key: 'Alt' });
    await vi.waitFor(() => {
      const textarea = screen.getByLabelText('Your answer') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Transcribed answer text');
    });
  });

  it('voice: mic disabled while the composer is disabled (queued/applying)', () => {
    renderWithUser(<QuestionPanel {...baseProps({ answerStates: { A: { phase: 'queued' } } })} />);

    expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled();
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
      const textarea = screen.getByLabelText('Your answer') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Transcribed answer text');
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
      const textarea = screen.getByLabelText('Your answer') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Transcribed answer text');
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

  // ————— 16. Lifecycle colors + follow-up chip (design §3, board #52) —————
  it('lifecycle: queued state chip is sky (icon + word, never color alone)', () => {
    renderWithUser(<QuestionPanel {...baseProps({ answerStates: { A: { phase: 'queued' } } })} />);

    const chip = screen.getByText('Queued — applies after this phase');
    expect(chip.className).toContain('text-sky-300');
    expect(chip.className).not.toContain('amber');
  });

  it('lifecycle: follow-up chip is amber with the word Follow-up when the item has answer history', () => {
    const item = makeItem({
      id: 'A',
      meta: { answerHistory: [{ text: '42V nominal', at: '2025-01-01T00:00:00.000Z' }] },
    });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    const chip = screen.getByText('Follow-up');
    expect(chip.className).toContain('text-amber-300');
    expect(chip.className).toContain('bg-amber-950/40');
    expect(chip.className).toContain('border-amber-500/40');
  });

  it('lifecycle: no follow-up chip without answer history', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);

    expect(screen.queryByText('Follow-up')).not.toBeInTheDocument();
  });

  it('lifecycle: follow-up chip is a collapsed disclosure that expands to the prior answers (oldest first)', async () => {
    const item = makeItem({
      id: 'A',
      meta: {
        answerHistory: [
          { text: 'First reply', at: '2025-01-01T00:00:00.000Z' },
          { text: 'Second reply', at: '2025-01-02T00:00:00.000Z' },
        ],
      },
    });
    const { user } = renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    const toggle = screen.getByRole('button', { name: 'Follow-up' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('First reply')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = within(toggle.closest('div') as HTMLElement).getByRole('list');
    const entries = within(list).getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('First reply');
    expect(entries[0]).toHaveTextContent('2025-01-01');
    expect(entries[1]).toHaveTextContent('Second reply');
    expect(entries[1]).toHaveTextContent('2025-01-02');
  });

  it('lifecycle: nav dots — amber pending, sky queued, rose parked', () => {
    const A = makeItem({ id: 'A', title: 'Question A' }); // queued → sky
    const B = makeItem({ id: 'B', title: 'Question B', type: 'parked' }); // parked → rose
    const C = makeItem({ id: 'C', title: 'Question C' }); // pending → amber
    renderWithUser(
      <QuestionPanel
        {...baseProps({ items: [A, B, C], answerStates: { A: { phase: 'queued' } } })}
      />,
    );

    const dotOf = (name: string) =>
      screen.getByRole('button', { name: new RegExp(name) }).querySelector('span.rounded-full');
    expect(dotOf('Question A')?.className).toContain('bg-sky-400');
    expect(dotOf('Question B')?.className).toContain('bg-rose-400');
    expect(dotOf('Question C')?.className).toContain('bg-amber-400');
  });
});