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

describe('StartAutopilotButton — full variant rocket redesign', () => {
  it('renders a plain 56px cut-corner button (no StarBorder wrapper) with rocket + idle label', () => {
    const { container } = renderControls();
    const button = screen.getByRole('button', { name: 'Launch autopilot auto-drafting' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveClass('min-h-[56px]', 'cut-corner', 'rounded-none');
    expect(button.querySelector('.lucide-rocket')).not.toBeNull();
    expect(button.querySelector('.lucide-sparkles')).toBeNull();
    expect(button.textContent).toContain('LAUNCH AUTO-DRAFTING');
    // StarBorder's decorative canvas is gone with the wrapper.
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('switches to the rose 56px stop control with the indeterminate bar while running', () => {
    renderControls(true);
    const button = screen.getByRole('button', { name: 'Stop autopilot' });
    expect(button).toHaveClass('min-h-[56px]', 'w-56');
    expect(button.textContent).toContain('AUTOPILOT ACTIVE');
    expect(button.querySelector('.h-1')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Launch autopilot auto-drafting' })).not.toBeInTheDocument();
  });

  it('shows the IGNITING… label while the start request is pending', async () => {
    let resolveStart: () => void = () => {};
    start.mockImplementation(() => new Promise<void>(res => { resolveStart = res; }));
    const { user } = renderControls();

    const button = screen.getByRole('button', { name: 'Launch autopilot auto-drafting' });
    await user.click(button);
    expect(button.textContent).toContain('IGNITING…');

    resolveStart();
    await waitFor(() => expect(button.textContent).toContain('LAUNCH AUTO-DRAFTING'));
  });
});

describe('StartAutopilotButton — start flow', () => {
  it('button is disabled while the start request is pending', async () => {
    let resolveStart: () => void = () => {};
    start.mockImplementation(() => new Promise<void>(res => { resolveStart = res; }));
    const { user } = renderControls();

    const button = screen.getByRole('button', { name: 'Launch autopilot auto-drafting' });
    await user.click(button);
    expect(button).toBeDisabled();

    resolveStart();
    await waitFor(() => expect(button).toBeEnabled());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('renders role=alert with busy copy when the start is rejected (409 busy guard)', async () => {
    start.mockRejectedValue(new Error('A turn is already in progress'));
    const { user } = renderControls();

    await user.click(screen.getByRole('button', { name: 'Launch autopilot auto-drafting' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already running/i);
  });

  it('clears the alert after a successful retry', async () => {
    start.mockRejectedValueOnce(new Error('A turn is already in progress'));
    start.mockResolvedValueOnce(undefined);
    const { user } = renderControls();

    const button = screen.getByRole('button', { name: 'Launch autopilot auto-drafting' });
    await user.click(button);
    await screen.findByRole('alert');

    await user.click(button);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('StartAutopilotButton — icon variant (chat composer)', () => {
  function renderIcon(running = false) {
    return renderWithUser(
      <StartAutopilotButton running={running} onStart={start} onStop={stop} size="icon" />
    );
  }

  it('renders an icon-only 44x44 start button with accessible name', () => {
    const { container } = renderIcon();
    const button = screen.getByRole('button', { name: 'Launch autopilot auto-drafting' });
    expect(button).toHaveClass('h-11', 'w-11', 'rounded-lg');
    expect(button.textContent).not.toMatch(/start auto-drafting/i);
    expect(button.querySelector('svg')).not.toBeNull();
    expect(container.textContent).not.toContain('Start Auto-Drafting');
  });

  it('icon variant is disabled while the start request is pending', async () => {
    let resolveStart: () => void = () => {};
    start.mockImplementation(() => new Promise<void>(res => { resolveStart = res; }));
    const { user } = renderIcon();

    const button = screen.getByRole('button', { name: 'Launch autopilot auto-drafting' });
    await user.click(button);
    expect(button).toBeDisabled();

    resolveStart();
    await waitFor(() => expect(button).toBeEnabled());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('icon variant renders a 44x44 rose stop control while running', async () => {
    stop.mockResolvedValue(undefined);
    const { user } = renderIcon(true);

    const button = screen.getByRole('button', { name: 'Stop autopilot' });
    expect(button).toHaveClass('h-11', 'w-11');
    await user.click(button);
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
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
