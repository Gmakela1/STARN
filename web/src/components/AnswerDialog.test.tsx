import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import AnswerDialog from './AnswerDialog';
import { PortalItem } from '../types/api';
import { renderWithUser } from '../test/render';

const item: PortalItem = {
  id: 'q1',
  type: 'question',
  severity: 'blocking',
  docPath: 'docs/conops.md',
  section: 'design',
  title: 'Motor voltage?',
  detail: 'What voltage range should the controller expect?',
  status: 'open',
  source: 'autopilot',
  createdAt: '2026-11-03T00:00:00Z',
  updatedAt: '2026-11-03T00:00:00Z',
};

/** Build a keydown event, forcing isComposing so the IME guard path is exercised deterministically. */
function keyEvent(key: string, opts: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  if (opts.isComposing !== undefined) {
    Object.defineProperty(ev, 'isComposing', { value: opts.isComposing });
  }
  return ev;
}

describe('AnswerDialog', () => {
  const onSubmit = vi.fn<AnswerDialogSubmit>();
  const onClose = vi.fn();
  beforeEach(() => {
    onSubmit.mockReset();
    onClose.mockReset();
  });

  it('opens with initial focus in the textarea', () => {
    renderWithUser(<AnswerDialog item={item} onSubmit={onSubmit} onClose={onClose} />);
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('closes on backdrop click while the textarea is empty', () => {
    renderWithUser(<AnswerDialog item={item} onSubmit={onSubmit} onClose={onClose} />);
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on backdrop click once the user has typed (dirty guard)', async () => {
    const { user } = renderWithUser(<AnswerDialog item={item} onSubmit={onSubmit} onClose={onClose} />);
    await user.type(screen.getByRole('textbox'), 'use a 48V range');
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.mouseDown(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderWithUser(<AnswerDialog item={item} onSubmit={onSubmit} onClose={onClose} />);
    window.dispatchEvent(keyEvent('Escape'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while IME composition is active', () => {
    renderWithUser(<AnswerDialog item={item} onSubmit={onSubmit} onClose={onClose} />);
    window.dispatchEvent(keyEvent('Escape', { isComposing: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('submits on Enter and closes on success', async () => {
    onSubmit.mockResolvedValue(undefined);
    const { user } = renderWithUser(<AnswerDialog item={item} onSubmit={onSubmit} onClose={onClose} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'use 48V');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('q1', 'use 48V'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not submit on Shift+Enter and inserts a newline instead', async () => {
    const { user } = renderWithUser(<AnswerDialog item={item} onSubmit={onSubmit} onClose={onClose} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'first line');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe('first line\n'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not submit on Enter during IME composition', async () => {
    const { user } = renderWithUser(<AnswerDialog item={item} onSubmit={onSubmit} onClose={onClose} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'composition text');
    textarea.dispatchEvent(keyEvent('Enter', { isComposing: true }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the modal open and shows a role="alert" error when submission fails', async () => {
    onSubmit.mockRejectedValue(new Error('Network down'));
    const { user } = renderWithUser(<AnswerDialog item={item} onSubmit={onSubmit} onClose={onClose} />);
    await user.type(screen.getByRole('textbox'), 'an answer');
    fireEvent.click(screen.getByRole('button', { name: /^Send answer$/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Network down');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders Cancel and Send with the 44px minimum touch target', () => {
    renderWithUser(<AnswerDialog item={item} onSubmit={onSubmit} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('button', { name: /^Send answer$/ })).toHaveClass('min-h-[44px]');
  });
});

type AnswerDialogSubmit = (id: string, text: string) => Promise<void>;