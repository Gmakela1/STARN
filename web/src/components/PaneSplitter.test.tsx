import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { cleanup, renderWithUser } from '../test/render';
import PaneSplitter, { type PaneSplitterProps } from './PaneSplitter';

afterEach(() => {
  cleanup();
});

/** Base props — every test overrides what it needs. Mocks are per-call fresh. */
function baseProps(overrides: Partial<PaneSplitterProps> = {}): PaneSplitterProps {
  return {
    leftPct: 50,
    onChange: vi.fn(),
    onCommit: vi.fn(),
    minPct: 33,
    maxPct: 67,
    ...overrides,
  };
}

describe('PaneSplitter', () => {
  // ————— 1. ARIA roles/values —————
  it('exposes separator ARIA roles, values, and tabindex', () => {
    renderWithUser(<PaneSplitter {...baseProps({ leftPct: 42, minPct: 30, maxPct: 70 })} />);

    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('aria-valuenow', '42');
    expect(sep).toHaveAttribute('aria-valuemin', '30');
    expect(sep).toHaveAttribute('aria-valuemax', '70');
    expect(sep).toHaveAttribute('aria-label', 'Resize question and document panes');
    expect(sep).toHaveAttribute('tabindex', '0');
  });

  it('uses a custom aria-label when provided', () => {
    renderWithUser(<PaneSplitter {...baseProps({ label: 'Resize panes' })} />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-label', 'Resize panes');
  });

  // ————— 2. Keyboard resizing (±2%) —————
  it('ArrowRight increases the split by 2% and commits', () => {
    const props = baseProps();
    renderWithUser(<PaneSplitter {...props} />);

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });

    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith(52);
    expect(props.onCommit).toHaveBeenCalledWith(52);
  });

  it('ArrowLeft decreases the split by 2% and commits', () => {
    const props = baseProps();
    renderWithUser(<PaneSplitter {...props} />);

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });

    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith(48);
    expect(props.onCommit).toHaveBeenCalledWith(48);
  });

  // ————— 3. Clamping —————
  it('clamps ArrowLeft at minPct', () => {
    const props = baseProps({ leftPct: 33 });
    renderWithUser(<PaneSplitter {...props} />);

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });

    expect(props.onChange).toHaveBeenCalledWith(33);
  });

  it('clamps ArrowRight at maxPct', () => {
    const props = baseProps({ leftPct: 66 });
    renderWithUser(<PaneSplitter {...props} />);

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });

    expect(props.onChange).toHaveBeenCalledWith(67);
  });

  // ————— 4. Home / End —————
  it('Home sets minPct, End sets maxPct, both commit', () => {
    const props = baseProps({ leftPct: 50 });
    renderWithUser(<PaneSplitter {...props} />);
    const sep = screen.getByRole('separator');

    fireEvent.keyDown(sep, { key: 'Home' });
    expect(props.onChange).toHaveBeenCalledWith(33);
    expect(props.onCommit).toHaveBeenCalledWith(33);

    fireEvent.keyDown(sep, { key: 'End' });
    expect(props.onChange).toHaveBeenCalledWith(67);
    expect(props.onCommit).toHaveBeenCalledWith(67);
  });

  // ————— 5. Unrelated keys are ignored —————
  it('ignores keys that are not resize shortcuts', () => {
    const props = baseProps();
    renderWithUser(<PaneSplitter {...props} />);

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'Enter' });

    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  // ————— 6. Drag contract —————
  it('is a valid flex gutter target with the documented markup', () => {
    renderWithUser(<PaneSplitter {...baseProps()} />);

    const sep = screen.getByRole('separator');
    expect(sep.className).toContain('cursor-col-resize');
  });
});