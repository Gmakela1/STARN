import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
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
/** §9 researcher row: question as text, band word + sources in `research`. */
const research: PortalThreadMessage = {
  role: 'specialist',
  text: 'What is the continuous rating of the ME1115 motor?',
  ts: 5,
  kind: 'research',
  research: {
    confidence: 0.62,
    band: 'medium',
    sources: [
      { title: 'ME1115 datasheet', url: 'https://vendor.example/me1115.pdf' },
      { title: 'Reference folder' }
    ]
  }
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

/**
 * jsdom reports every layout metric as 0, so the log's stick-to-bottom test
 * (scrollHeight - scrollTop - clientHeight <= 24) can never be exercised
 * without pinning the metrics the component actually reads.
 */
function pinMetrics(
  el: HTMLElement,
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }
): void {
  Object.defineProperty(el, 'scrollTop', {
    value: metrics.scrollTop,
    writable: true,
    configurable: true
  });
  Object.defineProperty(el, 'scrollHeight', { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: metrics.clientHeight, configurable: true });
}

/** jsdom has no Element.scrollTo; spy on the call instead of the position. */
function spyScrollTo(el: HTMLElement): ReturnType<typeof vi.fn> {
  const scrollTo = vi.fn();
  Object.defineProperty(el, 'scrollTo', { value: scrollTo, configurable: true });
  return scrollTo;
}

describe('ChatLog — log element', () => {
  it('is a labelled log that only announces additions', () => {
    renderWithUser(<ChatLog {...baseProps({ messages: [ask] })} />);
    const log = screen.getByRole('log', { name: 'Conversation about Fuse selectivity' });
    expect(log).toHaveAttribute('aria-relevant', 'additions');
    expect(log).toHaveAttribute('id', 'qc-log-q1');
  });

  it('carries no height cap and no minimum — the log fills the band (§3c.1)', () => {
    const { container } = renderWithUser(<ChatLog {...baseProps({ messages: [ask, reply] })} />);
    const log = screen.getByRole('log');
    // The class contract: no Tailwind max-h/min-h utility, no is-proposal cap.
    expect(log.className).toBe('qchat-log');
    expect(log.className).not.toMatch(/max-h|min-h/);

    // The measure lives on the column, and the log is the band's only scroller.
    const wrap = container.querySelector('.qchat-logwrap')!;
    const col = log.querySelector('.qchat-col')!;
    expect(wrap.contains(log)).toBe(true);
    expect(col.parentElement).toBe(log);
    expect(col).toHaveTextContent('Is the fuse rated?');
  });

  it('shows the empty state inside the log when the thread has no rows', () => {
    renderWithUser(<ChatLog {...baseProps()} />);
    const log = screen.getByRole('log');
    expect(log).toHaveTextContent('No conversation yet.');
    expect(log).toHaveTextContent('Ask the specialist below — nothing is recorded.');
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

  it('caps the bubble width with the min() recipe, not a fixed percentage', () => {
    const { container } = renderWithUser(<ChatLog {...baseProps({ messages: [ask] })} />);
    const row = container.querySelector('.qchat-ask')!;
    // `.qchat-ask { max-width: min(88%, 60ch) }` lives in index.css (§3c.6);
    // the element itself must carry no width utility that could win.
    expect(row.className).toBe('qchat-ask');
    expect(row.className).not.toMatch(/max-w-/);
  });

  it('renders the specialist reply with its own label', () => {
    const { container } = renderWithUser(<ChatLog {...baseProps({ messages: [reply] })} />);
    expect(container.querySelector('.qchat-specialist-label')).toHaveTextContent('Specialist');
    const body = container.querySelector('.qchat-specialist-body')!;
    expect(body).toHaveTextContent('Yes, 2 A slow-blow.');
    // No `ch` cap on the row: the column owns the measure (§3c.6).
    expect(body.className).not.toMatch(/max-w-/);
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

  it('renders a research row with the question, the band word and every source title', () => {
    const { container } = renderWithUser(<ChatLog {...baseProps({ messages: [research] })} />);
    const row = container.querySelector('[data-kind="research"]');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('Researcher');
    expect(row).toHaveTextContent('What is the continuous rating of the ME1115 motor?');
    // The band is a WORD, never a bare number and never colour alone.
    expect(row).toHaveTextContent('medium');
    expect(row).not.toHaveTextContent('0.62');
    expect(row).toHaveTextContent('ME1115 datasheet');
    expect(row).toHaveTextContent('Reference folder');
    // Violet left rule + 44 px minimum (§9).
    expect(row?.className).toMatch(/border-l-2/);
    expect(row?.className).toMatch(/min-h-\[44px\]/);
  });

  it('links a source that has a url and leaves a url-less source as text', () => {
    const { container } = renderWithUser(<ChatLog {...baseProps({ messages: [research] })} />);
    const links = container.querySelectorAll('[data-kind="research"] a');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('ME1115 datasheet');
    expect(links[0]).toHaveAttribute('href', 'https://vendor.example/me1115.pdf');
    expect(links[0]).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders no emoji in a research row', () => {
    const { container } = renderWithUser(<ChatLog {...baseProps({ messages: [research] })} />);
    const text = container.querySelector('[data-kind="research"]')?.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('does not render a research row as a specialist message', () => {
    const { container } = renderWithUser(
      <ChatLog {...baseProps({ messages: [research, reply] })} />
    );
    // Only the real reply carries the specialist label/body.
    expect(container.querySelectorAll('.qchat-specialist-label')).toHaveLength(1);
    expect(container.querySelectorAll('.qchat-specialist-body')).toHaveLength(1);
    expect(container.querySelector('[data-kind="research"]')).toHaveTextContent(
      'What is the continuous rating of the ME1115 motor?'
    );
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

describe('ChatLog — progressive scroll (§3c.3)', () => {
  it('jumps to the latest row instantly (never smooth) on a question switch', () => {
    const { rerender } = renderWithUser(<ChatLog {...baseProps({ messages: [ask, reply] })} />);
    const log = screen.getByRole('log');
    pinMetrics(log, { scrollTop: 0, scrollHeight: 900, clientHeight: 300 });
    const scrollTo = spyScrollTo(log);

    rerender(<ChatLog {...baseProps({ id: 'q2', title: 'Other', messages: [ask, reply] })} />);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'auto' });
  });

  it('does not move the view when a row arrives while the reader is scrolled up', () => {
    const { rerender } = renderWithUser(<ChatLog {...baseProps({ messages: [ask] })} />);
    const log = screen.getByRole('log');
    pinMetrics(log, { scrollTop: 0, scrollHeight: 900, clientHeight: 300 });
    const scrollTo = spyScrollTo(log);

    // The reader scrolls into history: 600 px above the bottom.
    fireEvent.scroll(log);

    rerender(<ChatLog {...baseProps({ messages: [ask, reply] })} />);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(log.scrollTop).toBe(0);
    // The pill is the only way back to the latest row.
    expect(screen.getByRole('button', { name: /Jump to latest/ })).toBeInTheDocument();
  });

  it('follows the new row when the reader is already at the bottom', () => {
    const { rerender } = renderWithUser(<ChatLog {...baseProps({ messages: [ask] })} />);
    const log = screen.getByRole('log');
    pinMetrics(log, { scrollTop: 600, scrollHeight: 900, clientHeight: 300 });
    const scrollTo = spyScrollTo(log);

    fireEvent.scroll(log);
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();

    rerender(<ChatLog {...baseProps({ messages: [ask, reply] })} />);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0][0]).toEqual({ top: 900, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
  });

  it('treats the 24 px band at the bottom as "at the bottom"', () => {
    const { rerender } = renderWithUser(<ChatLog {...baseProps({ messages: [ask] })} />);
    const log = screen.getByRole('log');
    pinMetrics(log, { scrollTop: 576, scrollHeight: 900, clientHeight: 300 });
    const scrollTo = spyScrollTo(log);

    fireEvent.scroll(log);
    rerender(<ChatLog {...baseProps({ messages: [ask, reply] })} />);

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('the Jump to latest pill jumps to the bottom and then hides', async () => {
    const { user } = renderWithUser(<ChatLog {...baseProps({ messages: [ask, reply] })} />);
    const log = screen.getByRole('log');
    pinMetrics(log, { scrollTop: 0, scrollHeight: 900, clientHeight: 300 });
    const scrollTo = spyScrollTo(log);

    fireEvent.scroll(log);
    const pill = screen.getByRole('button', { name: /Jump to latest/ });
    await user.click(pill);

    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
  });

  it('counts the rows that arrived while the reader was scrolled up', () => {
    const { rerender } = renderWithUser(<ChatLog {...baseProps({ messages: [ask] })} />);
    const log = screen.getByRole('log');
    pinMetrics(log, { scrollTop: 0, scrollHeight: 900, clientHeight: 300 });
    fireEvent.scroll(log);

    rerender(<ChatLog {...baseProps({ messages: [ask, reply, recorded] })} />);

    expect(screen.getByRole('button', { name: /Jump to latest/ })).toHaveTextContent('2');
  });
});
