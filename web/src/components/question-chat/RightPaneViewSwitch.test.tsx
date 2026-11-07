import { useState } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { cleanup, renderWithUser } from '../../test/render';
import RightPaneViewSwitch, { type RightPaneView } from './RightPaneViewSwitch';

afterEach(() => cleanup());

/** Fully controlled, exactly as DevelopmentView will hold `rightView`. */
function Harness({ initial = 'doc', disabled }: { initial?: RightPaneView; disabled?: boolean }) {
  const [value, setValue] = useState<RightPaneView>(initial);
  return <RightPaneViewSwitch value={value} onChange={setValue} disabled={disabled} />;
}

describe('RightPaneViewSwitch — structure', () => {
  it('is a labelled tablist with exactly two tabs', () => {
    renderWithUser(<Harness />);
    const tablist = screen.getByRole('tablist', { name: 'Right pane view' });
    expect(tablist).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Document' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Details' })).toBeInTheDocument();
  });

  it('wires aria-selected, aria-controls and roving tabindex', () => {
    renderWithUser(<Harness />);
    const doc = screen.getByRole('tab', { name: 'Document' });
    const details = screen.getByRole('tab', { name: 'Details' });
    expect(doc).toHaveAttribute('aria-selected', 'true');
    expect(details).toHaveAttribute('aria-selected', 'false');
    expect(doc).toHaveAttribute('aria-controls', 'pane-doc');
    expect(details).toHaveAttribute('aria-controls', 'pane-details');
    expect(doc).toHaveAttribute('tabindex', '0');
    expect(details).toHaveAttribute('tabindex', '-1');
    expect(doc.className).toContain('min-h-[44px]');
    expect(details.className).toContain('min-h-[44px]');
  });

  it('switches to Details on click', async () => {
    const { user } = renderWithUser(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Document' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('tabindex', '0');
  });
});

describe('RightPaneViewSwitch — keyboard', () => {
  it('ArrowRight and ArrowLeft move focus and auto-activate', async () => {
    const { user } = renderWithUser(<Harness />);
    screen.getByRole('tab', { name: 'Document' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Document' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Document' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Home and End jump to the first and last tab', async () => {
    const { user } = renderWithUser(<Harness />);
    screen.getByRole('tab', { name: 'Document' }).focus();

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Document' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Document' })).toHaveAttribute('aria-selected', 'true');
  });

  it('costs exactly one Tab stop (only the selected tab is reachable)', async () => {
    const { user } = renderWithUser(<Harness />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Document' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Details' })).not.toHaveFocus();
  });
});

describe('RightPaneViewSwitch — disabled without a details item', () => {
  it('marks the Details tab aria-disabled and keeps it focusable', () => {
    renderWithUser(<Harness disabled />);
    const details = screen.getByRole('tab', { name: 'Details' });
    expect(details).toHaveAttribute('aria-disabled', 'true');
    expect(details).not.toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Document' })).not.toHaveAttribute('aria-disabled');
  });

  it('ignores click and arrow activation on the disabled Details tab', async () => {
    const onChange = vi.fn();
    const { user } = renderWithUser(
      <RightPaneViewSwitch value="doc" onChange={onChange} disabled />
    );
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    screen.getByRole('tab', { name: 'Document' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still switches back to Document from Details', async () => {
    const onChange = vi.fn();
    const { user } = renderWithUser(
      <RightPaneViewSwitch value="details" onChange={onChange} disabled />
    );
    await user.click(screen.getByRole('tab', { name: 'Document' }));
    expect(onChange).toHaveBeenCalledWith('doc');
  });
});
