import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, waitFor, screen } from '@testing-library/react';

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

  it('renders format-v2 sections: BLUF headline, findings, suggestion, alternatives, defer', () => {
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
    expect(screen.getByText('BLUF')).toBeInTheDocument();
    expect(screen.getByText('Use the 50/50 glycol loop.')).toBeInTheDocument();
    expect(screen.getByText('Research findings')).toBeInTheDocument();
    expect(screen.getByText(/Thermal dossier baselines glycol/)).toBeInTheDocument();
    expect(screen.getByText('Main suggestion')).toBeInTheDocument();
    expect(screen.getByText('Alternatives')).toBeInTheDocument();
    expect(screen.getByText('Defer')).toBeInTheDocument();
  });

  it('legacy items without sections render without the section block', () => {
    renderWithUser(<QuestionPanel {...baseProps()} />);
    expect(screen.queryByText('BLUF')).not.toBeInTheDocument();
    expect(screen.queryByText('Main suggestion')).not.toBeInTheDocument();
  });

  it('legacy background alias renders under a Background label', () => {
    const item = makeItem({ meta: { sections: { background: 'affects motor choice.' } } });
    renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);
    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(screen.getByText('affects motor choice.')).toBeInTheDocument();
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
    expect(screen.getByText('Contactor voltage.')).toBeInTheDocument();
    expect(screen.getByText('ELEC')).toBeInTheDocument();
    expect(screen.getByText('The main contactor is rated for 48V DC.')).toBeInTheDocument();
  });

  it('sections-first detail: raw legacy body hides behind a muted collapsible when sections exist', async () => {
    const wall = 'W'.repeat(400);
    const item = makeItem({
      meta: { sections: { bluf: 'Use the 50/50 glycol loop.' } },
      detail: wall
    });
    const { user } = renderWithUser(<QuestionPanel {...baseProps({ items: [item] })} />);
    expect(screen.getByText('Use the 50/50 glycol loop.')).toBeInTheDocument();
    expect(screen.queryByText(wall)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Original detail' }));
    expect(screen.getByText(wall)).toBeInTheDocument();
  });

  it('sections with no original text behind them render no collapsible; no sections keeps the plain detail', () => {
    renderWithUser(<QuestionPanel {...baseProps({ items: [makeItem({ meta: { sections: { bluf: 'Bluf.' } } })] })} />);
    expect(screen.queryByText('Original detail')).not.toBeInTheDocument();
  });

  // V2 card order: short title + topic chip → BLUF hero → findings →
  // suggestion (primary) → alternatives → defer (muted) → response area →
  // advisory chat (footer). Here we lock the headline invariants: BLUF hero
  // precedes the findings row, and the topic chip sits with the title.
  it('v2 card order: BLUF hero before findings; topic chip beside the title', () => {
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
    // onThreadMessage is required for the footer advisory thread to mount.
    const { container } = renderWithUser(
      <QuestionPanel {...baseProps({ items: [item], onThreadMessage: vi.fn(async () => {}) })} />
    );
    const hero = container.querySelector('.sf-bluf-callout');
    expect(hero).not.toBeNull();
    expect(hero!.textContent).toContain('Use the 50/50 glycol loop.');
    const findings = screen.getByText('Research findings');
    // BLUF hero must precede the findings row in DOM order.
    expect(hero!.compareDocumentPosition(findings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Topic chip renders beside the short title.
    expect(screen.getByText('THERM')).toBeInTheDocument();
    // Advisory chat lives in the footer, after the response area.
    const composer = screen.getByLabelText('Send answer');
    const chat = screen.getByText('Ask the specialist');
    expect(composer.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
