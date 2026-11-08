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
    listTranscriptionModels: vi.fn(),
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

describe('SettingsView save action', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.fetchSearchSettings.mockResolvedValue({ provider: 'openrouter', hasTavilyKey: false, hasBraveKey: false });
    mocked.fetchProjects.mockResolvedValue({ projects: [], activeId: '' } as never);
    mocked.listProviderModels.mockRejectedValue(new Error('offline'));
    mocked.listTranscriptionModels.mockResolvedValue({
      models: [
        { id: 'openai/whisper-large-v3-turbo', name: 'Whisper Large V3 Turbo' },
        { id: 'openai/gpt-4o-mini-transcribe', name: 'GPT-4o Mini Transcribe' }
      ]
    });
  });

  it('shows the clean ghost chip when nothing is unsaved', async () => {
    await renderLoaded();
    const chip = screen.getByRole('button', { name: 'All settings saved' });
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    expect(chip).toHaveAttribute('tabindex', '-1');
    expect(screen.queryByRole('button', { name: 'Save Settings' })).not.toBeInTheDocument();
  });

  it('turns the pill actionable as soon as one slice is dirty', async () => {
    const { user } = await renderLoaded();
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    const pill = screen.getByRole('button', { name: 'Save Settings' });
    expect(pill).not.toHaveAttribute('aria-disabled', 'true');
    expect(document.getElementById('settings-save-status')).toHaveTextContent('Unsaved changes: Autopilot');
    expect(within(aiGroup()).getByText('Unsaved: Autopilot.')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Toggle document transcription' }));
    expect(within(aiGroup()).getByText('Unsaved: Transcription, Autopilot.')).toBeInTheDocument();
  });

  it('treats a search provider radio change alone as dirty', async () => {
    const { user } = await renderLoaded();
    await user.click(screen.getByRole('radio', { name: /Tavily/ }));
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeInTheDocument();
    expect(screen.getByText('Unsaved: Search provider.')).toBeInTheDocument();
  });

  it('shows Saving… with aria-busy while the POST is in flight', async () => {
    const { user } = await renderLoaded();
    let release: (s: Settings) => void = () => {};
    mocked.saveSettings.mockReturnValue(new Promise<Settings>(resolve => { release = resolve; }));
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    const busy = screen.getByRole('button', { name: 'Saving…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');

    release(buildSettings());
    await waitFor(() => expect(screen.getByRole('button', { name: 'All settings saved' })).toBeInTheDocument());
  });

  it('saves both slices, reports success once and calls onSaved', async () => {
    const { user, onSaved } = await renderLoaded();
    mocked.saveSettings.mockResolvedValue(buildSettings({ autopilotEnabled: false }));
    mocked.saveSearchSettings.mockResolvedValue({ provider: 'tavily', hasTavilyKey: true, hasBraveKey: false });

    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('radio', { name: /Tavily/ }));
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByRole('button', { name: 'All settings saved' })).toBeInTheDocument();
    expect(mocked.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autopilotEnabled: false }));
    expect(mocked.saveSearchSettings).toHaveBeenCalledWith({ provider: 'tavily', tavilyApiKey: undefined, braveApiKey: undefined });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('composes a partial failure and keeps the unsaved search fields', async () => {
    const { user } = await renderLoaded();
    mocked.saveSettings.mockResolvedValue(buildSettings({ autopilotEnabled: false }));
    mocked.saveSearchSettings.mockRejectedValue(new Error('quota exceeded'));

    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('radio', { name: /Tavily/ }));
    const keyField = screen.getByPlaceholderText('tvly-...') as HTMLInputElement;
    await user.type(keyField, 'secret');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    const alert = await screen.findByRole('alert');
    await waitFor(() =>
      expect(alert).toHaveTextContent(
        "AI settings saved. Search settings didn't save: quota exceeded. Your Search settings changes are still here — try again."
      )
    );
    // Unsaved search input survives the failed slice.
    expect((screen.getByPlaceholderText(/tvly-|Leave blank to keep stored key/) as HTMLInputElement).value).toBe('secret');
    // The pill is actionable again for the retry.
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revert unsaved changes' })).toBeInTheDocument();
  });

  it('retries only the failing slice', async () => {
    const { user } = await renderLoaded();
    mocked.saveSettings.mockResolvedValue(buildSettings({ autopilotEnabled: false }));
    mocked.saveSearchSettings.mockRejectedValueOnce(new Error('quota exceeded'));
    mocked.saveSearchSettings.mockResolvedValue({ provider: 'tavily', hasTavilyKey: true, hasBraveKey: false });

    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('radio', { name: /Tavily/ }));
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));
    await screen.findByRole('alert');

    expect(mocked.saveSettings).toHaveBeenCalledTimes(1);
    expect(mocked.saveSearchSettings).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    // AI slice was rebaselined on success → the retry POSTs only search.
    await waitFor(() => expect(mocked.saveSearchSettings).toHaveBeenCalledTimes(2));
    expect(mocked.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('reports what failed inline in the AI card and keeps the edits', async () => {
    const { user } = await renderLoaded();
    mocked.saveSettings.mockRejectedValue(new Error('disk full'));
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "AI settings didn't save: disk full. Your AI settings changes are still here — try again."
      )
    );
    expect(within(aiGroup()).getByText("Couldn't save: disk full. Your changes are still here. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Toggle autopilot' })).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the probe warning next to the AI status line', async () => {
    const { user } = await renderLoaded();
    mocked.saveSettings.mockResolvedValue({ ...buildSettings(), probe: { ok: false, detail: 'no tools' } });
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));
    expect(
      await within(aiGroup()).findByText(/Saved, but the Drafting model \(base-model\) didn't pass the tool-calling test: no tools\./)
    ).toBeInTheDocument();
  });

  it('blocks the pill and names the missing role when a model is blank', async () => {
    const { user, container } = await renderLoaded();
    const input = container.querySelector('#assign-model-critic') as HTMLInputElement;
    await user.clear(input);
    const blocked = within(aiGroup()).getByText('Choose a model for every role before saving. Missing: Critic.');
    expect(blocked).toHaveAttribute('id', 'settings-ai-blocked');
    const pill = screen.getByRole('button', { name: 'Save Settings' });
    expect(pill).toHaveAttribute('aria-disabled', 'true');
    expect(pill).toHaveAttribute('aria-describedby', 'settings-ai-blocked');
  });

  it('reverts every dirty slice from the failure alert', async () => {
    const { user } = await renderLoaded();
    mocked.saveSettings.mockRejectedValue(new Error('disk full'));
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    await user.click(screen.getByRole('radio', { name: /Tavily/ }));
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));
    await user.click(await screen.findByRole('button', { name: 'Revert unsaved changes' }));

    expect(screen.getByRole('switch', { name: 'Toggle autopilot' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /OpenRouter/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'All settings saved' })).toBeInTheDocument();
  });

  it('marks Speech-to-text dirty and saves voiceInputModel', async () => {
    const { user } = await renderLoaded();
    mocked.saveSettings.mockResolvedValue(buildSettings({ voiceInputModel: 'openai/gpt-4o-mini-transcribe' }));
    const stt = within(aiGroup()).getByRole('region', { name: 'Speech-to-text (voice input)' });
    await user.selectOptions(within(stt).getByLabelText('Model'), 'openai/gpt-4o-mini-transcribe');
    expect(within(aiGroup()).getByText('Unsaved: Speech-to-text.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));
    expect(mocked.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ voiceInputModel: 'openai/gpt-4o-mini-transcribe' }));
  });

  it('shows the drafting probe hint only when the drafting assignment changed', async () => {
    const { user, container } = await renderLoaded();
    const helper = /quick test to confirm it can use tools/;
    await user.click(screen.getByRole('switch', { name: 'Toggle autopilot' }));
    expect(screen.queryByText(helper)).not.toBeInTheDocument();
    const input = container.querySelector('#assign-model-drafting') as HTMLInputElement;
    await user.type(input, '-v2');
    expect(screen.getByText(helper)).toBeInTheDocument();
  });

  it('keeps Test search connection and its hint, and clears the typed key on save', async () => {
    const { user } = await renderLoaded();
    mocked.saveSearchSettings.mockResolvedValue({ provider: 'tavily', hasTavilyKey: true, hasBraveKey: false });
    await user.click(screen.getByRole('radio', { name: /Tavily/ }));
    await user.type(screen.getByPlaceholderText('tvly-...'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/Leave blank to keep stored key/) as HTMLInputElement).value).toBe('')
    );
    expect(screen.getByRole('button', { name: 'Test search connection' })).toBeInTheDocument();
    expect(screen.getByText('Test uses the key you typed; Save to keep it.')).toBeInTheDocument();
  });

  it('renders the Speech-to-text section and renames Transcriber to Document OCR', async () => {
    await renderLoaded();
    const group = aiGroup();
    expect(within(group).getByRole('heading', { name: 'Speech-to-text (voice input)' })).toBeInTheDocument();
    expect(within(group).getByText('Used for voice dictation in the Studio and question answers.')).toBeInTheDocument();
    const stt = within(group).getByRole('region', { name: 'Speech-to-text (voice input)' });
    const select = within(stt).getByLabelText('Model') as HTMLSelectElement;
    expect(select).toHaveValue('openai/whisper-large-v3');
    expect(within(group).getByText('Document OCR (scanned PDFs)')).toBeInTheDocument();
    expect(within(group).getByText('Reads text from scanned PDF pages.')).toBeInTheDocument();
    expect(within(group).queryByText('Transcriber')).not.toBeInTheDocument();
  });

  it('falls back to the static STT list when the transcription fetch fails', async () => {
    mocked.listTranscriptionModels.mockRejectedValue(new Error('offline'));
    await renderLoaded();
    const stt = within(aiGroup()).getByRole('region', { name: 'Speech-to-text (voice input)' });
    const select = within(stt).getByLabelText('Model') as HTMLSelectElement;
    const names = Array.from(select.options).map(o => o.value);
    expect(names).toContain('openai/whisper-1');
    expect(names).toContain('microsoft/mai-transcribe-2');
  });

  it('keeps the AI group before Web Search', async () => {
    await renderLoaded();
    const autopilot = screen.getByRole('heading', { name: 'Autopilot' });
    const search = screen.getByRole('heading', { name: /Web Search/ });
    expect(autopilot.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});