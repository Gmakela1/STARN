import { describe, it, expect } from 'vitest';
import {
  formatCriticScorecard,
  formatBanner,
  formatModelChoice,
  extractCleanMarkdownDocument,
  formatDocumentPreview
} from '../src/cli/ui.js';
import { CriticResult } from '../src/core/critic.js';
import { ModelOption } from '../src/openrouter/models.js';

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

  it('formats model choice label with context length and pricing', () => {
    const model: ModelOption = {
      id: 'anthropic/claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
      description: 'Flagship model',
      recommended: true,
      contextLengthFormatted: '200k ctx',
      pricingFormatted: '$3.00/$15.00'
    };

    const label = formatModelChoice(model);
    expect(label).toContain('anthropic/claude-3.5-sonnet');
    expect(label).toContain('200k ctx');
    expect(label).toContain('$3.00/$15.00');
    expect(label).toContain('★');
  });

  it('strips conversational preamble and extracts pure markdown deliverable', () => {
    const raw = `Here is your requested deliverable:\n\n# Concept of Operations (CONOPS)\n## 1.0 Executive Summary\nTractor conversion.\n\nLet me know if you want revisions!`;
    const cleaned = extractCleanMarkdownDocument(raw);
    expect(cleaned.startsWith('# Concept of Operations (CONOPS)')).toBe(true);
    expect(cleaned).not.toContain('Here is your requested deliverable');
    expect(cleaned).not.toContain('Let me know if you want revisions');
  });

  it('formats clean preview box for large documents', () => {
    const content = `# Concept of Operations\n## 1.0 Executive Summary\nLine 1\nLine 2\n## 2.0 Operational Environment\nLine 3\n## 3.0 System Modes\nLine 4`;
    const preview = formatDocumentPreview(content, 'CONOPS Document');
    expect(preview).toContain('CONOPS Document');
    expect(preview).toContain('Executive Summary');
    expect(preview).toContain('Operational Environment');
  });
});
