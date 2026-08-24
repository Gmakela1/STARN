import { describe, it, expect } from 'vitest';
import {
  formatCriticScorecard,
  formatBanner,
  formatModelChoice,
  extractCleanMarkdownDocument,
  formatDocumentPreview,
  formatWorkflowRoadmap
} from '../src/cli/ui.js';
import { CriticResult } from '../src/core/critic.js';
import { ModelOption } from '../src/openrouter/models.js';
import { ProjectState } from '../src/workspace/types.js';

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

  it('formats project workflow roadmap banner with phase markers', () => {
    const mockState: Partial<ProjectState> = {
      name: 'Tractor EV Conversion',
      workflow: {
        activePhase: 'conops',
        phases: {
          conops: { id: 'conops', name: 'CONOPS / User Intent', status: 'in_progress', artifactPath: 'docs/CONOPS.md', updatedAt: null },
          capabilities: { id: 'capabilities', name: 'Product Capabilities', status: 'pending', artifactPath: 'docs/CAPABILITIES.md', updatedAt: null },
          requirements: { id: 'requirements', name: 'System Requirements', status: 'pending', artifactPath: 'docs/REQUIREMENTS.md', updatedAt: null },
          rtm: { id: 'rtm', name: 'Requirements Traceability Matrix (RTM)', status: 'locked', artifactPath: 'docs/RTM.md', updatedAt: null },
          milestones: { id: 'milestones', name: 'Project Milestones & Gating', status: 'pending', artifactPath: 'docs/MILESTONES.md', updatedAt: null },
          wbs: { id: 'wbs', name: 'Work Breakdown Structure (WBS)', status: 'pending', artifactPath: 'docs/WBS.md', updatedAt: null },
          sow: { id: 'sow', name: 'Statement of Work (SOW)', status: 'pending', artifactPath: 'docs/SOW.md', updatedAt: null }
        }
      }
    };

    const roadmap = formatWorkflowRoadmap(mockState as ProjectState);
    expect(roadmap).toContain('STARN PROJECT WORKFLOW ROADMAP');
    expect(roadmap).toContain('CONOPS / User Intent');
    expect(roadmap).toContain('IN PROGRESS');
    expect(roadmap).toContain('LOCKED');
    expect(roadmap).toContain('/plan');
  });
});
