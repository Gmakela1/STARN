import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import DocProgressBar, { computeProgress } from './DocProgressBar';
import type { RoadmapPhase } from '../types/api';

const PHASE_IDS = [
  'SS-01', 'SS-02', 'SS-03', 'SS-04', 'SS-05',
  'SS-06', 'SS-07', 'SS-08', 'SS-09', 'SS-10',
  'SS-11', 'SS-12', 'SS-13',
];

function makePhases(
  overrides: Partial<Record<string, Partial<RoadmapPhase>>> = {}
): RoadmapPhase[] {
  return PHASE_IDS.map((id) => {
    const o = overrides[id];
    return {
      id,
      name: id.replace('-', ' '),
      status: 'PENDING' as const,
      artifactPath: `${id}/doc.md`,
      contentHash: null,
      docExists: false,
      openQuestions: 0,
      ...o,
    };
  });
}

describe('computeProgress', () => {
  it('counts every approved doc as green regardless of open questions (5 approved -> greenCount=5)', () => {
    const phases = makePhases({
      'SS-01': { status: 'COMPLETED' },
      'SS-02': { status: 'COMPLETED' },
      'SS-03': { status: 'COMPLETED' },
      'SS-04': { status: 'COMPLETED' },
      'SS-05': { status: 'COMPLETED' },
    });
    const result = computeProgress(phases, {});
    expect(result.approved).toBe(5);
    expect(result.greenCount).toBe(5);
    expect(result.drafted).toBe(0);
    expect(result.notStarted).toBe(8);
    expect('openQuestions' in result).toBe(false);
  });

  it('all approved -> greenCount=13, drafted=0, notStarted=0', () => {
    const phases = makePhases();
    const allCompleted = phases.map((p) => ({ ...p, status: 'COMPLETED' as const }));
    const result = computeProgress(allCompleted, {});
    expect(result.approved).toBe(13);
    expect(result.greenCount).toBe(13);
    expect(result.drafted).toBe(0);
    expect(result.notStarted).toBe(0);
  });

  it('handles empty/null docStatus without crashing', () => {
    const phases = makePhases({
      'SS-01': { docExists: true },
    });
    const result1 = computeProgress(phases, null);
    expect(result1.approved).toBe(0);
    expect(result1.drafted).toBe(1);
    expect(result1.notStarted).toBe(12);

    const result2 = computeProgress(phases, {});
    expect(result2.approved).toBe(0);
    expect(result2.drafted).toBe(1);
  });

  it('counts docStatus "passed" and "auto-approved" as approved', () => {
    const phases = makePhases();
    const docStatus: Record<string, string> = {
      'SS-01': 'passed',
      'SS-02': 'auto-approved',
      'SS-03': 'drafted',
    };
    const result = computeProgress(phases, docStatus);
    expect(result.approved).toBe(2);
    expect(result.drafted).toBe(1);
    expect(result.notStarted).toBe(10);
  });

  it('counts PENDING_REVIEW as drafted when not already approved', () => {
    const phases = makePhases({
      'SS-01': { status: 'PENDING_REVIEW' },
    });
    const result = computeProgress(phases, {});
    expect(result.approved).toBe(0);
    expect(result.drafted).toBe(1);
    expect(result.notStarted).toBe(12);
  });

  it('PENDING_REVIEW is NOT double-counted when also approved', () => {
    const phases = makePhases({
      'SS-01': { status: 'COMPLETED' },
    });
    const result = computeProgress(phases, {});
    expect(result.approved).toBe(1);
    expect(result.drafted).toBe(0);
    expect(result.notStarted).toBe(12);
  });
});

describe('DocProgressBar component', () => {
  const defaultPhases = makePhases({
    'SS-01': { status: 'COMPLETED' },
    'SS-02': { status: 'COMPLETED' },
    'SS-03': { status: 'COMPLETED' },
    'SS-04': { docExists: true },
    'SS-05': { docExists: true },
  });

  function setup(overrides: {
    phases?: RoadmapPhase[];
    docStatus?: Record<string, string>;
    totalPhases?: number;
  } = {}) {
    const onNavigateToDashboard = vi.fn();
    const result = renderWithUser(
      <DocProgressBar
        phases={overrides.phases ?? defaultPhases}
        docStatus={overrides.docStatus ?? {}}
        totalPhases={overrides.totalPhases ?? 13}
        onNavigateToDashboard={onNavigateToDashboard}
      />
    );
    return { ...result, onNavigateToDashboard };
  }

  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders three segments when all states present', () => {
    setup();
    // 3 approved = 3 green, 2 drafted, rest = 8 not started
    const bar = screen.getByRole('progressbar');
    expect(bar).toBeInTheDocument();

    // The bar should contain segments for green (greenCount=3), drafted (2), and not started
    // We verify the structure by checking aria values
    expect(bar).toHaveAttribute('aria-valuenow', '3'); // approved docs only
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '13');
  });

  it('does not render zero-width segments', () => {
    // All approved -> no drafted or not-started segments
    const phases = makePhases();
    const allCompleted = phases.map((p) => ({ ...p, status: 'COMPLETED' as const }));
    setup({ phases: allCompleted });

    const bar = screen.getByRole('progressbar');
    // Should have only green segment (no drafted, no not-started divs with 0 width)
    const childDivs = bar.querySelectorAll('div');
    // Only one child div (the green fill) since others are 0-width
    expect(childDivs.length).toBeGreaterThanOrEqual(1);

    // No div with zero width should appear (width: 0px or width: 0% exactly)
    const zeroWidthDivs = Array.from(childDivs).filter(
      (div) => /width\s*:\s*0(?:px|%)/.test(div.getAttribute('style') ?? '')
    );
    expect(zeroWidthDivs).toHaveLength(0);
  });

  it('renders no open-question badge or popover row', async () => {
    const { user } = setup();
    expect(screen.queryByText('3')).toBeNull();
    await user.click(screen.getByRole('progressbar'));
    expect(screen.queryByText('Open questions')).toBeNull();
  });

  it('labels the bar in documents approved', () => {
    setup();
    // 3 approved of 13 (drafted docs are not approved)
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-label',
      'Project progress: 3 of 13 documents approved'
    );
  });

  it('click opens popover, Escape closes it', async () => {
    const { user } = setup();

    // Click the progress bar
    const bar = screen.getByRole('progressbar');
    await user.click(bar);

    // Popover should be visible
    expect(screen.getByRole('dialog', { name: 'Project status details' })).toBeInTheDocument();

    // Press Escape
    await user.keyboard('{Escape}');

    // Popover should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Project status details' })).toBeNull();
    });
  });

  it('exposes a keyboard-focusable button trigger named by the progress label', () => {
    setup();
    const trigger = screen.getByRole('button', {
      name: 'Project progress: 3 of 13 documents approved',
    });
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('tabindex', '-1');
    expect(trigger).toContainElement(screen.getByRole('progressbar'));
  });

  it('keyboard Enter and Space toggle the popover and aria-expanded', async () => {
    const { user } = setup();
    const trigger = screen.getByRole('button', { name: /Project progress/ });

    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Project status details' });
    expect(dialog.id).not.toBe('');
    expect(trigger).toHaveAttribute('aria-controls', dialog.id);

    await user.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Project status details' })).toBeNull();
  });

  it('Escape closes the popover and returns focus to the trigger', async () => {
    const { user } = setup();
    const trigger = screen.getByRole('button', { name: /Project progress/ });
    await user.click(trigger);
    const viewButton = screen.getByRole('button', { name: /View full status report/i });
    viewButton.focus();
    expect(viewButton).toHaveFocus();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Project status details' })).toBeNull();
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('calls onNavigateToDashboard when clicking view full status report', async () => {
    const { user, onNavigateToDashboard } = setup();

    await user.click(screen.getByRole('button', { name: /Project progress/ }));

    const viewButton = screen.getByRole('button', { name: /View full status report/i });
    await user.click(viewButton);

    expect(onNavigateToDashboard).toHaveBeenCalledTimes(1);
  });

  it('renders a visible "Docs <approved>/<total>" label inside the trigger button', () => {
    setup();
    const label = screen.getByText('Docs 3/13');
    const trigger = screen.getByRole('button', { name: /Project progress/ });
    expect(trigger).toContainElement(label);
    expect(label.className).toContain('text-[11px]');
    expect(label.className).toContain('font-semibold');
    expect(label.className).toContain('text-slate-300');
    expect(label.className).toContain('tabular-nums');
    // hidden below lg
    expect(label.className).toContain('hidden');
    expect(label.className).toContain('lg:inline');
  });

  it('label tracks approved/total and keeps the trigger aria-label unchanged', () => {
    setup({ totalPhases: 10, phases: makePhases({ 'SS-01': { status: 'COMPLETED' } }) });
    expect(screen.getByText('Docs 1/10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project progress: 1 of 10 documents approved' })).toBeInTheDocument();
  });

  it('clicking the label opens the popover titled "Document progress"', async () => {
    const { user } = setup();
    await user.click(screen.getByText('Docs 3/13'));
    expect(screen.getByRole('heading', { name: 'Document progress' })).toBeInTheDocument();
    expect(screen.queryByText('Project Status')).toBeNull();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Drafted')).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('aria-valuenow reflects approved docs, matching the label', () => {
    // 3 approved, 2 drafted -> aria-valuenow = 3
    setup();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
  });
});
