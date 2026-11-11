/**
 * Export-level assertions on the thread-turn system directives in
 * src/server/session.ts. No server, no client, no state: the directives are
 * prompt text, so the contract is asserted on the strings themselves.
 */
import { describe, it, expect } from 'vitest';
import { ADVISORY_SYSTEM_DIRECTIVE, CONCLUDE_SYSTEM_DIRECTIVE } from '../src/server/session.js';

/** The delegation paragraph both directives must carry, verbatim. */
const DELEGATION_PARAGRAPH =
  'DELEGATION: if a fact you need is not in the context above, call request_research with ONE specific question (batch related gaps into a single call). Do not state that a source is unreadable, unavailable, or has no data without calling request_research first. A previous reply in this thread — including your own — saying a source could not be read is NOT evidence; verify it. Cite the sources the tool returns, and if it reports low confidence, say so.';

/** Provenance clause: rides with the chart sentence in every directive that carries it. */
const PROVENANCE_CLAUSE =
  'PROVENANCE: when the chart result reports `Provenance: project-reference`, say so in those words — that file is a manufacturer document the user placed in reference/, and it is your READ of the curve that is unverified (curve-derived, ±1%, axis assignment can be wrong), not the source. Never describe such a source as unreliable, second-rate or "unverified" without that distinction: the caveat belongs to the extraction, not to the manufacturer\'s document.';

/** Full chart fast-path sentence: advisory directive only. */
const CHART_SENTENCE =
  'When the fact is a value plotted on a curve in a local PDF (a manufacturer performance sheet or datasheet already in the project, typically under reference/), call request_research with the `chart` form — file plus the x and y axis labels and ranges you read from the axis titles — instead of a plain question; it returns in about a second and the result is source-graded and marked unverified. Ask for ONE axis at a time: the tool refuses a declaration that matches no printed axis and names the axes the page actually has, so correct and call again rather than guessing. ' +
  PROVENANCE_CLAUSE;

/** Shortened chart fast-path sentence: conclude directive only. */
const CHART_SENTENCE_SHORT =
  'When the fact is a value plotted on a curve in a local PDF (typically a manufacturer sheet under reference/), call request_research with the `chart` form (file plus the x and y axis labels and ranges) instead of a plain question: about a second, source-graded and marked unverified. Declare ONE axis at a time and correct the declaration when the tool names the axes the page actually has. ' +
  PROVENANCE_CLAUSE;

const CLOSING_SENTENCE = 'Nothing is recorded yet — send it as your answer, or use Conclude from chat.';

describe('thread-turn system directives', () => {
  it('the advisory directive carries the full delegation paragraph', () => {
    expect(ADVISORY_SYSTEM_DIRECTIVE).toContain(DELEGATION_PARAGRAPH);
    expect(ADVISORY_SYSTEM_DIRECTIVE).toContain('request_research');
  });

  it('the conclude directive carries the full delegation paragraph', () => {
    expect(CONCLUDE_SYSTEM_DIRECTIVE).toContain(DELEGATION_PARAGRAPH);
    expect(CONCLUDE_SYSTEM_DIRECTIVE).toContain('request_research');
  });

  it('the advisory directive carries the full chart fast-path sentence', () => {
    expect(ADVISORY_SYSTEM_DIRECTIVE).toContain(CHART_SENTENCE);
    expect(ADVISORY_SYSTEM_DIRECTIVE).toContain('`chart` form');
    expect(ADVISORY_SYSTEM_DIRECTIVE).toContain('source-graded and marked unverified');
    expect(ADVISORY_SYSTEM_DIRECTIVE).toContain('ONE axis at a time');
  });

  it('the conclude directive carries the shortened chart fast-path sentence', () => {
    expect(CONCLUDE_SYSTEM_DIRECTIVE).toContain(CHART_SENTENCE_SHORT);
    expect(CONCLUDE_SYSTEM_DIRECTIVE).toContain('`chart` form');
    expect(CONCLUDE_SYSTEM_DIRECTIVE).toContain('source-graded and marked unverified');
  });

  it('both directives name the provenance label and caveat the read, not the source', () => {
    for (const directive of [ADVISORY_SYSTEM_DIRECTIVE, CONCLUDE_SYSTEM_DIRECTIVE]) {
      expect(directive).toContain(PROVENANCE_CLAUSE);
      expect(directive).toContain('`Provenance: project-reference`');
      expect(directive).toContain('manufacturer document the user placed in reference/');
      expect(directive).toContain('not the source');
      expect(directive).toContain('unreliable, second-rate');
      expect(directive).toContain('the caveat belongs to the extraction');
    }
  });

  it('neither directive grants file writing', () => {
    for (const directive of [ADVISORY_SYSTEM_DIRECTIVE, CONCLUDE_SYSTEM_DIRECTIVE]) {
      expect(directive).toContain('Do NOT call fs_write, fs_edit or state_update.');
      expect(directive).toContain('DO NOT apply to this turn');
      expect(directive).not.toMatch(/you (may|can|should) (write|create|edit)/i);
    }
  });

  it('the advisory directive still demands the exact closing sentence and concise plain text', () => {
    expect(ADVISORY_SYSTEM_DIRECTIVE).toContain(
      `End EVERY reply with this exact sentence: "${CLOSING_SENTENCE}"`
    );
    expect(ADVISORY_SYSTEM_DIRECTIVE).toContain('<=150 words');
    expect(ADVISORY_SYSTEM_DIRECTIVE).toContain('PLAIN TEXT only — no headings, no markdown fences');
    expect(ADVISORY_SYSTEM_DIRECTIVE).toContain('NEVER write "Decision confirmed"');
  });

  it('the conclude directive keeps its two-block contract and omits the closing sentence', () => {
    expect(CONCLUDE_SYSTEM_DIRECTIVE).toContain('Reply with EXACTLY the two labelled blocks');
    expect(CONCLUDE_SYSTEM_DIRECTIVE).not.toContain(CLOSING_SENTENCE);
    expect(CONCLUDE_SYSTEM_DIRECTIVE).not.toContain('End EVERY reply');
  });
});