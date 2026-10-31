import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import StartAutopilotButton from './StartAutopilotButton';

// Board #57 — stable module-scope fixtures: the component must treat these as
// the api.autopilotStart / api.autopilotStop seam.
const start = vi.fn<() => Promise<void>>();
const stop = vi.fn<() => Promise<void>>();

afterEach(() => {
  start.mockReset();
  stop.mockReset();
});

function renderControls(running = false) {
  return renderWithUser(
    <StartAutopilotButton running={running} onStart={start} onStop={stop} />
  );
}

describe('StartAutopilotButton — start flow', () => {
  it('button is disabled while the start request is pending', async () => {
    let resolveStart: () => void = () => {};
    start.mockImplementation(() => new Promise<void>(res => { resolveStart = res; }));
    const { user } = renderControls();

    const button = screen.getByRole('button', { name: 'Start autopilot auto-drafting' });
    await user.click(button);
    expect(button).toBeDisabled();

    resolveStart();
    await waitFor(() => expect(button).toBeEnabled());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('renders role=alert with busy copy when the start is rejected (409 busy guard)', async () => {
    start.mockRejectedValue(new Error('A turn is already in progress'));
    const { user } = renderControls();

    await user.click(screen.getByRole('button', { name: 'Start autopilot auto-drafting' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already running/i);
  });

  it('clears the alert after a successful retry', async () => {
    start.mockRejectedValueOnce(new Error('A turn is already in progress'));
    start.mockResolvedValueOnce(undefined);
    const { user } = renderControls();

    const button = screen.getByRole('button', { name: 'Start autopilot auto-drafting' });
    await user.click(button);
    await screen.findByRole('alert');

    await user.click(button);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('StartAutopilotButton — stop flow (board #57: no silent catch)', () => {
  it('renders the Stop button while running and no alert on success', async () => {
    stop.mockResolvedValue(undefined);
    const { user } = renderControls(true);

    await user.click(screen.getByRole('button', { name: 'Stop autopilot' }));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders role=alert with the stop failure reason instead of swallowing it', async () => {
    stop.mockRejectedValue(new Error('socket hung up'));
    const { user } = renderControls(true);

    await user.click(screen.getByRole('button', { name: 'Stop autopilot' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't stop auto-drafting/i);
    expect(alert).toHaveTextContent(/socket hung up/);
  });
});
