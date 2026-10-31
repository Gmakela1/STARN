/**
 * React Bits ShinyText (web/src/components/reactbits/ShinyText.tsx).
 * Text content stays readable for a11y; the shine is paint-only styling.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShinyText from './ShinyText';

describe('ShinyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders its text inside a span (content unchanged for a11y)', () => {
    render(<ShinyText text="STARN" color="#e8edf5" shineColor="#ffb3bd" speed={4} trigger="loop" />);
    expect(screen.getByText('STARN').tagName).toBe('SPAN');
  });

  it('does not crash under prefers-reduced-motion: reduce', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {}
    }));
    render(<ShinyText text="STARN" trigger="loop" />);
    expect(screen.getByText('STARN')).toBeInTheDocument();
  });
});
