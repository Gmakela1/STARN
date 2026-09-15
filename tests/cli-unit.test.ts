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

// ── Model selection choice-ordering logic (extracted from promptSelectLiveModel) ──
function buildModelChoices(
  models: ModelOption[],
  currentDefault: string
): { name: string; value: string }[] {
  const lastUsedModel = models.find(m => m.id === currentDefault);
  const choices = models.map(m => ({
    name: m.id === currentDefault && lastUsedModel
      ? formatModelChoice(m) + '  ← last used'
      : formatModelChoice(m),
    value: m.id
  }));
  if (lastUsedModel) {
    const idx = choices.findIndex(c => c.value === currentDefault);
    if (idx > 0) {
      const [item] = choices.splice(idx, 1);
      choices.unshift(item);
    }
  }
  return choices;
}

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
          testplans: { id: 'testplans', name: 'Test Plans & Procedures', status: 'pending', artifactPath: 'docs/TEST_PLANS.md', updatedAt: null },
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

describe('Model selection — last-used pinning', () => {
  const sampleModels: ModelOption[] = [
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Top-tier', recommended: true },
    { id: 'openai/gpt-4o',               name: 'GPT-4o',            description: 'Strong general', recommended: true },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash',  description: 'Fast',          recommended: false },
    { id: 'deepseek/deepseek-chat',      name: 'DeepSeek V3',       description: 'Cost-effective', recommended: false },
  ];

  it('pins the last-used model to position 0 when it is not already first', () => {
    const choices = buildModelChoices(sampleModels, 'deepseek/deepseek-chat');
    expect(choices[0].value).toBe('deepseek/deepseek-chat');
  });

  it('annotates the last-used model name with ← last used', () => {
    const choices = buildModelChoices(sampleModels, 'openai/gpt-4o');
    const lastUsedChoice = choices.find(c => c.value === 'openai/gpt-4o');
    expect(lastUsedChoice?.name).toContain('← last used');
  });

  it('does not annotate any other model', () => {
    const choices = buildModelChoices(sampleModels, 'openai/gpt-4o');
    const others = choices.filter(c => c.value !== 'openai/gpt-4o');
    for (const c of others) {
      expect(c.name).not.toContain('← last used');
    }
  });

  it('does not duplicate the last-used model — appears exactly once', () => {
    const choices = buildModelChoices(sampleModels, 'google/gemini-2.0-flash-001');
    const count = choices.filter(c => c.value === 'google/gemini-2.0-flash-001').length;
    expect(count).toBe(1);
  });

  it('all models are still present in the list', () => {
    const choices = buildModelChoices(sampleModels, 'deepseek/deepseek-chat');
    expect(choices).toHaveLength(sampleModels.length);
    for (const m of sampleModels) {
      expect(choices.some(c => c.value === m.id)).toBe(true);
    }
  });

  it('no change when last-used model is already first', () => {
    const choices = buildModelChoices(sampleModels, 'anthropic/claude-3.5-sonnet');
    expect(choices[0].value).toBe('anthropic/claude-3.5-sonnet');
    expect(choices[0].name).toContain('← last used');
  });

  it('no pinning or annotation when currentDefault is not in the list', () => {
    const choices = buildModelChoices(sampleModels, 'unknown/model-xyz');
    expect(choices[0].value).toBe('anthropic/claude-3.5-sonnet'); // original order preserved
    for (const c of choices) {
      expect(c.name).not.toContain('← last used');
    }
  });
});
