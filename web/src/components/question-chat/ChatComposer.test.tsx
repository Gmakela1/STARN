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

  it('Control+Enter sends as an answer (onAnswer)', async () => {
    const onAsk = vi.fn();
    const onAnswer = vi.fn();
    const { user } = renderWithUser(<Harness onAsk={onAsk} onAnswer={onAnswer} />);
    await user.type(screen.getByRole('textbox'), 'Use the 2 A fuse.');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAsk).not.toHaveBeenCalled();
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
