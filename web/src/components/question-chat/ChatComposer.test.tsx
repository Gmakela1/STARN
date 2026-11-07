import { useState } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { cleanup, renderWithUser } from '../../test/render';
import ChatComposer, { type ChatComposerProps, type ComposerMode } from './ChatComposer';

afterEach(() => cleanup());

/**
 * Stateful harness: the composer is fully controlled, so mode/value live here
 * exactly as they will in QuestionPanel (reset rules R1–R7 are the parent's).
 */
function Harness(overrides: Partial<ChatComposerProps> = {}) {
  const [value, setValue] = useState(overrides.value ?? '');
  const [mode, setMode] = useState<ComposerMode>(overrides.mode ?? 'advisory');
  const props: ChatComposerProps = {
    value,
    onChange: setValue,
    mode,
    onModeChange: setMode,
    onAsk: vi.fn(),
    onAnswer: vi.fn(),
    busy: false,
    disabled: false,
    recording: false,
    onMicDown: vi.fn(),
    onMicUp: vi.fn(),
    ...overrides
  };
  return <ChatComposer {...props} />;
}

describe('ChatComposer — keys', () => {
  it('Enter sends as a question (onAsk), never onAnswer', async () => {
    const onAsk = vi.fn();
    const onAnswer = vi.fn();
    const { user } = renderWithUser(<Harness onAsk={onAsk} onAnswer={onAnswer} />);
    await user.type(screen.getByRole('textbox'), 'Is the fuse rated?');
    await user.keyboard('{Enter}');
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('Enter in the answer skin sends as an answer (onAnswer)', async () => {
    const onAsk = vi.fn();
    const onAnswer = vi.fn();
    const { user } = renderWithUser(
      <Harness mode="answer" onAsk={onAsk} onAnswer={onAnswer} />
    );
    await user.type(screen.getByRole('textbox'), 'Use the 2 A fuse.');
    await user.keyboard('{Enter}');
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('Alt+A toggles the mode without sending and updates the live region', async () => {
    const onAsk = vi.fn();
    const onAnswer = vi.fn();
    const { user } = renderWithUser(
      <Harness value="Use the 2 A fuse." onAsk={onAsk} onAnswer={onAnswer} />
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Advisory mode — nothing is recorded');
    screen.getByRole('textbox').focus();
    await user.keyboard('{Alt>}a{/Alt}');
    expect(screen.getByRole('radio', { name: 'Answer' })).toHaveAttribute('aria-checked', 'true');
    expect(status).toHaveTextContent('Answer mode — sending records your answer');
    expect(onAsk).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('renders no Control+Enter shortcut anywhere', () => {
    const { container } = renderWithUser(<Harness value="Fuse" mode="answer" />);
    expect(container.innerHTML).not.toContain('Control+Enter');
    expect(container.innerHTML).not.toContain('Ctrl+Enter');
  });

  it('Shift+Enter inserts a newline instead of sending', async () => {
    const onAsk = vi.fn();
    const onAnswer = vi.fn();
    const { user } = renderWithUser(<Harness onAsk={onAsk} onAnswer={onAnswer} />);
    const box = screen.getByRole('textbox');
    await user.type(box, 'first{Shift>}{Enter}{/Shift}second');
    expect((box as HTMLTextAreaElement).value).toBe('first\nsecond');
    expect(onAsk).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('ignores Enter while an IME composition is in progress', () => {
    const onAsk = vi.fn();
    const onAnswer = vi.fn();
    renderWithUser(<Harness value="fusible" onAsk={onAsk} onAnswer={onAnswer} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
    expect(onAsk).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('disables the send verb on an empty draft in both skins', () => {
    const { unmount } = renderWithUser(<Harness />);
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    unmount();
    renderWithUser(<Harness mode="answer" />);
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
  });
});

describe('ChatComposer — mode control', () => {
  it('is one radiogroup with two radios and aria-checked follows the skin', () => {
    renderWithUser(<Harness />);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Advisory' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Answer' })).toHaveAttribute('aria-checked', 'false');
  });

  it('arrow keys switch mode and move focus', async () => {
    const { user } = renderWithUser(<Harness />);
    const advisory = screen.getByRole('radio', { name: 'Advisory' });
    advisory.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Answer' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Answer' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(advisory).toHaveAttribute('aria-checked', 'true');
    expect(advisory).toHaveFocus();
  });

  it('clicking a radio switches mode', async () => {
    const { user } = renderWithUser(<Harness />);
    await user.click(screen.getByRole('radio', { name: 'Answer' }));
    expect(screen.getByRole('radio', { name: 'Answer' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('ChatComposer — per-skin copy', () => {
  it('advisory skin: quiet header sentence, Ask label, advisory placeholder', () => {
    renderWithUser(<Harness />);
    expect(screen.getByText('Nothing is recorded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask the specialist…');
  });

  it('answer skin: commit sentence, Record label, answer placeholder', () => {
    renderWithUser(<Harness mode="answer" />);
    expect(screen.getByText('Sending records your answer — no undo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Write your answer…');
  });
});

describe('ChatComposer — locked rows', () => {
  it('queued row replaces the composer with icon + words', () => {
    renderWithUser(
      <Harness locked={{ kind: 'queued', text: 'Answer recorded — applies after this phase' }} />
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Answer recorded — applies after this phase')).toBeInTheDocument();
  });

  it('auto-applied row exposes Undo and fires it', async () => {
    const onUndo = vi.fn();
    const { user } = renderWithUser(
      <Harness locked={{ kind: 'auto', text: 'Auto-applied from research', onUndo }} />
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

describe('ChatComposer — Conclude from chat (§3c.7)', () => {
  it('does not exist in the advisory skin (concluding produces an answer)', () => {
    renderWithUser(<Harness canConclude />);
    expect(screen.queryByRole('button', { name: /Conclude/ })).toBeNull();
  });

  it('sits in the Answer skin mode bar and fires onConclude', async () => {
    const onConclude = vi.fn();
    const { user } = renderWithUser(<Harness mode="answer" canConclude onConclude={onConclude} />);

    const conclude = screen.getByRole('button', { name: 'Conclude from chat' });
    // The mode bar owns it — never the conversation band (§3c.10.6).
    expect(document.querySelector('.qchat-modehead')!.contains(conclude)).toBe(true);
    await user.click(conclude);
    expect(onConclude).toHaveBeenCalledTimes(1);
  });

  it('is hidden while a proposal is already pending', () => {
    renderWithUser(<Harness mode="answer" canConclude proposalPending />);
    expect(screen.queryByRole('button', { name: /Conclude/ })).toBeNull();
  });

  it('is disabled while a draft exists, so Conclude and Record are never both enabled', async () => {
    const { user } = renderWithUser(<Harness mode="answer" canConclude />);

    // Empty draft: Conclude is the one enabled verb.
    expect(screen.getByRole('button', { name: 'Conclude from chat' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'Use the 2 A fuse.');

    // Draft present: the inverse, same position, with the reason announced.
    expect(screen.getByRole('button', { name: 'Conclude from chat' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled();
    expect(
      screen.getByText('Clear the draft to draft an answer from the conversation.')
    ).toBeInTheDocument();

    await user.clear(screen.getByRole('textbox'));
    expect(screen.getByRole('button', { name: 'Conclude from chat' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
  });

  it('shows Drafting… with aria-busy while the server drafts', () => {
    renderWithUser(<Harness mode="answer" canConclude concluding />);
    const button = screen.getByRole('button', { name: 'Drafting…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    expect(screen.queryByText('Conclude from chat')).toBeNull();
  });
});

describe('ChatComposer — answer failure (R5)', () => {
  it('shows a role=alert card whose Retry as answer re-arms and re-sends', async () => {
    const onAnswer = vi.fn();
    const onModeChange = vi.fn();
    const { user } = renderWithUser(
      <Harness
        value="Use the 2 A fuse."
        answerError="Couldn't record your answer."
        onAnswer={onAnswer}
        onModeChange={onModeChange}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't record your answer.");
    await user.click(screen.getByRole('button', { name: 'Retry as answer' }));
    expect(onModeChange).toHaveBeenCalledWith('answer');
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
