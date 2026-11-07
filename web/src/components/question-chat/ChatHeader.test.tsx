import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { cleanup, renderWithUser } from '../../test/render';
import ChatHeader, { type ChatHeaderProps } from './ChatHeader';
import type { PortalThreadMessage } from '../../types/api';

afterEach(() => cleanup());

const ask: PortalThreadMessage = { role: 'user', text: 'Is the fuse rated?', ts: 1, intent: 'ask' };
const reply: PortalThreadMessage = { role: 'specialist', text: 'Yes, 2 A slow-blow.', ts: 2 };
const recorded: PortalThreadMessage = {
  role: 'user',
  text: 'Use the 2 A fuse.',
  ts: 3,
  intent: 'answer',
  kind: 'recorded'
};
const proposalRow: PortalThreadMessage = {
  role: 'user',
  text: '',
  ts: 4,
  kind: 'proposal',
  proposal: { status: 'pending', basedOn: 2, text: 'Use the 2 A fuse.' }
};

function baseProps(overrides: Partial<ChatHeaderProps> = {}): ChatHeaderProps {
  return {
    id: 'q1',
    title: '**Fuse selectivity** (coordination)',
    messages: [],
    expanded: false,
    onToggleExpanded: vi.fn(),
    canConclude: false,
    concluding: false,
    onConclude: vi.fn(),
    proposalPending: false,
    ...overrides
  };
}

describe('ChatHeader — label row', () => {
  it('labels by the cleaned title and never shows a Q-number', () => {
    const { container } = renderWithUser(<ChatHeader {...baseProps()} />);
    expect(container.textContent).toContain('Conversation about Fuse selectivity (coordination)');
    expect(container.textContent).not.toMatch(/Q\d/);
  });

  it('is non-interactive text when the thread is empty', () => {
    renderWithUser(<ChatHeader {...baseProps()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('counts user, specialist and recorded rows but not proposal rows', () => {
    renderWithUser(
      <ChatHeader {...baseProps({ messages: [ask, reply, recorded, proposalRow] })} />
    );
    expect(screen.getByText('3 messages in conversation')).toBeInTheDocument();
  });

  it('announces a waiting proposal in the sr-only count', () => {
    renderWithUser(
      <ChatHeader
        {...baseProps({ messages: [ask, reply, proposalRow], proposalPending: true })}
      />
    );
    expect(
      screen.getByText('2 messages in conversation, proposed answer waiting')
    ).toBeInTheDocument();
  });

  it('becomes one aria-expanded toggle that calls onToggleExpanded', async () => {
    const onToggleExpanded = vi.fn();
    const props = baseProps({ messages: [ask, reply], onToggleExpanded });
    const { user, rerender } = renderWithUser(<ChatHeader {...props} />);
    const toggle = screen.getByRole('button', { name: /Conversation about Fuse selectivity/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'qc-log-q1');
    await user.click(toggle);
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
    rerender(<ChatHeader {...props} expanded />);
    expect(screen.getByRole('button', { name: /Conversation about/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });
});

describe('ChatHeader — Conclude from chat', () => {
  it('is hidden when the thread has no specialist reply', () => {
    renderWithUser(<ChatHeader {...baseProps({ messages: [ask], canConclude: false })} />);
    expect(screen.queryByRole('button', { name: /Conclude from chat/ })).toBeNull();
  });

  it('is hidden while a proposal is pending', () => {
    renderWithUser(
      <ChatHeader
        {...baseProps({ messages: [ask, reply], canConclude: true, proposalPending: true })}
      />
    );
    expect(screen.queryByRole('button', { name: /Conclude from chat/ })).toBeNull();
  });

  it('fires onConclude when it can run', async () => {
    const onConclude = vi.fn();
    const { user } = renderWithUser(
      <ChatHeader {...baseProps({ messages: [ask, reply], canConclude: true, onConclude })} />
    );
    await user.click(screen.getByRole('button', { name: /Conclude from chat/ }));
    expect(onConclude).toHaveBeenCalledTimes(1);
  });

  it('shows Drafting… with aria-busy while the server drafts', () => {
    renderWithUser(
      <ChatHeader
        {...baseProps({
          messages: [ask, reply],
          canConclude: true,
          concluding: true
        })}
      />
    );
    const button = screen.getByRole('button', { name: 'Drafting…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    expect(screen.queryByText('Conclude from chat')).toBeNull();
  });
});
