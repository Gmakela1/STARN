import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import { SettingsSaveBar } from './SettingsSaveBar';
import type { SettingsSaveBarProps } from './SettingsSaveBar';

function setup(overrides: Partial<SettingsSaveBarProps> = {}) {
  const onSave = vi.fn();
  const onDiscard = vi.fn();
  const props: SettingsSaveBarProps = {
    label: 'Save AI settings',
    savingLabel: 'Saving…',
    cleanText: 'All AI settings saved',
    dirtyParts: [],
    saving: false,
    onSave,
    onDiscard,
    ...overrides
  };
  const utils = renderWithUser(<SettingsSaveBar {...props} />);
  return { ...utils, onSave, onDiscard };
}

describe('SettingsSaveBar', () => {
  it('clean state shows the clean text and disables Save', () => {
    setup();
    expect(screen.getByText('All AI settings saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  });

  it('dirty state lists the changed parts and enables Save', () => {
    setup({ dirtyParts: ['Providers', 'Autopilot'] });
    expect(screen.getByText('Unsaved changes: Providers, Autopilot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save AI settings' })).toBeEnabled();
  });

  it('calls onSave and onDiscard', async () => {
    const { user, onSave, onDiscard } = setup({ dirtyParts: ['Transcription'] });
    await user.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('blocked state disables Save and links the reason with aria-describedby', () => {
    setup({ dirtyParts: ['Model assignments'], blockedReason: 'Choose a model for every role before saving. Missing: Critic.' });
    const button = screen.getByRole('button', { name: 'Save AI settings' });
    expect(button).toBeDisabled();
    const reason = screen.getByText('Choose a model for every role before saving. Missing: Critic.');
    expect(button.getAttribute('aria-describedby')).toBe(reason.id);
    expect(reason.id).not.toBe('');
  });

  it('saving state shows the saving label and disables Save', () => {
    setup({ dirtyParts: ['Providers'], saving: true, savingLabel: 'Saving and checking drafting model…' });
    const button = screen.getByRole('button', { name: 'Saving and checking drafting model…' });
    expect(button).toBeDisabled();
  });

  it('keeps an aria-live polite status region mounted with and without a status', () => {
    const { rerender } = setup();
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    rerender(
      <SettingsSaveBar
        label="Save AI settings"
        savingLabel="Saving…"
        cleanText="All AI settings saved"
        dirtyParts={[]}
        saving={false}
        status={{ kind: 'success', text: 'AI settings saved. New settings apply to your next request.' }}
        onSave={() => {}}
      />
    );
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('AI settings saved. New settings apply to your next request.');
  });

  it('renders error and warning statuses with role alert', () => {
    const { rerender } = setup({ status: { kind: 'error', text: "Couldn't save: boom. Your changes are still here. Try again." } });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save: boom.");
    rerender(
      <SettingsSaveBar
        label="Save AI settings"
        savingLabel="Saving…"
        cleanText="All AI settings saved"
        dirtyParts={[]}
        saving={false}
        status={{ kind: 'warning', text: 'Saved, but the Drafting model (x) failed.' }}
        onSave={() => {}}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Saved, but the Drafting model (x)');
  });

  it('renders extra content', () => {
    setup({ extra: <p>Helper text here</p> });
    expect(screen.getByText('Helper text here')).toBeInTheDocument();
  });
});
