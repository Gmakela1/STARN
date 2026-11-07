import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
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
    approveDoc: vi.fn().mockResolvedValue({ artifact: null }),
    fetchDocDiff: vi.fn().mockResolvedValue({ phaseId: 'p1', approved: null, current: '', approvedAvailable: false })
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

// ————— Revised-doc diff view (plan 2026-10-31) —————
describe('DevelopmentView revised-doc diff view', () => {
  /** Revised fixture: roadmap with one phase, autopilot docStatus 'revised'. */
  function revisedSetup(docContent: string) {
    mockedApi.fetchRoadmap.mockResolvedValue([
      {
        id: 'P1',
        name: 'BOM',
        artifactPath: 'docs/BOM.md',
        docExists: true,
        status: 'COMPLETED'
      }
    ] as never);
    autopilotState.status = {
      enabled: false,
      running: false,
      docStatus: { P1: 'revised' },
      blocks: 0,
      passedCount: 0,
      totalPhases: 13
    };
    mockedApi.fetchDoc.mockResolvedValue({
      phaseId: 'P1',
      path: 'docs/BOM.md',
      content: docContent,
      status: 'approved'
    } as never);
  }

  it('shows the revised banner and renders the diff on toggle with a lazy one-time fetch', async () => {
    revisedSetup('line1\nline2 changed\nline3\nline4');
    mockedApi.fetchDocDiff.mockResolvedValue({
      phaseId: 'P1',
      approved: 'line1\nline2\nline3',
      current: 'line1\nline2 changed\nline3\nline4',
      approvedAvailable: true
    });
    const { user } = renderView();
    expect(await screen.findByText('Revised — changes since approval')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Toggle diff view' }));
    expect(await screen.findByLabelText('Document diff')).toBeInTheDocument();
    expect(mockedApi.fetchDocDiff).toHaveBeenCalledTimes(1);

    // Off hides the pane; on again reuses the cached snapshot (no refetch).
    await user.click(screen.getByRole('button', { name: 'Toggle diff view' }));
    expect(screen.queryByLabelText('Document diff')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Toggle diff view' }));
    expect(await screen.findByLabelText('Document diff')).toBeInTheDocument();
    expect(mockedApi.fetchDocDiff).toHaveBeenCalledTimes(1);
  });

  it('falls back to not-archived wording without a diff pane when no snapshot matches', async () => {
    revisedSetup('current content');
    mockedApi.fetchDocDiff.mockResolvedValue({
      phaseId: 'P1',
      approved: null,
      current: 'current content',
      approvedAvailable: false
    });
    const { user } = renderView();
    expect(await screen.findByText('Revised — changes since approval')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Toggle diff view' }));
    expect(await screen.findByText('Revised (original version not archived)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Document diff')).toBeNull();
  });
});

// ————— Right pane: Document / Details (design 2026-11-03 §3b) —————
describe('DevelopmentView right pane Document / Details switch', () => {
  const questionA: PortalItem = {
    id: 'q-a',
    type: 'question',
    severity: 'normal',
    docPath: 'docs/RTM.md',
    title: 'Fuse selectivity',
    detail: 'SS-04.e fuse selectivity needs a formal check.',
    status: 'open',
    source: 'autopilot',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    meta: { sections: { bluf: 'No formal selectivity check on record.' } }
  };
  const questionB: PortalItem = {
    ...questionA,
    id: 'q-b',
    docPath: 'docs/BOM.md',
    title: 'Relay coil creepage',
    detail: 'SS-05.a relay coil creepage is unverified.'
  };
  const parkedItem: PortalItem = {
    ...questionA,
    id: 'p-1',
    type: 'parked',
    title: 'Parked item',
    meta: undefined
  };

  /** Two-doc roadmap + a loaded RTM doc + the portal items the panel lists. */
  function rightPaneSetup(items: PortalItem[]): void {
    mockedApi.fetchRoadmap.mockResolvedValue([
      { id: 'P1', name: 'RTM', artifactPath: 'docs/RTM.md', docExists: true, status: 'COMPLETED' },
      { id: 'P2', name: 'BOM', artifactPath: 'docs/BOM.md', docExists: true, status: 'COMPLETED' }
    ] as never);
    mockedApi.fetchDoc.mockResolvedValue({
      phaseId: 'P1',
      path: 'docs/RTM.md',
      content: '# RTM\n\nSS-04.e fuse selectivity row',
      status: 'draft'
    } as never);
    autopilotState.portalItems = items;
  }

  /** Opens the question panel from the left-pane badge and waits for the
      active-item emission that enables the Details tab. */
  async function openPanel(user: ReturnType<typeof renderView>['user']): Promise<HTMLElement> {
    await user.click(await screen.findByRole('button', { name: /Open questions from AI/ }));
    const detailsTab = await screen.findByRole('tab', { name: 'Details' });
    await waitFor(() => expect(detailsTab.getAttribute('aria-disabled')).toBeNull());
    return detailsTab;
  }

  it('Details renders the record, hides the doc actions, and keeps the doc mounted but inert', async () => {
    rightPaneSetup([questionA]);
    const { user, container } = renderView();
    const detailsTab = await openPanel(user);
    expect(await screen.findByRole('button', { name: 'Refresh document' })).toBeInTheDocument();

    await user.click(detailsTab);

    // The record renders in the right pane.
    expect(screen.getByRole('tabpanel', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Fuse selectivity' })).toBeInTheDocument();
    // §3b.6(ii) — the doc action cluster is hidden, not disabled.
    expect(screen.queryByRole('button', { name: 'Refresh document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach a quality example' })).toBeNull();
    // §3b.3.5 / §3b.6(i) — the doc tree is still mounted; only inert.
    expect(screen.getByRole('tabpanel', { name: 'Document' })).toBeInTheDocument();
    expect(container.querySelector('#pane-doc [inert]')).not.toBeNull();
    // Collapse / zen rail buttons stay rendered.
    expect(screen.getByRole('button', { name: 'Collapse document pane' })).toBeInTheDocument();
  });

  it('switching back to Document restores the doc actions without remounting the tree', async () => {
    rightPaneSetup([questionA]);
    const { user } = renderView();
    const detailsTab = await openPanel(user);
    const docPanel = screen.getByRole('tabpanel', { name: 'Document' });

    await user.click(detailsTab);
    // Same DOM node while Details is up — the doc was never unmounted.
    expect(screen.getByRole('tabpanel', { name: 'Document' })).toBe(docPanel);

    await user.click(screen.getByRole('tab', { name: 'Document' }));
    expect(screen.queryByRole('tabpanel', { name: 'Details' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh document' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Document' })).toBe(docPanel);
  });

  it('the Details tab is disabled when the active item is not a question', async () => {
    rightPaneSetup([parkedItem]);
    const { user } = renderView();
    await user.click(await screen.findByRole('button', { name: /Open questions from AI/ }));

    const detailsTab = await screen.findByRole('tab', { name: 'Details' });
    expect(detailsTab).toHaveAttribute('aria-disabled', 'true');
    await user.click(detailsTab);
    expect(screen.queryByRole('tabpanel', { name: 'Details' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh document' })).toBeInTheDocument();
  });

  it('closing the panel resets the right pane to Document for the next open', async () => {
    rightPaneSetup([questionA]);
    const { user } = renderView();
    const detailsTab = await openPanel(user);
    await user.click(detailsTab);
    expect(screen.getByRole('tabpanel', { name: 'Details' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close questions' }));
    expect(screen.queryByRole('tabpanel', { name: 'Details' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh document' })).toBeInTheDocument();

    // Session-only: reopening starts on Document again (never persisted).
    await openPanel(user);
    expect(screen.getByRole('tab', { name: 'Document' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tabpanel', { name: 'Details' })).toBeNull();
  });

  it('Open document from Details returns to Document and navigates to the item doc', async () => {
    rightPaneSetup([questionA, questionB]);
    const { user } = renderView();
    const detailsTab = await openPanel(user);
    await user.click(detailsTab);

    // A chip from a different doc does not navigate while Details is up
    // (§3b.6(iv)); the record switches instantly and offers the jump.
    await user.click(screen.getByRole('button', { name: /Relay coil creepage/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Relay coil creepage' })).toBeInTheDocument();
    expect(mockedApi.setActivePhase).not.toHaveBeenCalledWith('P2');

    await user.click(within(screen.getByRole('tabpanel', { name: 'Details' })).getByRole('button', { name: 'Open document' }));

    expect(screen.queryByRole('tabpanel', { name: 'Details' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Document' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Refresh document' })).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.setActivePhase).toHaveBeenCalledWith('P2'));
  });
});

// ————— Doc-pane header fold ladder (design 2026-11-03 §3c.5) —————
describe('DevelopmentView doc pane header fold ladder', () => {
  type RORecord = { cb: ResizeObserverCallback; targets: Element[] };
  const roRecords: RORecord[] = [];

  /** Records every observer so a test can drive the DOC PANE's width alone. */
  class FakeResizeObserver {
    private record: RORecord;
    constructor(cb: ResizeObserverCallback) {
      this.record = { cb, targets: [] };
      roRecords.push(this.record);
    }
    observe(el: Element): void {
      this.record.targets.push(el);
    }
    unobserve(): void {}
    disconnect(): void {}
  }

  /** Sets the doc pane container width and lets React settle (§3c.5 ladder). */
  function setDocPaneWidth(width: number): void {
    act(() => {
      for (const record of roRecords) {
        const isDocPane = record.targets.some(el => el.getAttribute('aria-label') === 'Document workspace');
        if (!isDocPane) continue;
        record.cb([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
      }
    });
  }

  /** One COMPLETED doc (status pill = "Completed") with an editable draft body. */
  function docSetup(): void {
    mockedApi.fetchRoadmap.mockResolvedValue([
      { id: 'P1', name: 'RTM', artifactPath: 'docs/RTM.md', docExists: true, status: 'COMPLETED' }
    ] as never);
    mockedApi.fetchDoc.mockResolvedValue({
      phaseId: 'P1',
      path: 'docs/RTM.md',
      content: '# RTM\n\nSS-04.e fuse selectivity row',
      status: 'draft'
    } as never);
  }

  const questionA: PortalItem = {
    id: 'q-a',
    type: 'question',
    severity: 'normal',
    docPath: 'docs/RTM.md',
    title: 'Fuse selectivity',
    detail: 'SS-04.e fuse selectivity needs a formal check.',
    status: 'open',
    source: 'autopilot',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    meta: { sections: { bluf: 'No formal selectivity check on record.' } }
  };

  beforeEach(() => {
    roRecords.length = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  it('keeps every control inline at a wide pane and renders no ⋯ trigger', async () => {
    docSetup();
    renderView();
    expect(await screen.findByRole('button', { name: 'Refresh document' })).toBeInTheDocument();
    setDocPaneWidth(900);

    expect(screen.getByRole('button', { name: 'Attach a quality example' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve phase' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse document pane' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More document actions' })).toBeNull();
  });

  it('folds Attach / Refresh / Approve into ⋯ at <=759 and keeps Edit, the switch and ⋯ inline', async () => {
    docSetup();
    renderView();
    expect(await screen.findByRole('button', { name: 'Refresh document' })).toBeInTheDocument();
    setDocPaneWidth(636);

    // Folded: gone from the inline row, present as rows of the menu.
    expect(screen.queryByRole('button', { name: 'Attach a quality example' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve phase' })).toBeNull();
    // Never folded: Edit, the Document | Details switch, the rail and ⋯.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse document pane' })).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'More document actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('dispatches the folded action from the ⋯ menu and closes it', async () => {
    docSetup();
    const { user } = renderView();
    expect(await screen.findByRole('button', { name: 'Refresh document' })).toBeInTheDocument();
    setDocPaneWidth(636);

    const callsBefore = mockedApi.fetchDoc.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'More document actions' }));
    const menu = screen.getByRole('menu', { name: 'More document actions' });
    // Never both at once: the folded action exists only as a menu row.
    expect(within(menu).getByRole('menuitem', { name: 'Refresh document' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh document' })).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: 'Refresh document' }));

    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(mockedApi.fetchDoc.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('renders a disabled action as a disabled menu row, never omits it', async () => {
    docSetup();
    // A busy turn disables the inline Attach button, so the row must be disabled.
    const { user } = renderView({ busy: true });
    expect(await screen.findByRole('button', { name: 'Refresh document' })).toBeInTheDocument();
    setDocPaneWidth(636);

    await user.click(screen.getByRole('button', { name: 'More document actions' }));
    const attachRow = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Attach a quality example' });
    expect(attachRow).toBeDisabled();
  });

  it('folds the pane-rail buttons last, at <=629, and they still act', async () => {
    docSetup();
    const { user } = renderView();
    expect(await screen.findByRole('button', { name: 'Collapse document pane' })).toBeInTheDocument();
    setDocPaneWidth(600);

    expect(screen.queryByRole('button', { name: 'Collapse document pane' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Focus document pane' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More document actions' }));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Collapse document pane' }));

    expect(await screen.findByRole('button', { name: 'Expand document pane' })).toBeInTheDocument();
  });

  it('hides the selector status pill at <=519 and carries its words in title/aria-label', async () => {
    docSetup();
    renderView();
    expect(await screen.findByRole('button', { name: 'Refresh document' })).toBeInTheDocument();

    setDocPaneWidth(600);
    expect(screen.getByText('Completed')).toBeInTheDocument();

    setDocPaneWidth(500);
    expect(screen.queryByText('Completed')).toBeNull();
    const selector = screen.getByRole('button', { name: 'Select document — RTM — Completed' });
    expect(selector).toHaveAttribute('title', 'RTM — Completed');
  });

  it('collapses the Document / Details labels to icons at <=429, keeping the words', async () => {
    docSetup();
    renderView();
    expect(await screen.findByRole('button', { name: 'Refresh document' })).toBeInTheDocument();
    setDocPaneWidth(360);

    for (const label of ['Document', 'Details']) {
      const tab = screen.getByRole('tab', { name: label });
      expect(tab).toHaveAttribute('aria-label', label);
      expect(tab.querySelector('span')?.className).toContain('hidden');
      expect(tab.className).toContain('min-h-[44px]');
    }
    // Edit, the switch and ⋯ all survive at the splitter's 360 px floor.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More document actions' })).toBeInTheDocument();
  });

  it('closes the menu on Escape and returns focus to the ⋯ trigger', async () => {
    docSetup();
    const { user } = renderView();
    expect(await screen.findByRole('button', { name: 'Refresh document' })).toBeInTheDocument();
    setDocPaneWidth(636);

    const trigger = screen.getByRole('button', { name: 'More document actions' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(trigger);
  });

  it('folds Diff into ⋯ and dispatches the toggle', async () => {
    docSetup();
    autopilotState.status = {
      enabled: false,
      running: false,
      docStatus: { P1: 'revised' },
      blocks: 0,
      passedCount: 0,
      totalPhases: 13
    };
    mockedApi.fetchDocDiff.mockResolvedValue({
      phaseId: 'P1',
      approved: 'a',
      current: 'b',
      approvedAvailable: true
    });
    const { user } = renderView();
    expect(await screen.findByRole('button', { name: 'Toggle diff view' })).toBeInTheDocument();
    setDocPaneWidth(636);

    expect(screen.queryByRole('button', { name: 'Toggle diff view' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More document actions' }));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Diff' }));

    await waitFor(() => expect(mockedApi.fetchDocDiff).toHaveBeenCalledWith('P1'));
  });

  it('Details mode renders no ⋯ and no doc actions; the rail stays inline', async () => {
    docSetup();
    autopilotState.portalItems = [questionA];
    const { user } = renderView();
    expect(await screen.findByRole('button', { name: 'Refresh document' })).toBeInTheDocument();
    setDocPaneWidth(636);
    expect(screen.getByRole('button', { name: 'More document actions' })).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /Open questions from AI/ }));
    const detailsTab = await screen.findByRole('tab', { name: 'Details' });
    await waitFor(() => expect(detailsTab.getAttribute('aria-disabled')).toBeNull());
    await user.click(detailsTab);

    expect(screen.getByRole('tabpanel', { name: 'Details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More document actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach a quality example' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Collapse document pane' })).toBeInTheDocument();
  });
});
