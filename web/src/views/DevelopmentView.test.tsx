import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithUser, cleanup } from '../test/render';
import DevelopmentView from './DevelopmentView';
import { useAutopilotEvents } from '../hooks/useAutopilotEvents';
import type { ChatEntry, ActivityMeta } from '../api/useTurnStream';
import type { ProjectInfo, PortalItem } from '../types/api';

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
  return renderWithUser(
    <DevelopmentView
      turnStream={makeTurnStream(overrides)}
      project={project}
      onProjectChanged={vi.fn()}
    />
  );
}

// ————— React Bits LatticeLoader in the chat footer —————
describe('DevelopmentView agents-working loader', () => {
  it('renders the LatticeLoader with the working label while a turn is busy', () => {
    renderView({ busy: true });
    expect(screen.getByText('Agents working…')).toBeInTheDocument();
  });

  it('renders the loader while the autopilot status reports running', () => {
    autopilotState.status = {
      enabled: true,
      running: true,
      docStatus: {},
      blocks: 0,
      passedCount: 0,
      totalPhases: 13
    };
    renderView({ busy: false });
    expect(screen.getByText('Agents working…')).toBeInTheDocument();
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

// Silence unused-import lint noise for type-only re-exports used by future test groups.
export type { ChatEntry, ActivityMeta };
