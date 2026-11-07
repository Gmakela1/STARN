import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { cleanup, renderWithUser } from '../../test/render';
import ProposalCard, { type ProposalCardProps } from './ProposalCard';

afterEach(() => cleanup());

function baseProps(overrides: Partial<ProposalCardProps> = {}): ProposalCardProps {
  return {
    variant: 'research',
    title: 'Research proposal',
    text: 'Use the 2 A slow-blow fuse.',
    sources: [],
    editing: false,
    busy: false,
    onUse: vi.fn(),
    onEdit: vi.fn(),
    onReject: vi.fn(),
    onSaveEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    ...overrides
  };
}

describe('ProposalCard — research variant', () => {
  it('renders the shared labels and the proposed text', () => {
    renderWithUser(<ProposalCard {...baseProps()} />);
    expect(screen.getByRole('group', { name: 'Proposed answer' })).toBeInTheDocument();
    expect(screen.getByText('Use the 2 A slow-blow fuse.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use proposal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('lists sources as links and shows the rationale', () => {
    renderWithUser(
      <ProposalCard
        {...baseProps({
          sources: [{ title: 'Fuse datasheet', url: 'https://example.test/fuse' }],
          rationale: 'Derated 50%.'
        })}
      />
    );
    expect(screen.getByRole('link', { name: 'Fuse datasheet' })).toHaveAttribute(
      'href',
      'https://example.test/fuse'
    );
    expect(screen.getByText('Derated 50%.')).toBeInTheDocument();
  });

  it('fires onUse / onEdit / onReject', async () => {
    const props = baseProps();
    const { user } = renderWithUser(<ProposalCard {...props} />);
    await user.click(screen.getByRole('button', { name: 'Use proposal' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(props.onUse).toHaveBeenCalledTimes(1);
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(props.onReject).toHaveBeenCalledTimes(1);
  });
});

describe('ProposalCard — conclusion variant', () => {
  it('uses the conversation title and the Based on N messages meta line', () => {
    renderWithUser(
      <ProposalCard
        {...baseProps({
          variant: 'conclusion',
          title: 'Proposed answer — from this conversation',
          meta: 'Based on 3 messages'
        })}
      />
    );
    expect(screen.getByText('Proposed answer — from this conversation')).toBeInTheDocument();
    expect(screen.getByText('Based on 3 messages')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use proposal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    // No invented confidence percentage in the conclusion variant.
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });
});

describe('ProposalCard — edit path', () => {
  it('shows Use edited answer / Cancel and saves the edited text', async () => {
    const props = baseProps({ editing: true });
    const { user } = renderWithUser(<ProposalCard {...props} />);
    const box = screen.getByLabelText('Edit proposal');
    await user.clear(box);
    await user.type(box, 'Use the 3 A fuse.');
    await user.click(screen.getByRole('button', { name: 'Use edited answer' }));
    expect(props.onSaveEdit).toHaveBeenCalledWith('Use the 3 A fuse.');
  });

  it('Cancel calls onCancelEdit', async () => {
    const props = baseProps({ editing: true });
    const { user } = renderWithUser(<ProposalCard {...props} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('shows an error card and disables the commit buttons while busy', () => {
    renderWithUser(<ProposalCard {...baseProps({ busy: true, error: 'Proposal already used.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Proposal already used.');
    expect(screen.getByRole('button', { name: 'Use proposal' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });
});

describe('ProposalCard — target sizes', () => {
  it('gives every button the 44px minimum height class', () => {
    renderWithUser(<ProposalCard {...baseProps()} />);
    for (const name of ['Use proposal', 'Edit', 'Reject']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]');
    }
    cleanup();
    renderWithUser(<ProposalCard {...baseProps({ editing: true })} />);
    for (const name of ['Use edited answer', 'Cancel']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]');
    }
  });
});
