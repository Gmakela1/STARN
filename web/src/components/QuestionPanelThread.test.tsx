import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

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
import type { PortalItem, PortalThreadMessage } from '../types/api';

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

/** The single per-question textarea — QuestionChat's composer owns it. */
function textbox(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

const ASK_ROW: PortalThreadMessage = { role: 'user', text: 'Is 48V enough for the coil?', ts: 1 };
const REPLY_ROW: PortalThreadMessage = {
  role: 'specialist',
  text: 'Yes — the datasheet rates the coil for 48V DC.',
  ts: 2,
};
const PROPOSAL_ROW: PortalThreadMessage = {
  role: 'specialist',
  text: 'Use a 60 A upstream fuse.',
  ts: 3,
  kind: 'proposal',
  proposal: { status: 'pending', basedOn: 2, text: 'Use a 60 A upstream fuse.' },
};

describe('QuestionPanel — one per-question conversation', () => {
  // ————— structure —————
  it('renders the persisted transcript with no toggle — the chat window is always open', () => {
    const item = makeItem({ meta: { thread: [ASK_ROW, REPLY_ROW] } });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    expect(screen.getByText(ASK_ROW.text)).toBeInTheDocument();
    expect(screen.getByText('Specialist')).toBeInTheDocument();
    expect(screen.getByText(REPLY_ROW.text)).toBeInTheDocument();

    // §3c.10.1 — no collapse toggle and no aria-expanded control in the pane.
    expect(screen.queryByRole('button', { name: /Conversation about/ })).toBeNull();
    expect(screen.getByRole('log', { name: 'Conversation about Question A' })).toBeInTheDocument();
  });

  it('the card has exactly one textbox and none of the removed copy', () => {
    const item = makeItem({ meta: { thread: [ASK_ROW, REPLY_ROW] } });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByText('Ask the specialist', { ignore: '.sr-only' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Advisory only/, { ignore: '.sr-only' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Advisory question')).not.toBeInTheDocument();
  });

  it('the memo body leaves the left pane: chips → context header → conversation', () => {
    const item = makeItem({
      meta: {
        thread: [ASK_ROW],
        sections: {
          bluf: 'Close the 72 V bus with a selective fuse pair.',
          findings: 'Vendor datasheet: upstream 60 A, downstream 30 A.',
          suggestion: 'Use 60 A upstream and 30 A downstream.',
        },
      },
    });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    // Only the BLUF survives here, inside the context header (§3b.4); findings
    // and suggestion are QuestionDetails' (right pane) business now.
    const bluf = screen.getByText(/Close the 72 V bus with a selective fuse pair\./);
    expect(screen.queryByText('Vendor datasheet: upstream 60 A, downstream 30 A.')).not.toBeInTheDocument();
    expect(screen.queryByText('Use 60 A upstream and 30 A downstream.')).not.toBeInTheDocument();

    const header = screen.getByRole('region', { name: 'Question context' });
    const conversation = screen.getByRole('region', { name: 'Conversation about Question A' });
    expect(header.contains(bluf)).toBe(true);

    const following = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(following(header, conversation)).toBe(true);

    // The conversation is the pane's grow band (no separate memo scroller).
    expect(conversation.className).toContain('flex-1');
    expect(conversation.className).not.toMatch(/max-h/);
  });

  it('the answer state chip rides the conversation banner slot, above the composer', () => {
    const item = makeItem({ meta: { thread: [ASK_ROW, REPLY_ROW] } });
    renderWithUser(
      <QuestionPanel {...baseProps({ items: [item], answerStates: { A: { phase: 'failed' } } })} />
    );

    const chat = screen.getByRole('region', { name: 'Conversation about Question A' });
    const chip = within(chat).getByText("Couldn't apply");
    const composer = within(chat).getByRole('textbox');
    // Banner sits between the log and the composer (design §3b.3.7).
    expect(chip.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(chat).getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  // ————— the two verbs —————
  it('Enter in advisory mode asks the specialist (onThreadMessage), records nothing', async () => {
    const onThreadMessage = vi.fn(async () => {});
    const props = baseProps({ onThreadMessage });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    await user.type(textbox(), 'What about the coil?');
    await user.keyboard('{Enter}');

    expect(onThreadMessage).toHaveBeenCalledWith('A', 'What about the coil?');
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('Enter in answer mode submits the answer (onSubmit) and returns to advisory', async () => {
    const onThreadMessage = vi.fn(async () => {});
    const props = baseProps({ onThreadMessage });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    await user.click(screen.getByRole('radio', { name: 'Answer' }));
    await user.type(textbox(), 'Use the 2 A fuse.');
    await user.keyboard('{Enter}');

    expect(props.onSubmit).toHaveBeenCalledWith('A', 'Use the 2 A fuse.');
    expect(onThreadMessage).not.toHaveBeenCalled();
    // R1 — advisory again after the send.
    expect(screen.getByRole('radio', { name: 'Advisory' })).toHaveAttribute('aria-checked', 'true');
  });

  it('an Ask in flight shows the replying row and disables both verbs', async () => {
    let resolveAsk!: () => void;
    const onThreadMessage = vi.fn(() => new Promise<void>(res => { resolveAsk = res; }));
    const { user } = renderWithUser(<QuestionPanel {...baseProps({ onThreadMessage })} />);

    await user.type(textbox(), 'Hold on');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(onThreadMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Specialist is replying…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();

    resolveAsk();
    await vi.waitFor(() => expect(textbox()).toHaveValue(''));
  });

  it('an Ask failure keeps the draft and shows the alert with Retry', async () => {
    const onThreadMessage = vi.fn(async () => {
      throw new Error('Advisory reply failed — try again');
    });
    const { user } = renderWithUser(<QuestionPanel {...baseProps({ onThreadMessage })} />);

    await user.type(textbox(), 'Question?');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Advisory reply failed');
    expect(textbox()).toHaveValue('Question?');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  // ————— siloing —————
  it('switching chips swaps the conversation and leaks no text between items', async () => {
    const A = makeItem({ id: 'A', title: 'Question A', meta: { thread: [ASK_ROW, REPLY_ROW] } });
    const B = makeItem({
      id: 'B',
      title: 'Question B',
      meta: { thread: [{ role: 'user', text: 'B-only question', ts: 5 }] },
    });
    const props = baseProps({ items: [A, B] });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    expect(screen.getByText(ASK_ROW.text)).toBeInTheDocument();
    await user.type(textbox(), 'draft for A');

    await user.click(screen.getByRole('button', { name: /^Question B/ }));

    // B's conversation, not A's rows, and none of A's draft.
    expect(screen.queryByText(ASK_ROW.text)).not.toBeInTheDocument();
    expect(screen.queryByText(REPLY_ROW.text)).not.toBeInTheDocument();
    expect(textbox()).toHaveValue('');

    expect(screen.getByText('B-only question')).toBeInTheDocument();

    // Back to A: its own draft is still there, B's rows are gone.
    await user.click(screen.getByRole('button', { name: /^Question A/ }));
    expect(textbox()).toHaveValue('draft for A');
    expect(screen.queryByText('B-only question')).not.toBeInTheDocument();
  });

  // ————— nav-chip pill (§4.6) —————
  it('the nav chip shows the conversation count with sr-only text', () => {
    const A = makeItem({ id: 'A', title: 'Question A', meta: { thread: [ASK_ROW, REPLY_ROW] } });
    const B = makeItem({ id: 'B', title: 'Question B' });
    renderWithUser(<QuestionPanel {...baseProps({ items: [A, B] })} />);

    const chipA = screen.getByRole('button', { name: /^Question A/ });
    expect(chipA).toHaveTextContent('2 messages in conversation');
    const pill = chipA.querySelector('.qchat-chip');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toBe('2');

    // No conversation, no pill.
    const chipB = screen.getByRole('button', { name: /^Question B/ });
    expect(chipB.querySelector('.qchat-chip')).toBeNull();
    expect(chipB).not.toHaveTextContent('messages in conversation');
  });

  it('a pending proposal swaps the nav-chip icon to ListChecks and says so', () => {
    const A = makeItem({ id: 'A', title: 'Question A', meta: { thread: [ASK_ROW, REPLY_ROW, PROPOSAL_ROW] } });
    const B = makeItem({ id: 'B', title: 'Question B' });
    renderWithUser(<QuestionPanel {...baseProps({ items: [A, B] })} />);

    const chipA = screen.getByRole('button', { name: /^Question A/ });
    // Proposal rows never count as messages.
    expect(chipA).toHaveTextContent('2 messages in conversation, proposed answer waiting');
    const pill = chipA.querySelector('.qchat-chip');
    expect(pill!.className).toContain('is-proposal');
    expect(pill!.querySelector('svg')!.getAttribute('class')).toContain('lucide-list-checks');
  });

  // ————— Conclude from chat (§3c.7 — the composer's Answer skin) —————
  it('Conclude appears in the composer only after a specialist reply and calls onConcludeThread', async () => {
    const onConcludeThread = vi.fn(async () => {});
    const asked = makeItem({ id: 'A', title: 'Question A', meta: { thread: [ASK_ROW] } });
    const answered = makeItem({ id: 'B', title: 'Question B', meta: { thread: [ASK_ROW, REPLY_ROW] } });
    const props = baseProps({ items: [asked, answered], onConcludeThread });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    // Advisory skin never concludes; A has no specialist reply either way.
    expect(screen.queryByRole('button', { name: 'Conclude from chat' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Answer' }));
    expect(screen.queryByRole('button', { name: 'Conclude from chat' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Question B/ }));
    // A chip switch returns the composer to advisory (R1), so re-arm it.
    await user.click(screen.getByRole('radio', { name: 'Answer' }));
    const conclude = screen.getByRole('button', { name: 'Conclude from chat' });
    // It lives at the submit area, not above the log (§3c.10.6).
    expect(within(screen.getByRole('region', { name: 'Conversation about Question B' })).getByRole('button', { name: 'Conclude from chat' })).toBe(conclude);
    await user.click(conclude);

    expect(onConcludeThread).toHaveBeenCalledWith('B');
  });

  it('Conclude is hidden while a proposal is already pending', async () => {
    const item = makeItem({ meta: { thread: [ASK_ROW, REPLY_ROW, PROPOSAL_ROW] } });
    const props = baseProps({ items: [item], onConcludeThread: vi.fn(async () => {}) });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    await user.click(screen.getByRole('radio', { name: 'Answer' }));
    expect(screen.queryByRole('button', { name: 'Conclude from chat' })).not.toBeInTheDocument();
  });

  // ————— the concluded proposal card (§4.4) —————
  it('the pending proposal card uses it, edits it, or rejects it with the proposal ts', async () => {
    const onConfirmThreadProposal = vi.fn(async () => {});
    const onRejectThreadProposal = vi.fn(async () => {});
    const item = makeItem({ meta: { thread: [ASK_ROW, REPLY_ROW, PROPOSAL_ROW] } });
    const props = baseProps({ items: [item], onConfirmThreadProposal, onRejectThreadProposal });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    const card = screen.getByRole('group', { name: 'Proposed answer' });
    expect(card).toHaveTextContent('Based on 2 messages');

    await user.click(within(card).getByRole('button', { name: 'Use proposal' }));
    expect(onConfirmThreadProposal).toHaveBeenCalledWith('A', 3, undefined);

    // Edit → Use edited answer carries the edited text.
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const edit = screen.getByLabelText('Edit proposal') as HTMLTextAreaElement;
    expect(edit.value).toBe(PROPOSAL_ROW.text);
    await user.clear(edit);
    await user.type(edit, 'Use a 50 A upstream fuse.');
    await user.click(screen.getByRole('button', { name: 'Use edited answer' }));
    expect(onConfirmThreadProposal).toHaveBeenLastCalledWith('A', 3, 'Use a 50 A upstream fuse.');

    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(onRejectThreadProposal).toHaveBeenCalledWith('A', 3);
  });

  it('Escape cancels an open proposal edit before it clears the draft', async () => {
    const item = makeItem({ meta: { thread: [ASK_ROW, REPLY_ROW, PROPOSAL_ROW] } });
    const props = baseProps({ items: [item] });
    const { user } = renderWithUser(<QuestionPanel {...props} />);

    await user.type(textbox(), 'my draft');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Edit proposal')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    // Edit cancelled, draft untouched, panel still open.
    expect(screen.queryByLabelText('Edit proposal')).not.toBeInTheDocument();
    expect(textbox()).toHaveValue('my draft');
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(textbox()).toHaveValue('');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('a recorded answer row renders Lock + the words "Recorded answer"', async () => {
    const recorded: PortalThreadMessage = {
      role: 'user',
      text: 'Use the 2 A fuse.',
      ts: 4,
      intent: 'answer',
      kind: 'recorded',
    };
    const item = makeItem({ meta: { thread: [ASK_ROW, REPLY_ROW, recorded] } });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    expect(screen.getByText('Recorded answer')).toBeInTheDocument();
    expect(screen.getByText('Use the 2 A fuse.')).toBeInTheDocument();
  });

  it('no conversation region for non-question items', () => {
    const parked = makeItem({ type: 'parked', title: 'Critic blocked' });
    renderWithUser(<QuestionPanel {...baseProps({ items: [parked] })} />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: /Conversation about/ })
    ).not.toBeInTheDocument();
  });
});
