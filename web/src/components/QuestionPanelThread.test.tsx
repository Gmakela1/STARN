import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, waitFor, screen } from '@testing-library/react';

// Module-scope stable fixtures for the mocked voice recorder (same seam as
// QuestionPanel.test.tsx — QuestionPanel always mounts the recorder hook).
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
import type { PortalItem } from '../types/api';

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await new Promise(resolve => setTimeout(resolve, 0));
  resetQuestionDraftsForTests();
  voiceMock.recording = false;
  voiceMock.error = null;
});

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
    onThreadMessage: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('QuestionPanel — advisory answer-thread chat', () => {
  it('renders the persisted transcript: user message and Specialist reply', () => {
    const item = makeItem({
      meta: {
        thread: [
          { role: 'user', text: 'Is 48V enough for the coil?', ts: 1 },
          { role: 'specialist', text: 'Yes — the datasheet rates the coil for 48V DC.', ts: 2 },
        ],
      },
    });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);
    expect(screen.getByText('Is 48V enough for the coil?')).toBeInTheDocument();
    expect(screen.getByText('Specialist')).toBeInTheDocument();
    expect(screen.getByText(/Yes — the datasheet rates the coil/)).toBeInTheDocument();
  });

  it('shows the advisory-only notice next to the chat input', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);
    expect(screen.getByText(/Advisory only — your answer goes through the response fields/)).toBeInTheDocument();
  });

  it('sends a typed advisory question through onThreadMessage and clears the input', async () => {
    const onThreadMessage = vi.fn(async () => {});
    const { user } = renderWithUser(<QuestionPanel {...baseProps({ onThreadMessage })} />);
    await user.type(screen.getByLabelText('Advisory question'), 'What about the coil?');
    await user.click(screen.getByRole('button', { name: 'Send advisory question' }));
    expect(onThreadMessage).toHaveBeenCalledWith('A', 'What about the coil?');
    expect(screen.getByLabelText('Advisory question')).toHaveValue('');
  });

  it('disables the send button while the advisory turn is in flight', async () => {
    let resolveTurn!: () => void;
    const onThreadMessage = vi.fn(
      () => new Promise<void>(resolve => { resolveTurn = resolve; })
    );
    const { user } = renderWithUser(<QuestionPanel {...baseProps({ onThreadMessage })} />);
    const input = screen.getByLabelText('Advisory question');
    await user.type(input, 'Hold on');
    const send = screen.getByRole('button', { name: 'Send advisory question' });
    await user.click(send);
    expect(onThreadMessage).toHaveBeenCalledTimes(1);
    expect(send).toBeDisabled();
    await act(async () => { resolveTurn(); });
    await waitFor(() => expect(onThreadMessage).toHaveBeenCalledTimes(1));
    // The draft is cleared on success; typing again re-enables the send button.
    expect(input).toHaveValue('');
    await user.type(input, 'again');
    await waitFor(() => expect(send).not.toBeDisabled());
  });

  it('surfaces advisory errors as an inline alert', async () => {
    const onThreadMessage = vi.fn(async () => { throw new Error('Advisory reply failed — try again'); });
    const { user } = renderWithUser(<QuestionPanel {...baseProps({ onThreadMessage })} />);
    await user.type(screen.getByLabelText('Advisory question'), 'Question?');
    await user.click(screen.getByRole('button', { name: 'Send advisory question' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Advisory reply failed');
  });

  it('no chat area for non-question items', () => {
    const parked = makeItem({ type: 'parked', title: 'Critic blocked' });
    renderWithUser(<QuestionPanel {...baseProps({ items: [parked] })} />);
    expect(screen.queryByLabelText('Advisory question')).not.toBeInTheDocument();
  });
});
