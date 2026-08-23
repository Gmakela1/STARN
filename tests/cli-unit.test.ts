import { describe, it, expect } from 'vitest';
import { formatCriticScorecard, formatBanner } from '../src/cli/ui.js';
import { CriticResult } from '../src/core/critic.js';

describe('CLI UI formatting', () => {
  it('formats critic scorecard cleanly with score and summary', () => {
    const mockVerdict: CriticResult = {
      passed: true,
      score: 9.3,
      summary: 'Solid load analysis',
      strengths: ['Clear dimensions'],
      weaknesses: ['Vague fastener pitch'],
      actionableGuidance: 'Specify fastener spacing'
    };

    const formatted = formatCriticScorecard(mockVerdict);
    expect(formatted).toContain('9.3/10');
    expect(formatted).toContain('Solid load analysis');
    expect(formatted).toContain('Clear dimensions');
    expect(formatted).toContain('Vague fastener pitch');
  });

  it('renders application banner', () => {
    const banner = formatBanner();
    expect(banner).toContain('STARN');
  });
});
