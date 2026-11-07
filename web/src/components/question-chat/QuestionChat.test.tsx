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

/** Parent-side harness: messages + draft + mode live here, as in QuestionPanel. */
function Harness({
  initial = [] as PortalThreadMessage[],
  banner
}: {
  initial?: PortalThreadMessage[];
  banner?: ReactNode;
}) {
  const [messages, setMessages] = useState(initial);
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

  it('always renders the log — there is no collapse toggle (§3c.10.1)', () => {
    renderWithUser(<QuestionChat {...baseProps({ messages: [ask, reply] })} />);

    const log = screen.getByRole('log', {
      name: 'Conversation about Fuse selectivity (coordination)'
    });
    expect(log).toHaveTextContent('Is the fuse rated?');
    expect(log).toHaveTextContent('Yes, 2 A slow-blow.');
    // No aria-expanded control anywhere in the region.
    expect(screen.queryByRole('button', { name: /Conversation about/ })).toBeNull();
    expect(screen.getByRole('region', { name: /Conversation about/ }).querySelector('[aria-expanded]'))
      .toBeNull();
  });

  it('renders the log before the composer, both inside the fill band', () => {
    const { container } = renderWithUser(<QuestionChat {...baseProps({ messages: [ask] })} />);
    const log = screen.getByRole('log');
    const composer = container.querySelector('.qchat-composer')!;
    expect(log.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.qchat')!.contains(log)).toBe(true);
  });
});

describe('QuestionChat — banner slot (§3b.3.7)', () => {
  it('renders the banner shrink-0 between the log and the composer', () => {
    renderWithUser(<Harness initial={[ask, reply]} banner={<p>Resolved ✓</p>} />);

    const banner = screen.getByText('Resolved ✓');
    const slot = banner.parentElement!;
    expect(slot.className).toContain('shrink-0');

    const log = screen.getByRole('log');
    const composer = document.querySelector('.qchat-composer')!;
    expect(log.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('appends the caller className to the root section', () => {
    const { container } = renderWithUser(
      <QuestionChat {...baseProps({ className: 'flex-1 min-h-0' })} />
    );
    const section = container.querySelector('.qchat-wrap')!;
    expect(section.className).toContain('qchat-wrap');
    expect(section.className).toContain('flex-1');
    expect(section.className).toContain('min-h-0');
  });
});

describe('QuestionChat — live rows', () => {
  it('appends a sent question to the always-visible log', async () => {
    const { user } = renderWithUser(<Harness />);
    await user.type(screen.getByRole('textbox'), 'Is the fuse rated?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByText(/Is the fuse rated\?/)).toBeInTheDocument();
  });

  it('renders a newly arrived specialist reply without expanding anything', async () => {
    const { user } = renderWithUser(<Harness initial={[ask]} />);
    await user.click(screen.getByRole('button', { name: 'inject reply' }));
    expect(screen.getByText('Yes, 2 A slow-blow.')).toBeInTheDocument();
  });
});

/** Parent-side mode harness: the composer is fully controlled (§2b.4). */
function ModeHarness(props: Partial<QuestionChatProps>) {
  const [mode, setMode] = useState<ComposerMode>('advisory');
  return <QuestionChat {...baseProps(props)} mode={mode} onModeChange={setMode} />;
}

describe('QuestionChat — Conclude from chat (§3c.7)', () => {
  it('forwards the conclude gate to the composer and renders it in the Answer skin', async () => {
    const onConclude = vi.fn();
    const { user } = renderWithUser(
      <ModeHarness messages={[ask, reply]} canConclude onConclude={onConclude} />
    );

    // Advisory skin: concluding produces an answer, so no button here.
    expect(screen.queryByRole('button', { name: /Conclude/ })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Answer' }));
    const conclude = screen.getByRole('button', { name: 'Conclude from chat' });
    expect(document.querySelector('.qchat-modehead')!.contains(conclude)).toBe(true);

    await user.click(conclude);
    expect(onConclude).toHaveBeenCalledTimes(1);
  });

  it('keeps Conclude out of the conversation band entirely', () => {
    renderWithUser(
      <QuestionChat
        {...baseProps({ messages: [ask, reply], mode: 'answer', canConclude: true })}
      />
    );
    const conclude = screen.getByRole('button', { name: 'Conclude from chat' });
    expect(screen.getByRole('log').contains(conclude)).toBe(false);
    expect(document.querySelector('.qchat-logwrap')!.contains(conclude)).toBe(false);
  });
});
