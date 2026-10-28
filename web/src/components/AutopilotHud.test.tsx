import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderWithUser } from '../test/render';
import AutopilotHud from './AutopilotHud';
import { AutopilotStatusResponse, RoadmapPhase } from '../types/api';

// AutopilotHud is now a thin wrapper: PhaseRail + Start/Stop. These tests pin
// the call-site behaviour (idle → Start, running → Stop) and the dot-click wire.

const PHASE_IDS = [
  'conops', 'architecture', 'icd', 'capabilities', 'requirements', 'bom', 'rtm',
  'milestones', 'risk-register', 'build-sequence', 'work-instructions', 'testplans', 'sow',
];
const PHASE_NAMES = [
  'CONOPS', 'Architecture', 'ICD', 'Capabilities', 'Requirements', 'BOM', 'RTM',
  'Milestones', 'Risk', 'Build Seq', 'WI', 'Test Plans', 'SOW',
];

const status = (over: Partial<AutopilotStatusResponse> = {}): AutopilotStatusResponse => ({
  enabled: true,
  running: false,
  docStatus: {},
  blocks: 0,
  passedCount: 0,
  totalPhases: 13,
  ...over,
});

const roadmap: RoadmapPhase[] = PHASE_IDS.map((id, i) => ({
  id,
  name: PHASE_NAMES[i],
  status: 'PENDING',
  artifactPath: `docs/${id}.md`,
  contentHash: null,
  docExists: false,
  openQuestions: 0,
}));

describe('AutopilotHud', () => {
  it('renders nothing when autopilot is disabled', () => {
    const { container } = render(
      <AutopilotHud status={null} enabled={false} onStart={async () => {}} onStop={async () => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the 13-dot PhaseRail and the Start button when idle', () => {
    const { container } = render(
      <AutopilotHud
        status={status()}
        enabled
        onStart={async () => {}}
        onStop={async () => {}}
        roadmap={roadmap}
        onSelectPhase={vi.fn()}
      />,
    );
    expect(container.querySelector('ol[role="list"]')!.querySelectorAll('li')).toHaveLength(13);
    expect(screen.getByRole('button', { name: 'Start autopilot auto-drafting' })).toBeInTheDocument();
    // dead "Drafting: {name}" text is gone
    expect(screen.queryByText(/Drafting:/)).not.toBeInTheDocument();
  });

  it('shows the Stop button while running', () => {
    render(
      <AutopilotHud
        status={status({ running: true, currentPhaseId: 'icd', docStatus: { icd: 'drafting' } })}
        enabled
        onStart={async () => {}}
        onStop={async () => {}}
        roadmap={roadmap}
        onSelectPhase={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Stop autopilot' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start autopilot auto-drafting' })).not.toBeInTheDocument();
  });

  it('maps docStatus + roadmap through railStateFor (approved / error-parked labels)', () => {
    render(
      <AutopilotHud
        status={status({ docStatus: { conops: 'passed', 'risk-register': 'parked' } })}
        enabled
        onStart={async () => {}}
        onStop={async () => {}}
        roadmap={roadmap}
        onSelectPhase={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'CONOPS — Approved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Risk — Error — needs attention' })).toBeInTheDocument();
  });

  it('wires dot clicks through onSelectPhase with the phase id', async () => {
    const onSelectPhase = vi.fn();
    const { user } = renderWithUser(
      <AutopilotHud
        status={status()}
        enabled
        onStart={async () => {}}
        onStop={async () => {}}
        roadmap={roadmap}
        onSelectPhase={onSelectPhase}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'ICD — Not started' }));
    expect(onSelectPhase).toHaveBeenCalledWith('icd');
  });
});