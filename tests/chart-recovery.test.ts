/**
 * chart-recovery.test.ts — proves the refusal→retry path of `read_chart_data`
 * end to end: a refused axis declaration, the corrected declaration the
 * researcher sends next, and the answer built from the corrected samples.
 *
 * Inputs: the user's real project folder (the test skips cleanly when it is
 * absent, so CI stays green). Outputs: assertions on the two tool results, the
 * final answer and the number of chart calls the loop actually made.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAgentToolLoop } from '../src/core/agent-loop.js';
import { RESEARCH_GATE_ALLOWED_TOOLS } from '../src/core/research-gate.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type {
  ChatClient,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatMessage,
  ToolCall
} from '../src/openrouter/types.js';

/** Root of the user's live project; the reference PDF lives under it. */
const PROJECT_PATH = 'C:/Users/makel/OneDrive/Desktop/starn test';
const PDF_RELATIVE = 'reference/ME1115-performance sheet.pdf';
const PDF_ABSOLUTE = path.join(PROJECT_PATH, PDF_RELATIVE);
/** True only when the user's project folder is present on this machine. */
const pdfAvailable = fs.existsSync(PDF_ABSOLUTE);
/** Shaft power the corrected axes yield at 110 A (curve-derived, ±1 % of span). */
const EXPECTED_WATTS_AT_110_A = 5208;
/** The figure the WRONG 0–100 A declaration produces; the answer must not cite it. */
const WRONG_WATTS = '6783';

/** @returns A one-tool-call model turn for `read_chart_data`. */
function chartTurn(id: string, args: Record<string, unknown>): ChatCompletionResult {
  const call: ToolCall = {
    id,
    type: 'function',
    function: { name: 'read_chart_data', arguments: JSON.stringify(args) }
  };
  return { content: null, toolCalls: [call], raw: {} };
}

/**
 * Scripted research model: wrong axes, then the corrected axes, then the JSON
 * answer. Records every message list it receives so the test can count the
 * chart calls the loop really issued.
 */
class ScriptedResearchClient implements ChatClient {
  readonly received: ChatMessage[][] = [];

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    this.received.push(options.messages.map((message) => ({ ...message })));
    switch (this.received.length) {
      case 1:
        return chartTurn('call-1', {
          path: PDF_RELATIVE,
          page: 1,
          axes: { x: { min: 0, max: 100 }, y: { min: 0, max: 10000 } }
        });
      case 2:
        return chartTurn('call-2', {
          path: PDF_RELATIVE,
          page: 1,
          series: ['Watts Out'],
          axes: { x: { min: 0, max: 200, unit: 'Amps' }, y: { min: 0, max: 10000, unit: 'Watts Out' } }
        });
      default:
        return {
          content: JSON.stringify({
            answer: `The ME1115 delivers about ${EXPECTED_WATTS_AT_110_A} W of shaft power at 110 A.`,
            sources: [{ title: 'ME1115 performance sheet' }],
            reasoning: 'Read from the plotted Watts Out curve against the 0-200 A / 0-10000 W axes.'
          }),
          raw: {}
        };
    }
  }
}

/** @returns The `read_chart_data` calls present in the loop's latest transcript. */
function chartCalls(messages: ChatMessage[]): ToolCall[] {
  return messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.tool_calls ?? [])
    .filter((call) => call.function.name === 'read_chart_data');
}

/** @returns Tool-result texts in transcript order. */
function toolResults(messages: ChatMessage[]): string[] {
  return messages
    .filter((message) => message.role === 'tool')
    .map((message) => (typeof message.content === 'string' ? message.content : ''));
}

/** @returns The tabulated value whose x is nearest `target`, or null when no sample table exists. */
function valueNearest(markdown: string, target: number): number | null {
  const lines = markdown.split('\n');
  const header = lines.findIndex((line) => line.startsWith('| x |'));
  if (header < 0) return null;
  let best: { distance: number; value: number } | null = null;
  for (let i = header + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = lines[i].split('|').map((cell) => cell.trim()).filter(Boolean);
    const x = Number(cells[0]);
    const y = Number(cells[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const distance = Math.abs(x - target);
    if (!best || distance < best.distance) best = { distance, value: y };
  }
  return best ? best.value : null;
}

describe('read_chart_data refusal → retry recovery', () => {
  it.skipIf(!pdfAvailable)(
    'retries a refused axis declaration and answers from the corrected axes',
    async () => {
      const client = new ScriptedResearchClient();
      const result = await runAgentToolLoop({
        client,
        model: 'scripted-research-model',
        systemPrompt: 'Research the question. Use read_chart_data for plotted curves. Reply with a JSON object.',
        userMessage: 'QUESTION: What shaft power does the ME1115 deliver at 110 A?',
        toolRegistry: new ToolRegistry(),
        allowedTools: [...RESEARCH_GATE_ALLOWED_TOOLS],
        context: { projectPath: PROJECT_PATH, stateManager: {} as never },
        maxTurns: 5,
        jsonFinalReply: true
      });

      const results = toolResults(result.messages);
      expect(results).toHaveLength(2);

      // Call 1: the 0–100 A declaration is refused, naming the axes the page prints.
      expect(results[0]).toContain('matches no axis printed on this page');
      expect(results[0]).toContain('Amps 0–200');

      // Call 2: the corrected declaration yields the Watts Out samples.
      expect(results[1]).toContain('Watts Out');
      const wattsAt110 = valueNearest(results[1], 110);
      expect(wattsAt110).not.toBeNull();
      // Tolerance is the tool's own accuracy claim: ±1 % of the 0–10000 W span.
      expect(Math.abs(wattsAt110! - EXPECTED_WATTS_AT_110_A)).toBeLessThan(100);

      // The answer cites the corrected value and never the wrong figure.
      expect(result.finalResponse).toContain(String(EXPECTED_WATTS_AT_110_A));
      expect(result.finalResponse).not.toContain(WRONG_WATTS);

      // Exactly two chart calls: one refused, one accepted — no silent retry loop.
      expect(chartCalls(client.received[client.received.length - 1])).toHaveLength(2);
    },
    60_000
  );
});
