import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import SettingsView from './SettingsView';
import type { Settings } from '../types/api';

vi.mock('../api/client', () => ({
  api: {
    fetchSettings: vi.fn(),
    saveSettings: vi.fn(),
    fetchSearchSettings: vi.fn(),
    saveSearchSettings: vi.fn(),
    probeSearchProvider: vi.fn(),
    listProviderModels: vi.fn(),
    fetchProjects: vi.fn(),
    browseFolders: vi.fn(),
    switchProject: vi.fn()
  }
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

function renderView(onSaved = vi.fn()) {
  const utils = renderWithUser(<SettingsView onSaved={onSaved} />);
  return { ...utils, onSaved };
}

async function renderLoaded(settings: Settings = buildSettings()) {
  mocked.fetchSettings.mockResolvedValue(settings);
  const utils = renderView();
  await screen.findByRole('group', { name: 'AI & automation' });
  return utils;
}

function aiGroup() {
  return screen.getByRole('group', { name: 'AI & automation' });
}

describe('SettingsView save bars', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.fetchSearchSettings.mockResolvedValue({ provider: 'openrouter', hasTavilyKey: false, hasBraveKey: false });
    mocked.fetchProjects.mockResolvedValue({ projects: [], activeId: '' } as never);
    mocked.listProviderModels.mockRejectedValue(new Error('offline'));
  });

  it('starts clean with Save disabled and the group containing Autopilot before Web Search', async () => {
    await renderLoaded();
    const group = aiGroup();
    expect(within(group).getByText('All AI settings saved')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
    expect(within(group).getByRole('heading', { name: 'Autopilot' })).toBeInTheDocument();
    expect(within(group).getByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    const autopilot = screen.getByRole('heading', { name: 'Autopilot' });
    const search = screen.getByRole('heading', { name: /Web Search/ });
    expect(autopilot.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows which part is unsaved when a toggle changes', async () => {
    const { user } = await renderLoaded();
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    expect(within(aiGroup()).getByText('Unsaved changes: Autopilot')).toBeInTheDocument();
    expect(within(aiGroup()).getByRole('button', { name: 'Save AI settings' })).toBeEnabled();
    await user.click(screen.getByRole('switch', { name: 'Toggle document transcription' }));
    expect(within(aiGroup()).getByText('Unsaved changes: Transcription, Autopilot')).toBeInTheDocument();
  });

  it('saves and shows the success message inside the AI group, then calls onSaved', async () => {
    const { user, onSaved } = await renderLoaded();
    mocked.saveSettings.mockResolvedValue(buildSettings({ autopilotEnabled: false }));
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(await within(aiGroup()).findByText('AI settings saved. New settings apply to your next request.')).toBeInTheDocument();
    expect(mocked.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autopilotEnabled: false }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(within(aiGroup()).getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
  });

  it('discard restores the saved values', async () => {
    const { user } = await renderLoaded();
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('switch', { name: 'Toggle autopilot' })).toHaveAttribute('aria-checked', 'true');
    expect(within(aiGroup()).getByText('All AI settings saved')).toBeInTheDocument();
  });

  it('blocks Save and names the missing role when a model is blank', async () => {
    const { user, container } = await renderLoaded();
    const input = container.querySelector('#assign-model-critic') as HTMLInputElement;
    await user.clear(input);
    expect(within(aiGroup()).getByText('Choose a model for every role before saving. Missing: Critic.')).toBeInTheDocument();
    expect(within(aiGroup()).getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
  });

  it('shows the drafting helper and checking label only when the drafting assignment changed', async () => {
    const { user, container } = await renderLoaded();
    const helper = /quick test to confirm it can use tools/;
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    expect(screen.queryByText(helper)).not.toBeInTheDocument();

    let release: (s: Settings) => void = () => {};
    mocked.saveSettings.mockReturnValue(new Promise<Settings>(resolve => { release = resolve; }));
    const input = container.querySelector('#assign-model-drafting') as HTMLInputElement;
    await user.type(input, '-v2');
    expect(screen.getByText(helper)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(screen.getByRole('button', { name: 'Saving and checking drafting model…' })).toBeDisabled();
    release(buildSettings());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving and checking drafting model…' })).not.toBeInTheDocument());
  });

  it('keeps a probe-failure warning next to the Save button', async () => {
    const { user } = await renderLoaded();
    mocked.saveSettings.mockResolvedValue({ ...buildSettings(), probe: { ok: false, detail: 'no tools' } });
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('button', { name: 'Save AI settings' }));
    const alert = await within(aiGroup()).findByRole('alert');
    expect(alert).toHaveTextContent("Saved, but the Drafting model (base-model) didn't pass the tool-calling test: no tools.");
  });

  it('shows a save error locally and keeps the edits', async () => {
    const { user } = await renderLoaded();
    mocked.saveSettings.mockRejectedValue(new Error('disk full'));
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('button', { name: 'Save AI settings' }));
    const alert = await within(aiGroup()).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save: disk full. Your changes are still here. Try again.");
    expect(screen.getByRole('switch', { name: 'Toggle autopilot' })).toHaveAttribute('aria-checked', 'false');
  });

  it('search bar saves, confirms locally and clears the typed key', async () => {
    const { user } = await renderLoaded();
    mocked.saveSearchSettings.mockResolvedValue({ provider: 'tavily', hasTavilyKey: true, hasBraveKey: false });
    expect(screen.getByText('Search settings saved')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Tavily/ }));
    await user.type(screen.getByPlaceholderText('tvly-...'), 'secret');
    expect(screen.getByText('Unsaved changes: Search provider, API key')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save search settings' }));
    expect(await screen.findByText('Search settings saved.')).toBeInTheDocument();
    expect(mocked.saveSearchSettings).toHaveBeenCalledWith({ provider: 'tavily', tavilyApiKey: 'secret', braveApiKey: undefined });
    await waitFor(() => expect((screen.getByPlaceholderText(/Leave blank to keep stored key/) as HTMLInputElement).value).toBe(''));
    expect(screen.getByRole('button', { name: 'Test search connection' })).toBeInTheDocument();
    expect(screen.getByText('Test uses the key you typed; Save to keep it.')).toBeInTheDocument();
  });
});
