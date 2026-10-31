/**
 * React Bits StarBorder (web/src/components/reactbits/StarBorder.tsx).
 * jsdom has no canvas/WebGL — the setup stubs force getContext → null, which
 * exercises the same no-canvas fallback path as an old browser.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StarBorder from './StarBorder';

describe('StarBorder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders its children inside a button with an aria-hidden canvas', () => {
    render(<StarBorder>Start Auto-Drafting</StarBorder>);
    const button = screen.getByRole('button', { name: 'Start Auto-Drafting' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    const canvas = button.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
  });

  it('forwards disabled and does not crash without canvas support', () => {
    render(
      <StarBorder disabled aria-label="Start autopilot auto-drafting">
        Start Auto-Drafting
      </StarBorder>
    );
    expect(screen.getByRole('button', { name: 'Start autopilot auto-drafting' })).toBeDisabled();
  });

  it('does not crash under prefers-reduced-motion: reduce', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {}
    }));
    render(<StarBorder>Start Auto-Drafting</StarBorder>);
    expect(screen.getByRole('button', { name: 'Start Auto-Drafting' })).toBeInTheDocument();
  });
});
