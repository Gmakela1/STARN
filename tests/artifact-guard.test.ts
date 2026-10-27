import { describe, it, expect } from 'vitest';
import { classifyTurnArtifact, buildNoDocumentError } from '../src/core/artifact-guard.js';

describe('classifyTurnArtifact', () => {
  it('returns no-tool-calls-no-document when the model made no tool calls, wrote nothing, and returned no heading', () => {
    expect(classifyTurnArtifact('Sure, I will do that.', false, false)).toEqual({
      kind: 'none',
      reason: 'no-tool-calls-no-document'
    });
  });

  it('returns document when the model made tool calls and returned a heading-led document', () => {
    const doc = '# CONOPS\n\n## Operational Context\n\nThis document...';
    expect(classifyTurnArtifact(doc, true, false)).toEqual({ kind: 'document', artifact: doc });
  });

  it('returns document for a heading-led artifact recovered from disk after writing', () => {
    // drafting model wrote to disk but the reply was commentary; the runner
    // recovered the on-disk doc, which must still classify as a document.
    const recovered = '# CONOPS\n\nOn-disk deliverable.';
    expect(classifyTurnArtifact(recovered, false, true)).toEqual({
      kind: 'document',
      artifact: recovered
    });
  });

  it('classifies prose without a heading as commentary', () => {
    expect(classifyTurnArtifact('I have drafted the document for you.', true, false)).toEqual({
      kind: 'commentary',
      artifact: 'I have drafted the document for you.'
    });
  });

  it('classifies empty or missing artifacts as none/empty', () => {
    expect(classifyTurnArtifact('', true, false)).toEqual({ kind: 'none', reason: 'empty' });
    expect(classifyTurnArtifact(null, true, false)).toEqual({ kind: 'none', reason: 'empty' });
    expect(classifyTurnArtifact(undefined, true, false)).toEqual({ kind: 'none', reason: 'empty' });
  });

  it('classifies an empty artifact with no tool calls as no-tool-calls-no-document', () => {
    // matches the runner: the no-tool-calls guard fires before the empty guard
    expect(classifyTurnArtifact('', false, false)).toEqual({
      kind: 'none',
      reason: 'no-tool-calls-no-document'
    });
  });
});

describe('buildNoDocumentError', () => {
  it('matches the runner no-document message byte-for-byte', () => {
    expect(buildNoDocumentError('qwen2.5:7b', 'Ollama')).toBe(
      'Drafting model "qwen2.5:7b" on "Ollama" produced no document. It may not support tool calling. Reassign drafting in Settings or /models.'
    );
    expect(buildNoDocumentError('gpt-4o', 'OpenRouter')).toBe(
      'Drafting model "gpt-4o" on "OpenRouter" produced no document. It may not support tool calling. Reassign drafting in Settings or /models.'
    );
  });
});