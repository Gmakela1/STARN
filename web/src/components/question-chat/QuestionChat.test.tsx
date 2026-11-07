import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { cleanup, renderWithUser } from '../../test/render';
import QuestionChat, { type QuestionChatProps } from './QuestionChat';
import type { ComposerMode } from './ChatComposer';
import type { PortalThreadMessage } from '../../types/api';

afterEach(() => cleanup());

const ask: PortalThreadMessage = { role: 'user', text: 'Is the fuse rated?', ts: 1, intent: 'ask' };
const reply: PortalThreadMessage = { role: 'specialist', text: 'Yes, 2 A slow-blow.', ts: 2 };

function baseProps(overrides: Partial<QuestionChatProps> = {}): QuestionChatProps {
  return {
    id: 'q1',
    title: '**Fuse selectivity** (coordination)',
    messages: [],
    expanded: false,
    onToggleExpanded: vi.fn(),
    busy: false,
    canConclude: false,
    concluding: false,
    onConclude: vi.fn(),
    editingProposal: false,
    onUseProposal: vi.fn(),
    onEditProposal: vi.fn(),
    onRejectProposal: vi.fn(),
    onSaveProposalEdit: vi.fn(),
    onCancelProposalEdit: vi.fn(),
    mode: 'advisory',
    onModeChange: vi.fn(),
    draft: '',
    onDraftChange: vi.fn(),
    onAsk: vi.fn(),
    onAnswer: vi.fn(),
    recording: false,
    onMicDown: vi.fn(),
    onMicUp: vi.fn(),
    ...overrides
  };
}

/** Parent-side harness: expanded + messages + draft live here, as in QuestionPanel. */
function Harness({
  initial = [] as PortalThreadMessage[],
  banner
}: {
  initial?: PortalThreadMessage[];
  banner?: ReactNode;
}) {
  const [messages, setMessages] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<ComposerMode>('advisory');
  return (
    <>
      <button type="button" onClick={() => setMessages(m => [...m, reply])}>
        inject reply
      </button>
      <QuestionChat
        {...baseProps()}
        messages={messages}
        expanded={expanded}
        onToggleExpanded={() => setExpanded(v => !v)}
        draft={draft}
        onDraftChange={setDraft}
        mode={mode}
        onModeChange={setMode}
        banner={banner}
        onAsk={() => {
          setMessages(m => [...m, { role: 'user', text: draft, ts: 99, intent: 'ask' }]);
          setDraft('');
        }}
      />
    </>
  );
}

/** Parent-side harness for the proposal-arrival path (§4.7). */
function ProposalHarness() {
  const [proposal, setProposal] = useState<PortalThreadMessage['proposal'] | null>(null);
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setProposal({ status: 'pending', basedOn: 2, text: 'Use the 2 A fuse.' })}
      >
        inject proposal
      </button>
      <QuestionChat
        {...baseProps({ messages: [ask, reply], proposal, expanded })}
        onToggleExpanded={() => setExpanded(v => !v)}
      />
    </>
  );
}

describe('QuestionChat — composition', () => {
  it('is a labelled section holding exactly one textarea', () => {
    const { container } = renderWithUser(<QuestionChat {...baseProps()} />);
    const section = screen.getByRole('region', {
      name: 'Conversation about Fuse selectivity (coordination)'
    });
    expect(section.querySelectorAll('textarea')).toHaveLength(1);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(container.querySelector('.qchat-wrap')).toBe(section);
  });

  it('starts collapsed when the thread already has history', () => {
    renderWithUser(<QuestionChat {...baseProps({ messages: [ask, reply] })} />);
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.getByRole('button', { name: /Conversation about/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('opens the log when the toggle is clicked', async () => {
    const { user } = renderWithUser(<Harness initial={[ask, reply]} />);
    await user.click(screen.getByRole('button', { name: /Conversation about/ }));
    expect(screen.getByRole('log', { name: 'Conversation about Fuse selectivity (coordination)' }))
      .toBeInTheDocument();
  });
});

describe('QuestionChat — banner slot (§3b.3.7)', () => {
  it('renders the banner shrink-0 between the log and the composer', async () => {
    const { user, container } = renderWithUser(
      <Harness initial={[ask, reply]} banner={<p>Resolved ✓</p>} />
    );

    await user.click(screen.getByRole('button', { name: /Conversation about/ }));

    const banner = screen.getByText('Resolved ✓');
    const slot = banner.parentElement!;
    expect(slot.className).toContain('shrink-0');

    const log = screen.getByRole('log');
    const composer = container.querySelector('.qchat-composer')!;
    expect(log.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('appends the caller className to the root section', () => {
    const { container } = renderWithUser(<QuestionChat {...baseProps({ className: 'flex-1' })} />);
    const section = container.querySelector('.qchat-wrap')!;
    expect(section.className).toContain('qchat-wrap');
    expect(section.className).toContain('flex-1');
  });
});

describe('QuestionChat — auto-expand (§4.7)', () => {
  it('auto-expands when a message is sent', async () => {
    const { user } = renderWithUser(<Harness />);
    expect(screen.queryByRole('log')).toBeNull();
    await user.type(screen.getByRole('textbox'), 'Is the fuse rated?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByRole('log')).toBeInTheDocument();
    expect(screen.getByText(/Is the fuse rated\?/)).toBeInTheDocument();
  });

  it('auto-expands when a new specialist reply arrives', async () => {
    const { user } = renderWithUser(<Harness initial={[ask]} />);
    expect(screen.queryByRole('log')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'inject reply' }));
    expect(screen.getByRole('log')).toBeInTheDocument();
    expect(screen.getByText('Yes, 2 A slow-blow.')).toBeInTheDocument();
  });

  it('auto-expands when a concluded proposal arrives', async () => {
    const { user } = renderWithUser(<ProposalHarness />);
    expect(screen.queryByRole('log')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'inject proposal' }));
    expect(screen.getByRole('group', { name: 'Proposed answer' })).toBeInTheDocument();
  });
});
