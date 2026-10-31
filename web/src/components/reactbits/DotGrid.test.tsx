/**
 * React Bits DotGrid (web/src/components/reactbits/DotGrid.tsx).
 * jsdom has no WebGL2 — getContext returns null via the setup stub, covering
 * the guard-fallback path (blank canvas, no crash) used by old browsers too.
 */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DotGrid from './DotGrid';

describe('DotGrid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a canvas layer and no-crash without WebGL', () => {
    const { container } = render(
      <DotGrid
        dotSize={2}
        gap={24}
        baseColor="#2a3342"
        activeColor="#d9a441"
        glow={0.1}
        mouseInteraction={false}
        clickShock={false}
      />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('does not crash under prefers-reduced-motion: reduce', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {}
    }));
    render(<DotGrid mouseInteraction={false} />);
  });
});
