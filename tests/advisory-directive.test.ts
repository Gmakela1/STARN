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