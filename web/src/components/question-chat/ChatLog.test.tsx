import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { cleanup, renderWithUser } from '../../test/render';
import ChatLog, { type ChatLogProps } from './ChatLog';
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
const superseded: PortalThreadMessage = {
  role: 'user',
  text: '',
  ts: 4,
  kind: 'proposal',
  proposal: { status: 'superseded', basedOn: 2, text: 'Old draft.' }
};

function baseProps(overrides: Partial<ChatLogProps> = {}): ChatLogProps {
  return {
    id: 'q1',
    title: 'Fuse selectivity',
    messages: [],
    busy: false,
    editingProposal: false,
    onUseProposal: vi.fn(),
    onEditProposal: vi.fn(),
    onRejectProposal: vi.fn(),
    onSaveProposalEdit: vi.fn(),
    onCancelProposalEdit: vi.fn(),
    ...overrides
  };
}

describe('ChatLog — log element', () => {
  it('is a labelled log that only announces additions', () => {
    renderWithUser(<ChatLog {...baseProps({ messages: [ask] })} />);
    const log = screen.getByRole('log', { name: 'Conversation about Fuse selectivity' });
    expect(log).toHaveAttribute('aria-relevant', 'additions');
    expect(log).toHaveAttribute('id', 'qc-log-q1');
  });
});

describe('ChatLog — row variants', () => {
  it('renders the ask as a right-aligned bubble with a spoken prefix', () => {
    const { container } = renderWithUser(<ChatLog {...baseProps({ messages: [ask] })} />);
    const row = container.querySelector('.qchat-ask');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('You asked:');
    expect(row).toHaveTextContent('Is the fuse rated?');
    // Ask rows never claim anything was recorded (§8 DO-NOT 5).
    expect(screen.queryByText('Recorded answer')).toBeNull();
  });

  it('renders the specialist reply with its own label', () => {
    const { container } = renderWithUser(<ChatLog {...baseProps({ messages: [reply] })} />);
    expect(container.querySelector('.qchat-specialist-label')).toHaveTextContent('Specialist');
    expect(container.querySelector('.qchat-specialist-body')).toHaveTextContent(
      'Yes, 2 A slow-blow.'
    );
  });

  it('renders a recorded answer as a card with Lock, words and the state chip', () => {
    const { container } = renderWithUser(
      <ChatLog
        {...baseProps({
          messages: [recorded],
          recordedState: { label: 'Applied', tone: 'applied' }
        })}
      />
    );
    const card = container.querySelector('.qchat-recorded');
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent('Recorded answer');
    expect(card).toHaveTextContent('Use the 2 A fuse.');
    expect(card).toHaveTextContent('Applied');
    // Not colour-only: the Lock icon is a real element.
    expect(card?.querySelector('svg')).not.toBeNull();
  });

  it('renders a pending proposal as the shared ProposalCard', () => {
    renderWithUser(
      <ChatLog
        {...baseProps({
          proposal: { status: 'pending', basedOn: 4, text: 'Use the 2 A fuse.' }
        })}
      />
    );
    expect(screen.getByRole('group', { name: 'Proposed answer' })).toBeInTheDocument();
    expect(screen.getByText('Based on 4 messages')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use proposal' })).toBeInTheDocument();
  });

  it('collapses a superseded proposal to one muted line', () => {
    renderWithUser(<ChatLog {...baseProps({ messages: [superseded] })} />);
    expect(screen.getAllByText('Superseded proposal')).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Proposed answer' })).toBeNull();
  });
});

describe('ChatLog — status and errors', () => {
  it('shows the in-flight row while an ask is in flight', () => {
    renderWithUser(
      <ChatLog {...baseProps({ messages: [ask], busy: true, busyKind: 'ask' })} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Specialist is replying…');
  });

  it('does not show the replying row for an answer send', () => {
    renderWithUser(
      <ChatLog {...baseProps({ messages: [ask], busy: true, busyKind: 'answer' })} />
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('alerts with the saved-message copy and retries', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithUser(
      <ChatLog {...baseProps({ messages: [ask], error: 'Network down', onRetry })} />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't get a reply. Your message is saved.");
    expect(alert).toHaveTextContent('Network down');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
