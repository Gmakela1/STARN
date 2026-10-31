/**
 * React Bits Galaxy (web/src/components/reactbits/Galaxy.tsx).
 * jsdom has no WebGL2 — getContext returns null via the setup stub, covering
 * the guard-fallback path (blank canvas, no crash) used by old browsers too.
 */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Galaxy from './Galaxy';

describe('Galaxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a container with an aria-hidden canvas and no-crash without WebGL', () => {
    const { container } = render(
      <Galaxy
        mouseInteraction={false}
        clickWarp={false}
        opacity={0.6}
        twinkleIntensity={0.1}
        layers={3}
        starColors={['#ff2a3c', '#ffb3bd', '#d9a441', '#e8edf5']}
      />
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not crash under prefers-reduced-motion: reduce', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {}
    }));
    render(<Galaxy mouseInteraction={false} />);
  });
});
