import { describe, it, expect } from 'vitest';
import { requestResearchHandler } from '../src/tools/handlers/request-research.js';
import type { ToolExecutionContext } from '../src/tools/types.js';
import type { ResearchDelegationResult } from '../src/core/research-delegation.js';

/** Minimal context: the handler only reads `requestResearch`. */
function ctx(requestResearch?: ToolExecutionContext['requestResearch']): ToolExecutionContext {
  return { projectPath: '.', stateManager: {} as any, requestResearch };
}

type OkResult = Extract<ResearchDelegationResult, { ok: true }>;

function okResult(overrides: Partial<OkResult> = {}): OkResult {
  return {
    ok: true,
    answer: 'Continuous rating is 12 kW at 72 V.',
    sources: [{ title: 'ME1115 datasheet', url: 'https://vendor.example/me1115.pdf' }],
    confidence: 0.62,
    band: 'medium',
    reasoning: 'datasheet table, single source',
    ...overrides
  };
}

/** Stub capability that records the request it received. */
function stub(result: ResearchDelegationResult, seen: { req?: { question: string; focus?: string[] } } = {}) {
  return async (req: { question: string; focus?: string[] }) => {
    seen.req = req;
    return result;
  };
}

describe('request_research tool definition', () => {
  it('declares name, question and optional focus', () => {
    const def = requestResearchHandler.definition.function;
    expect(requestResearchHandler.name).toBe('request_research');
    expect(def.name).toBe('request_research');
    expect(def.description).toContain('Max 3 calls per turn');
    expect(def.parameters.required).toEqual(['question']);
    const props = def.parameters.properties as any;
    expect(props.question.type).toBe('string');
    expect(props.focus.type).toBe('array');
  });
});

describe('request_research argument validation', () => {
  it('rejects an empty question', async () => {
    const res = await requestResearchHandler.execute({ question: '   ' }, ctx(stub(okResult())));
    expect(res).toEqual({ success: false, error: 'request_research requires a non-empty question' });
  });

  it('truncates a 1200-character question at 1000 with an ellipsis', async () => {
    const seen: { req?: { question: string; focus?: string[] } } = {};
    const res = await requestResearchHandler.execute(
      { question: 'x'.repeat(1200) },
      ctx(stub(okResult(), seen))
    );
    expect(res.success).toBe(true);
    expect(seen.req!.question).toHaveLength(1001);
    expect(seen.req!.question.endsWith('…')).toBe(true);
  });

  it('keeps only the first 5 of 8 focus paths', async () => {
    const seen: { req?: { question: string; focus?: string[] } } = {};
    await requestResearchHandler.execute(
      { question: 'rating?', focus: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
      ctx(stub(okResult(), seen))
    );
    expect(seen.req!.focus).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('request_research capability absent', () => {
  it('returns the unavailable string as success', async () => {
    const res = await requestResearchHandler.execute({ question: 'rating?' }, ctx(undefined));
    expect(res).toEqual({
      success: true,
      result: 'Research unavailable in this context. Report the gap; do not invent values.'
    });
  });
});

describe('request_research markdown', () => {
  it('renders the three required sections with bulleted sources and a banded confidence', async () => {
    const res = await requestResearchHandler.execute({ question: 'rating?' }, ctx(stub(okResult())));
    const text = res.result as string;
    expect(text).toContain('## Research findings');
    expect(text).toContain('### Evidence');
    expect(text).toContain('### Confidence');
    expect(text).toContain('- ME1115 datasheet — https://vendor.example/me1115.pdf');
    expect(text).toMatch(/### Confidence\n(high|medium|low) \(0\.62\) — /);
  });

  it('renders decision options when present', async () => {
    const res = await requestResearchHandler.execute(
      { question: 'rating?' },
      ctx(stub(okResult({ options: 'A) 10 kW\nB) 12 kW\nRecommended: B' })))
    );
    const text = res.result as string;
    expect(text).toContain('### Decision options');
    expect(text).toContain('Recommended: B');
  });

  it('omits the decision-options heading when there are none', async () => {
    const res = await requestResearchHandler.execute({ question: 'rating?' }, ctx(stub(okResult())));
    expect(res.result as string).not.toContain('### Decision options');
  });

  it('caps a 9000-character answer at 8000 with a truncation notice', async () => {
    const res = await requestResearchHandler.execute(
      { question: 'rating?' },
      ctx(stub(okResult({ answer: 'y'.repeat(9000) })))
    );
    const text = res.result as string;
    expect(text.length).toBeLessThanOrEqual(8000);
    expect(text).toContain('(output truncated at 8000 characters)');
  });
});

describe('request_research failure mapping', () => {
  it('maps timeout', async () => {
    const res = await requestResearchHandler.execute(
      { question: 'rating?' },
      ctx(stub({ ok: false, reason: 'timeout', detail: 'aborted' }))
    );
    expect(res).toEqual({ success: true, result: 'Research timed out after 240 s. Report the gap.' });
  });

  it('keeps the gap message when a timeout salvaged nothing', async () => {
    const res = await requestResearchHandler.execute(
      { question: 'rating?' },
      ctx(stub({ ok: false, reason: 'timeout', detail: '240s', partial: true }))
    );
    expect(res).toEqual({ success: true, result: 'Research timed out after 240 s. Report the gap.' });
  });

  it('names the elapsed budget from the detail', async () => {
    const res = await requestResearchHandler.execute(
      { question: 'rating?' },
      ctx(stub({ ok: false, reason: 'timeout', detail: '0.05s' }))
    );
    expect(res).toEqual({ success: true, result: 'Research timed out after 0.05 s. Report the gap.' });
  });

  it('returns salvaged tool output as unverified leads on timeout', async () => {
    const findings = '[read_chart_data]\n| x | Watts Out |\n|---|---|\n| 100 | 7400 |';
    const res = await requestResearchHandler.execute(
      { question: 'rating?' },
      ctx(stub({ ok: false, reason: 'timeout', detail: '240s', partial: true, findings }))
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(
      'Research timed out after 240 s. Unverified partial findings from the tool calls that did ' +
      `succeed — treat as leads, not evidence:\n${findings}`
    );
  });

  it('maps unverified', async () => {
    const res = await requestResearchHandler.execute(
      { question: 'rating?' },
      ctx(stub({ ok: false, reason: 'unverified', detail: 'no answer' }))
    );
    expect(res).toEqual({ success: true, result: 'No verifiable source found. Report the gap.' });
  });

  it('maps error with its detail', async () => {
    const res = await requestResearchHandler.execute(
      { question: 'rating?' },
      ctx(stub({ ok: false, reason: 'error', detail: 'API 401' }))
    );
    expect(res).toEqual({ success: true, result: 'Research failed (API 401). Report the gap.' });
  });

  it('never throws when the capability throws', async () => {
    const res = await requestResearchHandler.execute(
      { question: 'rating?' },
      ctx(async () => {
        throw new Error('boom');
      })
    );
    expect(res).toEqual({ success: true, result: 'Research failed (boom). Report the gap.' });
  });
});
