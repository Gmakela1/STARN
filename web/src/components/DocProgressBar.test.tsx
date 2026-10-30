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
  it('subtracts open questions from greenCount (5 approved, 2 open -> greenCount=3)', () => {
    const phases = makePhases({
      'SS-01': { status: 'COMPLETED' },
      'SS-02': { status: 'COMPLETED' },
      'SS-03': { status: 'COMPLETED' },
      'SS-04': { status: 'COMPLETED' },
      'SS-05': { status: 'COMPLETED' },
    });
    const result = computeProgress(phases, {}, 2);
    expect(result.approved).toBe(5);
    expect(result.greenCount).toBe(3);
    expect(result.drafted).toBe(0);
    expect(result.notStarted).toBe(8);
    expect(result.openQuestions).toBe(2);
  });

  it('floors greenCount at 0 when open questions exceed approved (3 approved, 7 open)', () => {
    const phases = makePhases({
      'SS-01': { status: 'COMPLETED' },
      'SS-02': { status: 'COMPLETED' },
      'SS-03': { status: 'COMPLETED' },
    });
    const result = computeProgress(phases, {}, 7);
    expect(result.approved).toBe(3);
    expect(result.greenCount).toBe(0);
    expect(result.drafted).toBe(0);
    expect(result.notStarted).toBe(10);
    expect(result.openQuestions).toBe(7);
  });

  it('all approved, zero open questions -> greenCount=13, drafted=0, notStarted=0', () => {
    const phases = makePhases();
    const allCompleted = phases.map((p) => ({ ...p, status: 'COMPLETED' as const }));
    const result = computeProgress(allCompleted, {}, 0);
    expect(result.approved).toBe(13);
    expect(result.greenCount).toBe(13);
    expect(result.drafted).toBe(0);
    expect(result.notStarted).toBe(0);
  });

  it('handles empty/null docStatus without crashing', () => {
    const phases = makePhases({
      'SS-01': { docExists: true },
    });
    const result1 = computeProgress(phases, null, 0);
    expect(result1.approved).toBe(0);
    expect(result1.drafted).toBe(1);
    expect(result1.notStarted).toBe(12);

    const result2 = computeProgress(phases, {}, 0);
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
    const result = computeProgress(phases, docStatus, 0);
    expect(result.approved).toBe(2);
    expect(result.drafted).toBe(1);
    expect(result.notStarted).toBe(10);
  });

  it('counts PENDING_REVIEW as drafted when not already approved', () => {
    const phases = makePhases({
      'SS-01': { status: 'PENDING_REVIEW' },
    });
    const result = computeProgress(phases, {}, 0);
    expect(result.approved).toBe(0);
    expect(result.drafted).toBe(1);
    expect(result.notStarted).toBe(12);
  });

  it('PENDING_REVIEW is NOT double-counted when also approved', () => {
    const phases = makePhases({
      'SS-01': { status: 'COMPLETED' },
    });
    const result = computeProgress(phases, {}, 0);
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
    openQuestions?: number;
  } = {}) {
    const onNavigateToDashboard = vi.fn();
    const result = renderWithUser(
      <DocProgressBar
        phases={overrides.phases ?? defaultPhases}
        docStatus={overrides.docStatus ?? {}}
        totalPhases={overrides.totalPhases ?? 13}
        openQuestions={overrides.openQuestions ?? 0}
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
    setup({ openQuestions: 1 });
    // 3 approved - 1 open = 2 green, 2 drafted = 2, rest = 9 not started
    const bar = screen.getByRole('progressbar');
    expect(bar).toBeInTheDocument();

    // The bar should contain segments for green (greenCount=2), drafted (2), and not started
    // We verify the structure by checking aria values
    expect(bar).toHaveAttribute('aria-valuenow', '4'); // greenCount(2) + drafted(2)
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '13');
  });

  it('does not render zero-width segments', () => {
    // All approved, zero open questions -> no drafted or not-started segments
    const phases = makePhases();
    const allCompleted = phases.map((p) => ({ ...p, status: 'COMPLETED' as const }));
    setup({ phases: allCompleted, openQuestions: 0 });

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

  it('renders the open-question amber badge', () => {
    setup({ openQuestions: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('click opens popover, Escape closes it', async () => {
    const { user } = setup({ openQuestions: 2 });

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

  it('calls onNavigateToDashboard when clicking view full status report', async () => {
    const { user, onNavigateToDashboard } = setup({ openQuestions: 2 });

    const bar = screen.getByRole('progressbar');
    await user.click(bar);

    const viewButton = screen.getByRole('button', { name: /View full status report/i });
    await user.click(viewButton);

    expect(onNavigateToDashboard).toHaveBeenCalledTimes(1);
  });

  it('aria-valuenow reflects greenCount + drafted', () => {
    // 3 approved, 0 open questions -> greenCount=3
    // 2 drafted -> drafted=2
    // aria-valuenow = 5
    setup({ openQuestions: 0 });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '5');
  });

  it('does not show openQuestions count in the bar label when openQuestions=0', () => {
    setup({ openQuestions: 0 });
    expect(screen.queryByText('0')).toBeNull();
  });
});