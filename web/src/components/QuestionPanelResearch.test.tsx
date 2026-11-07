import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, waitFor, screen, within } from '@testing-library/react';

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
import type { PortalItem } from '../types/api';

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
    ...overrides,
  };
}

describe('QuestionPanel — research-all button + format-v2 sections', () => {
  it('renders the Research open questions button only when onResearchAll is provided', async () => {
    const { user } = renderWithUser(<QuestionPanel {...baseProps({ onResearchAll: vi.fn(async () => {}) })} />);
    const btn = screen.getByRole('button', { name: 'Research open questions' });
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    // aria label matches the visible copy (no icon-only affordance).
    expect(btn).toHaveTextContent('Research open questions');
  });

  it('no button without onResearchAll', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Research open questions' })).not.toBeInTheDocument();
  });

  it('calls onResearchAll once and disables while in flight', async () => {
    let resolveRun!: () => void;
    const onResearchAll = vi.fn(
      () => new Promise<void>(resolve => { resolveRun = resolve; })
    );
    const { user } = renderWithUser(<QuestionPanel {...baseProps({ onResearchAll })} />);
    const btn = screen.getByRole('button', { name: 'Research open questions' });
    await user.click(btn);
    expect(onResearchAll).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
    await act(async () => {
      resolveRun();
    });
    await waitFor(() => expect(btn).not.toBeDisabled());
    // A second click after completion fires again (one run at a time only).
    await user.click(btn);
    expect(onResearchAll).toHaveBeenCalledTimes(2);
  });

  it('surfaces onResearchAll errors as an alert', async () => {
    const onResearchAll = vi.fn(async () => { throw new Error('Autopilot chain is running'); });
    const { user } = renderWithUser(<QuestionPanel {...baseProps({ onResearchAll })} />);
    await user.click(screen.getByRole('button', { name: 'Research open questions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Autopilot chain is running');
  });

  it('the context header carries the BLUF; the memo sections stay out of the left pane', () => {
    const item = makeItem({
      meta: {
        sections: {
          bluf: 'Use the 50/50 glycol loop.',
          findings: 'Thermal dossier baselines glycol.\nSources: docs/THERMAL.md',
          suggestion: 'Glycol 50/50 — cheap and compatible.',
          alternatives: 'Straight water — freezes below 0 C.',
          defer: 'Stalls the pump BOM line.',
        },
      },
    });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    const header = screen.getByRole('region', { name: 'Question context' });
    expect(within(header).getByText('BLUF')).toBeInTheDocument();
    expect(within(header).getByText(/Use the 50\/50 glycol loop\./)).toBeInTheDocument();

    // QuestionDetails owns the memo rows (design §3b.3.6).
    expect(screen.queryByText('Research findings')).not.toBeInTheDocument();
    expect(screen.queryByText(/Thermal dossier baselines glycol/)).not.toBeInTheDocument();
    expect(screen.queryByText('Main suggestion')).not.toBeInTheDocument();
    expect(screen.queryByText('Alternatives')).not.toBeInTheDocument();
    expect(screen.queryByText('Defer')).not.toBeInTheDocument();
  });

  it('legacy items without sections render without the section block', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);
    expect(screen.queryByText('BLUF')).not.toBeInTheDocument();
    expect(screen.queryByText('Main suggestion')).not.toBeInTheDocument();
  });

  it('the legacy background alias moved to the right pane (no Background label here)', () => {
    const item = makeItem({ meta: { sections: { background: 'affects motor choice.' } } });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);
    expect(screen.queryByText('Background')).not.toBeInTheDocument();
    expect(screen.queryByText('affects motor choice.')).not.toBeInTheDocument();
  });

  it('list card shows the topic tag and BLUF preview line when sections exist', () => {
    const item = makeItem({
      title: 'Contactor voltage.',
      meta: {
        topic: 'ELEC',
        sections: { bluf: 'The main contactor is rated for 48V DC.' }
      }
    });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);
    // The title appears twice by design: the card heading and the
    // conversation label row ("Conversation about …").
    expect(screen.getAllByText('Contactor voltage.').length).toBeGreaterThan(0);
    expect(screen.getByText('ELEC')).toBeInTheDocument();
    expect(screen.getByText('The main contactor is rated for 48V DC.')).toBeInTheDocument();
  });

  it('the sections-first "Original detail" disclosure lives in the right pane, not here', () => {
    const wall = 'W'.repeat(400);
    const item = makeItem({
      meta: { sections: { bluf: 'Use the 50/50 glycol loop.' } },
      detail: wall
    });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    expect(screen.getByText(/Use the 50\/50 glycol loop\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Original detail' })).not.toBeInTheDocument();
    expect(screen.queryByText(wall)).not.toBeInTheDocument();
  });

  it('sections with no original text behind them render no collapsible; no sections keeps the plain detail', () => {
    renderWithUser(<QuestionPanel {...baseProps({ items: [makeItem({ meta: { sections: { bluf: 'Bluf.' } } })] })} />);
    expect(screen.queryByText('Original detail')).not.toBeInTheDocument();
  });

  // The left pane order (§3b.3.1): chips → context header (topic tag, pager,
  // source, title, BLUF) → conversation. Nothing memo-shaped between them.
  it('left-pane order: topic tag and BLUF in the context header, then the conversation', () => {
    const item = makeItem({
      title: 'Coolant choice.',
      meta: {
        topic: 'THERM',
        sections: {
          bluf: 'Use the 50/50 glycol loop.',
          findings: 'Thermal dossier baselines glycol.',
          suggestion: 'Glycol 50/50 — cheap and compatible.',
          alternatives: 'Straight water — freezes below 0 C.',
          defer: 'Stalls the pump BOM line.'
        }
      }
    });
    renderWithUser(
      <QuestionPanel {...baseProps({ items: [item], onThreadMessage: vi.fn(async () => {}) })} />
    );

    const header = screen.getByRole('region', { name: 'Question context' });
    // Topic tag and BLUF are header slots now (the old card hero is gone).
    expect(within(header).getByText('THERM')).toBeInTheDocument();
    expect(within(header).getByText(/Use the 50\/50 glycol loop\./)).toBeInTheDocument();
    expect(document.querySelector('.sf-bluf-callout')).toBeNull();

    const chat = screen.getByRole('region', { name: 'Conversation about Coolant choice.' });
    expect(
      header.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(within(chat).getAllByRole('textbox')).toHaveLength(1);
  });

  it('the research proposal card renders in the conversation banner slot', () => {
    const item = makeItem({
      meta: {
        thread: [{ role: 'user', text: 'Is 48 V enough?', ts: 1 }],
        proposedAnswer: {
          answer: '48V per the vendor datasheet.',
          sources: [{ title: 'Vendor datasheet', url: 'https://vendor.example/ds.pdf' }],
          confidence: 0.7,
          rationale: 'Stated verbatim.'
        }
      }
    });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);

    const chat = screen.getByRole('region', { name: 'Conversation about Question A' });
    const card = within(chat).getByText('Research proposal — 70% confidence');
    // Between the log and the composer: the card precedes the composer's one
    // textarea and follows the (collapsed) log band.
    const composer = within(chat).getByRole('textbox');
    expect(card.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(chat).getByRole('button', { name: 'Use proposal' })).toBeInTheDocument();
  });
});
