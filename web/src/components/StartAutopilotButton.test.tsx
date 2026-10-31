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

describe('StartAutopilotButton — full variant (276b255-era StarBorder pill)', () => {
  it('renders the StarBorder wrapper with a crimson cut-corner 44px button, Sparkles and idle label', () => {
    const { container } = renderControls();
    const button = screen.getByRole('button', { name: 'Launch autopilot auto-drafting' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveClass('min-h-[44px]', 'cut-corner', 'rounded-none');
    expect(button.querySelector('.lucide-sparkles')).not.toBeNull();
    expect(button.querySelector('.lucide-rocket')).toBeNull();
    expect(button.textContent).toContain('Launch Auto-Drafting');
    // StarBorder's decorative canvas is present again on the idle pill.
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('switches to the plain rose 44px Stop pill while running', () => {
    renderControls(true);
    const button = screen.getByRole('button', { name: 'Stop autopilot' });
    expect(button).toHaveClass('min-h-[44px]', 'rounded-md', 'border-rose-600/40', 'bg-rose-950/60', 'px-2.5');
    expect(button.textContent).toContain('Stop');
    expect(button.querySelector('.lucide-square')).not.toBeNull();
    expect(button.textContent).not.toContain('AUTOPILOT ACTIVE');
    expect(button.querySelector('.bar-slide-safe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Launch autopilot auto-drafting' })).not.toBeInTheDocument();
  });
});

describe('StartAutopilotButton — composer variant (chat prompt box)', () => {
  function renderComposer(running = false) {
    return renderWithUser(
      <StartAutopilotButton running={running} onStart={start} onStop={stop} size="composer" />
    );
  }

  it('renders a 56x56 rocket-only idle button with accessible name and no text label', () => {
    const { container } = renderComposer();
    const button = screen.getByRole('button', { name: 'Launch autopilot auto-drafting' });
    expect(button).toHaveClass('h-14', 'w-14', 'rounded-lg', 'cut-corner');
    expect(button.querySelector('.lucide-rocket')).not.toBeNull();
    expect(container.textContent).not.toContain('Launch Auto-Drafting');
  });

  it('renders the 56x56 rose stop control while running and stops on click', async () => {
    stop.mockResolvedValue(undefined);
    const { user } = renderComposer(true);

    const button = screen.getByRole('button', { name: 'Stop autopilot' });
    expect(button).toHaveClass('h-14', 'w-14', 'border-rose-600/40', 'bg-rose-950/60');
    expect(button.querySelector('.lucide-square')).not.toBeNull();
    await user.click(button);
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  it('plays the one-shot rocket launch on the running edge, then settles into the bar layout', async () => {
    const { rerender } = renderComposer(false);
    // Idle→running transition: the button fires its internal launched flag.
    rerender(<StartAutopilotButton running onStart={start} onStop={stop} size="composer" />);

    const button = screen.getByRole('button', { name: 'Stop autopilot' });
    // The bar and burst live on the outer span (the control), not inside the
    // button — the composer running branch renders them as siblings.
    const control = button.parentElement as HTMLElement;
    // Launch window: rocket-launch animation + spark burst visible, bar held
    // back until the window closes.
    expect(button.querySelector('.rocket-launch-safe')).not.toBeNull();
    expect(control.querySelector('.spark-burst-safe')).not.toBeNull();
    expect(control.querySelector('.bar-slide-safe')).toBeNull();

    // After the 900ms window the glyph is a static Square and the 4px bar
    // renders pinned to the bottom edge of the control.
    await waitFor(
      () => expect(control.querySelector('.bar-slide-safe')).not.toBeNull(),
      { timeout: 2000 }
    );
    expect(button.querySelector('.rocket-launch-safe')).toBeNull();
    expect(control.querySelector('.spark-burst-safe')).toBeNull();
    const barTrack = control.querySelector('.absolute.bottom-1.inset-x-2');
    expect(barTrack).not.toBeNull();
    expect(button.querySelector('.lucide-square')).not.toBeNull();
  });

  it('does not replay the launch on remount while already running', () => {
    // Mounting straight into running (e.g. DevelopmentView remount) must not
    // fire the one-shot edge again.
    const { container } = renderComposer(true);
    expect(container.querySelector('.rocket-launch-safe')).toBeNull();
    expect(container.querySelector('.spark-burst-safe')).toBeNull();
  });

  it('composer variant is disabled while the start request is pending', async () => {
    let resolveStart: () => void = () => {};
    start.mockImplementation(() => new Promise<void>(res => { resolveStart = res; }));
    const { user } = renderComposer();

    const button = screen.getByRole('button', { name: 'Launch autopilot auto-drafting' });
    await user.click(button);
    expect(button).toBeDisabled();

    resolveStart();
    await waitFor(() => expect(button).toBeEnabled());
    expect(start).toHaveBeenCalledTimes(1);
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
