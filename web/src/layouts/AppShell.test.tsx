import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import AppShell from './AppShell';
import type { Settings } from '../types/api';

vi.mock('../api/client', () => ({
  api: {
    fetchProject: vi.fn(),
    fetchAutopilotStatus: vi.fn(),
    fetchPortalItems: vi.fn(),
    fetchRoadmap: vi.fn(),
    fetchPendingCheckpoint: vi.fn(),
    fetchDashboard: vi.fn(),
    fetchSettings: vi.fn(),
    saveSettings: vi.fn(),
    fetchSearchSettings: vi.fn(),
    saveSearchSettings: vi.fn(),
    probeSearchProvider: vi.fn(),
    listProviderModels: vi.fn(),
    listTranscriptionModels: vi.fn(),
    fetchProjects: vi.fn(),
    browseFolders: vi.fn(),
    switchProject: vi.fn()
  }
}));

vi.mock('../api/useTurnStream', () => ({
  useTurnStream: () => ({
    busy: false,
    checkpoint: null,
    error: null,
    sendTurn: vi.fn(async () => {}),
    restoreCheckpoint: vi.fn()
  })
}));

import { api } from '../api/client';

const mocked = vi.mocked(api);

function buildSettings(overrides: Partial<Settings> = {}): Settings {
  const slot = { providerId: 'openrouter', model: 'base-model' };
  return {
    providers: [{ id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', hasKey: true, builtIn: true }],
    assignments: { drafting: { ...slot }, critic: { ...slot }, classifier: { ...slot }, compaction: { ...slot }, transcriber: { ...slot } },
    transcriptionEnabled: true,
    autopilotEnabled: true,
    port: 3000,
    projectPath: 'C:/proj',
    ...overrides
  };
}

/** Opens the Vault hub → settings sub-tab and waits for the settings page. */
async function openSettingsPage(user: ReturnType<typeof renderWithUser>['user']) {
  await user.click(screen.getByRole('tab', { name: /Vault & Settings/ }));
  await user.click(await screen.findByRole('button', { name: 'Project & AI Settings' }));
  await screen.findByRole('heading', { name: 'Settings' });
}

function vaultTab() {
  return screen.getByRole('tab', { name: /Vault & Settings/ });
}

async function makeDirty(user: ReturnType<typeof renderWithUser>['user']) {
  await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
  expect(screen.getByRole('button', { name: 'Save Settings' })).toBeInTheDocument();
}

describe('AppShell settings leave-guard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.fetchProject.mockResolvedValue({ name: 'Test Build', activePhase: 'build' } as never);
    mocked.fetchAutopilotStatus.mockResolvedValue({ running: false, blocks: 0, passedCount: 0, docStatus: {}, totalPhases: 13 } as never);
    mocked.fetchPortalItems.mockResolvedValue({ items: [] } as never);
    mocked.fetchRoadmap.mockResolvedValue([] as never);
    mocked.fetchPendingCheckpoint.mockResolvedValue(null as never);
    // Dashboard is never fully mounted in these tests; a pending promise keeps it in its loading state.
    mocked.fetchDashboard.mockReturnValue(new Promise(() => {}) as never);
    mocked.fetchSettings.mockResolvedValue(buildSettings());
    mocked.fetchSearchSettings.mockResolvedValue({ provider: 'openrouter', hasTavilyKey: false, hasBraveKey: false });
    mocked.fetchProjects.mockResolvedValue({ projects: [], activeId: '' } as never);
    mocked.listProviderModels.mockRejectedValue(new Error('offline'));
    mocked.listTranscriptionModels.mockResolvedValue({ models: [] } as never);
  });

  it('asks before leaving a dirty settings page', async () => {
    const { user } = renderWithUser(<AppShell />);
    await openSettingsPage(user);
    await makeDirty(user);
    await user.click(screen.getByRole('tab', { name: /Dashboard/ }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Save settings before leaving?');
    expect(dialog).toHaveTextContent("Your changes to Autopilot haven't been saved.");
  });

  it('keeps the current tab on Stay', async () => {
    const { user } = renderWithUser(<AppShell />);
    await openSettingsPage(user);
    await makeDirty(user);
    await user.click(screen.getByRole('tab', { name: /Dashboard/ }));
    await user.click(await screen.findByRole('button', { name: 'Stay' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(vaultTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('switches hubs after a successful Save and leave', async () => {
    const { user } = renderWithUser(<AppShell />);
    mocked.saveSettings.mockResolvedValue(buildSettings({ autopilotEnabled: false }));
    await openSettingsPage(user);
    await makeDirty(user);
    await user.click(screen.getByRole('tab', { name: /Dashboard/ }));
    await user.click(await screen.findByRole('button', { name: 'Save and leave' }));

    await waitFor(() => expect(screen.getByRole('tab', { name: /Dashboard/ })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('stays on settings when Save and leave fails to save', async () => {
    const { user } = renderWithUser(<AppShell />);
    mocked.saveSettings.mockRejectedValue(new Error('disk full'));
    await openSettingsPage(user);
    await makeDirty(user);
    await user.click(screen.getByRole('tab', { name: /Dashboard/ }));
    await user.click(await screen.findByRole('button', { name: 'Save and leave' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(vaultTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('navigates straight through when nothing is unsaved', async () => {
    const { user } = renderWithUser(<AppShell />);
    await openSettingsPage(user);
    await user.click(screen.getByRole('tab', { name: /Dashboard/ }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Dashboard/ })).toHaveAttribute('aria-selected', 'true');
  });
});