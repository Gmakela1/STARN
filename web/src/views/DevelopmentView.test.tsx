import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithUser, cleanup } from '../test/render';
import DevelopmentView from './DevelopmentView';
import { useAutopilotEvents } from '../hooks/useAutopilotEvents';
import { api } from '../api/client';
import type { ChatEntry, ActivityMeta } from '../api/useTurnStream';
import type { ProjectInfo, PortalItem } from '../types/api';

const mockedApi = vi.mocked(api);

vi.mock('../api/client', () => ({
  api: {
    fetchRoadmap: vi.fn().mockResolvedValue([]),
    fetchDoc: vi.fn().mockResolvedValue({ id: 'p1', content: '', status: 'draft' }),
    setActivePhase: vi.fn().mockResolvedValue({ activePhase: 'p1' }),
    autopilotStart: vi.fn().mockResolvedValue({ success: true }),
    autopilotStop: vi.fn().mockResolvedValue({ success: true }),
    autopilotResume: vi.fn().mockResolvedValue({ success: true }),
    fetchAutopilotStatus: vi.fn().mockResolvedValue({ enabled: false, running: false, docStatus: {}, blocks: 0, passedCount: 0, totalPhases: 13 }),
    fetchPortalItems: vi.fn().mockResolvedValue({ items: [] }),
    submitPortalAnswer: vi.fn().mockResolvedValue({ queued: true }),
    dismissPortalItem: vi.fn().mockResolvedValue({ success: true }),
    uploadExample: vi.fn().mockResolvedValue({ path: 'x', filename: 'x.md' }),
    fetchLibrary: vi.fn().mockResolvedValue({
      // Stable fixture: repository docs surface in the PromptBar source picker.
      references: [{ name: 'hardware-spec.md', size: 120, modified: '2025-01-01' }],
      examples: {}
    }),
    saveDoc: vi.fn().mockResolvedValue({ path: 'x' }),
    approveDoc: vi.fn().mockResolvedValue({ artifact: null })
  }
}));

// Controllable autopilot status / portal items (SSE stream is not available in jsdom).
const autopilotState = {
  status: null as ReturnType<typeof useAutopilotEvents>['status'],
  portalItems: [] as PortalItem[]
};

vi.mock('../hooks/useAutopilotEvents', () => ({
  useAutopilotEvents: (onEvent?: unknown) => ({
    status: autopilotState.status,
    portalItems: autopilotState.portalItems,
    connected: true,
    start: vi.fn(),
    stop: vi.fn(),
    resume: vi.fn(),
    submitAnswer: vi.fn(),
    dismissItem: vi.fn(),
    __onEvent: onEvent
  })
}));

// Voice recorder is stubbed (jsdom has no MediaRecorder/getUserMedia).
const voiceMock = {
  recording: false,
  startRecording: vi.fn(),
  stopRecording: vi.fn().mockResolvedValue('Transcribed answer text'),
  error: null as string | null
};

vi.mock('../hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: vi.fn(() => voiceMock)
}));

// DevelopmentView connects an SSE stream on mount; stub fetch with a
// never-resolving promise so no reconnect timers spin during tests.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  autopilotState.status = null;
  autopilotState.portalItems = [];
  voiceMock.recording = false;
  voiceMock.error = null;
  vi.clearAllMocks();
  vi.mocked(useAutopilotEvents).mockClear?.();
});

function makeProject() {
  return {
    id: 'proj-1',
    name: 'Test Project',
    activePhase: 'p1',
    summary: 's',
    summarySource: 'none' as const,
    openQuestionsCount: 0,
    openRisksCount: 0,
    models: { agent: 'm' },
    financials: { totalEstimated: 0, totalActual: 0, netVariance: 0, procurementProgressPercent: 0 }
  };
}

interface TurnStreamOverrides {
  busy?: boolean;
  status?: string | null;
  entries?: ChatEntry[];
  checkpoint?: unknown;
  toolActivity?: string | null;
}

function makeTurnStream(overrides: TurnStreamOverrides = {}) {
  return {
    entries: overrides.entries ?? [],
    busy: overrides.busy ?? false,
    status: overrides.status ?? null,
    toolActivity: overrides.toolActivity ?? null,
    checkpoint: overrides.checkpoint ?? null,
    error: null,
    autopilotStatus: null,
    portalItems: [],
    sendTurn: vi.fn().mockResolvedValue(undefined),
    abortTurn: vi.fn().mockResolvedValue(undefined),
    clearCheckpoint: vi.fn(),
    appendEntry: vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any; // partial stand-in for ReturnType<typeof useTurnStream>
}

function renderView(overrides: TurnStreamOverrides = {}, project: ProjectInfo | null = makeProject()) {
  const turnStream = makeTurnStream(overrides);
  const view = renderWithUser(
    <DevelopmentView
      turnStream={turnStream}
      project={project}
      onProjectChanged={vi.fn()}
    />
  );
  return { ...view, turnStream };
}

// ————— React Bits LatticeLoader in the chat footer —————
describe('DevelopmentView agents-working loader', () => {
  it('renders the LatticeLoader with the working label while a turn is busy', () => {
    renderView({ busy: true });
    expect(screen.getByText('Agents working…')).toBeInTheDocument();
  });

  it('hides the footer loader while autopilot runs; the rocket button carries the loader', () => {
    autopilotState.status = {
      enabled: true,
      running: true,
      docStatus: {},
      blocks: 0,
      passedCount: 0,
      totalPhases: 13
    };
    const { container } = renderView({ busy: false });
    // The in-button loader shows the agents-working label…
    const button = screen.getByRole('button', { name: 'Stop autopilot' });
    expect(button.textContent).toContain('Agents working…');
    // …while the footer loader (self-start) is hidden during autopilot.
    expect(container.querySelector('.ll-root.self-start')).toBeNull();
  });

  it('is absent when idle', () => {
    renderView({ busy: false });
    expect(screen.queryByText('Agents working…')).not.toBeInTheDocument();
    expect(screen.queryByText('Agents done')).not.toBeInTheDocument();
  });

  it('flashes the done state for ~2s after work finishes, then hides', () => {
    vi.useFakeTimers();
    try {
      const view = renderView({ busy: true });
      expect(screen.getByText('Agents working…')).toBeInTheDocument();
      view.rerender(
        <DevelopmentView
          turnStream={makeTurnStream({ busy: false })}
          project={makeProject()}
          onProjectChanged={vi.fn()}
        />
      );
      // 'Agents done' appears twice (visible label + sr-only announce);
      // inactive LatticeLoader labels stay mounted (opacity-0), so use *AllByText.
      expect(screen.getAllByText('Agents done').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Agents working…').length).toBeGreaterThan(0);
      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(screen.queryAllByText('Agents done')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ————— PromptBar composer (React Bits) —————
describe('DevelopmentView PromptBar composer', () => {
  it('sends the typed prompt through the existing turn pipeline on Enter', async () => {
    const { user, turnStream } = renderView({ busy: false });
    const textarea = screen.getByLabelText('Prompt');
    await user.type(textarea, 'draft the shopping list');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(turnStream.sendTurn).toHaveBeenCalledWith('draft the shopping list', { activePhase: '' });
    });
    // PromptBar clears its internal draft after sending.
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('');
    });
  });

  it('lists repository docs only in the submenu, not as direct picker rows', async () => {
    const { user } = renderView({ busy: false });
    await user.click(screen.getByRole('button', { name: 'Add files and sources' }));
    expect(await screen.findByRole('option', { name: /Attach from repository…/ })).toBeInTheDocument();
    // Docs are submenu-only: the top-level list must not duplicate them.
    expect(screen.queryByRole('option', { name: /hardware-spec\.md/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Attach from repository…/ }));
    expect(await screen.findByRole('option', { name: /hardware-spec\.md/ })).toBeInTheDocument();
  });

  it('morphs the send button into Stop while busy', () => {
    renderView({ busy: true });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('keeps the autopilot icon button outside the PromptBar (44px targets)', () => {
    renderView({ busy: false });
    expect(screen.getByRole('button', { name: 'Launch autopilot auto-drafting' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record voice message' })).not.toBeInTheDocument();
  });

  it('dictate button starts the recorder and flips to “Stop dictation”', async () => {
    const { user } = renderView({ busy: false });
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(voiceMock.startRecording).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Stop dictation' })).toBeInTheDocument();
  });

  it('second dictate click stops the recorder and injects the transcript', async () => {
    const { user, rerender } = renderView({ busy: false });
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    voiceMock.recording = true;
    rerender(
      <DevelopmentView turnStream={makeTurnStream({ busy: false })} project={makeProject()} onProjectChanged={vi.fn()} />
    );
    await user.click(screen.getByRole('button', { name: 'Stop dictation' }));
    await waitFor(() => {
      expect(voiceMock.stopRecording).toHaveBeenCalledTimes(1);
    });
    const textarea = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value).toBe('Transcribed answer text');
    });
  });

  it('surfaces the autopilot start error as an alert above the composer', async () => {
    mockedApi.autopilotStart.mockRejectedValueOnce(new Error('A turn is already in progress'));
    const { user } = renderView({ busy: false });
    await user.click(screen.getByRole('button', { name: 'Launch autopilot auto-drafting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't start auto-drafting — a turn is already running. Press Stop or wait, then retry."
    );
  });
});

// Silence unused-import lint noise for type-only re-exports used by future test groups.
export type { ChatEntry, ActivityMeta };
