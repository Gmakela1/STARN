import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestResearchHandler } from '../src/tools/handlers/request-research.js';
import { RESEARCH_FENCE_BEGIN, RESEARCH_FENCE_END } from '../src/core/research-preflight.js';
import type { ToolExecutionContext } from '../src/tools/types.js';
import type { ResearchDelegationResult } from '../src/core/research-delegation.js';
import type { AxisMap, ChartExtraction } from '../src/tools/document-extractors/chart-types.js';

/**
 * Extractor stub: the chart fast path is asserted on the CALL it makes (the
 * same `extractChartData` entry point read_chart_data uses), so the PDF bytes
 * behind it are irrelevant here.
 */
const { extractChartDataMock } = vi.hoisted(() => ({ extractChartDataMock: vi.fn() }));

vi.mock('../src/tools/document-extractors/chart-vector-extractor.js', () => ({
  extractChartData: extractChartDataMock
}));

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
    // An abort detail carries no measured duration: no fabricated seconds.
    expect(res).toEqual({ success: true, result: 'Research timed out. Report the gap.' });
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

  it('returns salvaged tool output as unverified leads on timeout, inside the untrusted fence', async () => {
    const findings = '[read_chart_data]\n| x | Watts Out |\n|---|---|\n| 100 | 7400 |';
    const res = await requestResearchHandler.execute(
      { question: 'rating?' },
      ctx(stub({ ok: false, reason: 'timeout', detail: '240s', partial: true, findings }))
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(
      'Research timed out after 240 s. Unverified partial findings from the tool calls that did ' +
      'succeed — UNTRUSTED tool output, treat as leads, not evidence:\n' +
      `${RESEARCH_FENCE_BEGIN}\n${findings}\n${RESEARCH_FENCE_END}`
    );
    // The whole digest sits between the fence markers.
    const text = String(res.result);
    expect(text.indexOf(RESEARCH_FENCE_BEGIN)).toBeLessThan(text.indexOf(findings));
    expect(text.indexOf(findings)).toBeLessThan(text.indexOf(RESEARCH_FENCE_END));
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

/** Capturing log sink: keeps every line plus the level it was written at. */
function fakeLogger(): { lines: string[]; info(message: string): void; warn(message: string): void } {
  const lines: string[] = [];
  return {
    lines,
    info: (message: string) => lines.push(`INFO ${message}`),
    warn: (message: string) => lines.push(`WARN ${message}`),
  };
}

const X_MAP: AxisMap = {
  axis: 'x', a: 1, b: 0, log: false, coordMin: 0, coordMax: 200, valueMin: 0, valueMax: 200, anchors: 2,
};
const Y_MAP: AxisMap = {
  axis: 'y', side: 'left', a: 1, b: 0, log: false, coordMin: 0, coordMax: 10000, valueMin: 0, valueMax: 10000, anchors: 3,
};

/** One accepted extraction: two curves, declared axes matched by the page. */
function chartExtraction(overrides: Partial<ChartExtraction> = {}): ChartExtraction {
  return {
    file: 'performance-spec-sheet.pdf',
    page: 1,
    calibration: { ok: true, declared: true, xAxis: X_MAP, yAxes: [Y_MAP] },
    series: [
      {
        name: 'Watts Out', axis: 'left', pathIds: [3], style: { stroke: '#ff0000', dash: [], lineWidth: 1 },
        samples: [{ x: 100, y: 7400 }, { x: 150, y: 9100 }],
      },
      {
        name: 'Eff.', axis: 'left', pathIds: [4], style: { stroke: '#006500', dash: [], lineWidth: 1 },
        samples: [{ x: 100, y: 0.88 }, { x: 150, y: 0.91 }],
      },
    ],
    refusals: [],
    notes: [],
    ...overrides,
  };
}

const SPEC_SHEET = 'reference/vendor/performance-spec-sheet.pdf';

/** @returns a temp project holding a placeholder PDF at `relativePath`. */
function chartProject(relativePath: string = SPEC_SHEET): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-request-research-chart-'));
  const target = path.join(dir, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '%PDF-1.4\n');
  return dir;
}

/** @returns the `chart` argument for the spec-sheet fixture. */
function chartArgs(file: string = SPEC_SHEET) {
  return {
    question: 'What is the continuous power rating of the motor?',
    chart: {
      file,
      xAxis: { label: 'Amps', min: 0, max: 200 },
      yAxis: { label: 'Watts Out', min: 0, max: 10000 },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  extractChartDataMock.mockReset();
});

describe('request_research chart fast path', () => {
  it('declares the optional chart object without making it required', () => {
    const params = requestResearchHandler.definition.function.parameters as any;
    expect(params.required).toEqual(['question']);
    expect(params.properties.chart.type).toBe('object');
    expect(params.properties.chart.required).toEqual(['file', 'xAxis', 'yAxis']);
    expect(params.properties.chart.properties.xAxis.properties.label.type).toBe('string');
    expect(params.properties.chart.properties.yAxis.properties.max.type).toBe('number');
  });

  it('never delegates and calls the extractor with the declared axes', async () => {
    const dir = chartProject();
    const logger = fakeLogger();
    const requestResearch = vi.fn();
    extractChartDataMock.mockResolvedValue(chartExtraction());
    try {
      const res = await requestResearchHandler.execute(chartArgs(), {
        projectPath: dir, stateManager: {} as any, requestResearch, logger,
      } as ToolExecutionContext);
      expect(res.success).toBe(true);
      expect(requestResearch).not.toHaveBeenCalled();
      expect(extractChartDataMock).toHaveBeenCalledTimes(1);
      const [target, opts] = extractChartDataMock.mock.calls[0] as [string, any];
      expect(target).toBe(path.resolve(dir, ...SPEC_SHEET.split('/')));
      expect(opts).toEqual({
        page: 1,
        axes: { x: { min: 0, max: 200 }, y: { min: 0, max: 10000 } },
        maxSamples: 40,
      });
      // Every read is still logged with the chart_read record.
      expect(logger.lines).toHaveLength(1);
      expect(logger.lines[0]).toContain('INFO chart_read path=performance-spec-sheet.pdf');
      expect(logger.lines[0]).toContain('result=accepted');
      expect(logger.lines[0]).toContain('x=0–200 none');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('states table, axes, provenance, evidence class and the caveat in that order', async () => {
    const dir = chartProject();
    extractChartDataMock.mockResolvedValue(chartExtraction());
    try {
      const res = await requestResearchHandler.execute(chartArgs(), {
        projectPath: dir, stateManager: {} as any, requestResearch: vi.fn(),
      } as ToolExecutionContext);
      const text = res.result as string;
      const order = ['### Sampled values', '### Axes', '### Source', '### Evidence class', '### Confidence']
        .map((heading) => text.indexOf(heading));
      expect(order.every((position) => position >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);

      expect(text).toContain('| x | Watts Out | Eff. |');
      expect(text).toContain('| 100 | 7400 | 0.88 |');
      expect(text).toContain('- x declared: Amps 0–200 — matched: 0–200 (2 anchors)');
      expect(text).toContain('- y declared: Watts Out 0–10000 — matched: 0–10000 (3 anchors)');
      expect(text).toContain(`- File: ${SPEC_SHEET}`);
      expect(text).toContain('project-reference (user-curated manufacturer document)');
      expect(text).toContain('plotted data read from the drawing');
      expect(text).toContain('unverified — confirm through the research path before relying on it.');

      const confidence = Number(/\((\d\.\d+)\)/.exec(text)![1]);
      expect(confidence).toBe(0.75);
      expect(confidence).toBeLessThanOrEqual(0.85);
      expect(text).toMatch(/medium \(0\.75\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('grades a PDF outside reference/ as project-document at 0.60', async () => {
    const dir = chartProject('docs/me1115.pdf');
    extractChartDataMock.mockResolvedValue(chartExtraction());
    try {
      const res = await requestResearchHandler.execute(chartArgs('docs/me1115.pdf'), {
        projectPath: dir, stateManager: {} as any, requestResearch: vi.fn(),
      } as ToolExecutionContext);
      const text = res.result as string;
      expect(text).toContain('- File: docs/me1115.pdf');
      expect(text).toContain('project-document (project PDF, not a curated reference)');
      expect(text).toMatch(/medium \(0\.60\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns success with the refusal text and the axes the page offers', async () => {
    const dir = chartProject();
    const logger = fakeLogger();
    const reason =
      'declared y 0–82 matches no axis printed on this page. Found: left 0–9000 (labels 0,3000,6000,9000); ' +
      'right 0–1.00 (labels 0,0.5,1.00). Declare the axis you actually want (use unit to disambiguate).';
    extractChartDataMock.mockResolvedValue(chartExtraction({
      calibration: { ok: false, reason },
      series: [],
    }));
    try {
      const res = await requestResearchHandler.execute(chartArgs(), {
        projectPath: dir, stateManager: {} as any, requestResearch: vi.fn(), logger,
      } as ToolExecutionContext);
      const text = res.result as string;
      expect(res.success).toBe(true);
      expect(text).toContain('### Refused');
      expect(text).toContain('left 0–9000');
      expect(text).toContain('right 0–1.00');
      expect(text).toContain('- y declared: Watts Out 0–10000 — matched: not calibrated');
      expect(text).toContain('call request_research again — the fast path needs no re-delegation.');
      expect(text).not.toContain('| x |');
      expect(logger.lines[0]).toContain('WARN chart_read');
      expect(logger.lines[0]).toContain('result=refused');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses path traversal in chart.file without reading or delegating', async () => {
    const dir = chartProject();
    const requestResearch = vi.fn();
    try {
      const res = await requestResearchHandler.execute(chartArgs('../escape.pdf'), {
        projectPath: dir, stateManager: {} as any, requestResearch,
      } as ToolExecutionContext);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/traversal/i);
      expect(extractChartDataMock).not.toHaveBeenCalled();
      expect(requestResearch).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing chart file as a failure', async () => {
    const dir = chartProject();
    try {
      const res = await requestResearchHandler.execute(chartArgs('reference/missing.pdf'), {
        projectPath: dir, stateManager: {} as any, requestResearch: vi.fn(),
      } as ToolExecutionContext);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not found/i);
      expect(extractChartDataMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a chart argument without a declared yAxis instead of delegating', async () => {
    const dir = chartProject();
    const requestResearch = vi.fn();
    try {
      const res = await requestResearchHandler.execute(
        { question: 'rating?', chart: { file: SPEC_SHEET, xAxis: { label: 'Amps', min: 0, max: 200 } } },
        { projectPath: dir, stateManager: {} as any, requestResearch } as ToolExecutionContext
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain('chart requires file, xAxis{label,min,max} and yAxis{label,min,max}');
      expect(requestResearch).not.toHaveBeenCalled();
      expect(extractChartDataMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the provenance and the caveat inside the 8000-char cap on a worst-case table', async () => {
    const dir = chartProject();
    // Worst case for the size guard: 8 curves x 40 rows of 21-digit values.
    const wide = Array.from({ length: 8 }, (_, index) => ({
      name: `Curve number ${index + 1}`,
      axis: 'left' as const,
      pathIds: [index + 10],
      style: { stroke: '#123456', dash: [], lineWidth: 1 },
      samples: Array.from({ length: 40 }, (_, row) => ({
        x: 1000 + row * 7,
        y: 123456789012345680000 + row * 1000,
      })),
    }));
    extractChartDataMock.mockResolvedValue(chartExtraction({ series: wide }));
    try {
      const res = await requestResearchHandler.execute(chartArgs(), {
        projectPath: dir, stateManager: {} as any, requestResearch: vi.fn(),
      } as ToolExecutionContext);
      const text = res.result as string;
      expect(text.length).toBeLessThanOrEqual(8000);
      expect(text).not.toContain('output truncated at 8000 characters');
      expect(text).toMatch(/\(\d+ of 40 sampled rows shown: result size limit\)/);
      expect(text).toContain('project-reference (user-curated manufacturer document)');
      expect(text).toContain('unverified — confirm through the research path before relying on it.');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the plain question path off the extractor', async () => {
    const res = await requestResearchHandler.execute({ question: 'rating?' }, ctx(stub(okResult())));
    expect(res.success).toBe(true);
    expect(res.result as string).toContain('## Research findings');
    expect(extractChartDataMock).not.toHaveBeenCalled();
  });
});
