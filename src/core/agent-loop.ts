/**
 * Generic budgeted tool loop: model ↔ tool registry for `maxTurns` turns, plus
 * a budget-exhaustion rescue that makes one final no-tools call so a document
 * (or JSON reply) is never lost.
 *
 * Inputs: AgentLoopOptions (client, model, prompts, registry, allow-list,
 * context). Output: AgentLoopResult (finalResponse, messages, turn and
 * tool-call counts, aborted flag). Throws only a non-abort client/tool error;
 * an ESC abort returns `aborted: true` instead.
 */
import { ChatClient, ChatMessage } from '../openrouter/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { ToolExecutionContext } from '../tools/types.js';
import { Logger } from '../util/logger.js';

export interface AgentLoopOptions {
  client: ChatClient;
  model: string;
  systemPrompt: string;
  userMessage: string;
  toolRegistry: ToolRegistry;
  allowedTools: string[];
  context: ToolExecutionContext;
  maxTurns?: number;
  priorMessages?: ChatMessage[];
  onToolCall?: (tool: string, args: any) => void;
  signal?: AbortSignal;
  /** Optional file-backed logger; core-safe (no UI deps). */
  logger?: Logger;
  /** Doc id used in budget-exhaustion log lines (e.g. 'bom'). */
  docId?: string;
  /**
   * True when the loop's final reply is a JSON OBJECT (research gate) rather
   * than a document. The budget-exhaustion rescue then accepts a reply that
   * carries a JSON object, and a rescue reply without one is retried ONCE with
   * an explicit JSON-only instruction before it is discarded.
   */
  jsonFinalReply?: boolean;
}

export interface AgentLoopResult {
  finalResponse: string;
  messages: ChatMessage[];
  aborted?: boolean;
  /** Number of tool calls the model issued during this loop. */
  toolCallCount?: number;
  /** Number of model turns the main loop ran before ending. */
  turnsUsed?: number;
}

export async function runAgentToolLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    client,
    model,
    systemPrompt,
    userMessage,
    toolRegistry,
    allowedTools,
    context,
    maxTurns = 8,
    priorMessages = [],
    signal
  } = options;
  const toolDefs = toolRegistry.getDefinitions(allowedTools);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...priorMessages.filter(m => m.role !== 'system'),
    { role: 'user', content: userMessage }
  ];

  let turn = 0;
  let finalResponse = '';
  let toolCallCount = 0;
  // True when the most recent model response issued tool calls (i.e. the loop
  // has not yet seen a plain-text reply). Reset to false on a normal break.
  let endedWithToolCalls = false;

  while (turn < maxTurns) {
    turn++;
    // Pre-flight: if the user aborted (ESC), stop immediately without calling the model.
    if (signal?.aborted) {
      return { finalResponse: '', messages, aborted: true };
    }
    let response;
    try {
      response = await client.chatCompletion({
        model,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        signal
      });
    } catch (err: any) {
      // AbortError = user pressed ESC; stop the turn gracefully.
      if (err?.name === 'AbortError' || signal?.aborted) {
        return { finalResponse: '', messages, aborted: true };
      }
      throw err;
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      endedWithToolCalls = true;
      toolCallCount += response.toolCalls.length;
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls
      });

      for (const call of response.toolCalls) {
        let parsedArgs: any = {};
        try {
          parsedArgs = JSON.parse(call.function.arguments);
        } catch (_e) {
          parsedArgs = {};
        }

        if (options.onToolCall) {
          options.onToolCall(call.function.name, parsedArgs);
        }

        const toolRes = await toolRegistry.execute(call.function.name, parsedArgs, context, allowedTools);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: toolRes.success ? (toolRes.result || 'Success') : `Error: ${toolRes.error}`
        });
      }
    } else {
      endedWithToolCalls = false;
      finalResponse = response.content || '';
      messages.push({ role: 'assistant', content: finalResponse });
      break;
    }
  }

  // Budget-exhaustion rescue: the loop ended because the turn budget ran out
  // while the model was still tool-calling, so finalResponse is empty. Make a
  // final model call with tools disabled so the model must deliver its reply as
  // plain text. Normal loop endings (a plain-text reply) are untouched.
  if (finalResponse === '' && endedWithToolCalls) {
    const rescueInstruction =
      'Stop using tools. Write the complete document now as your final reply with a # heading. Do not call any tools.';
    options.logger?.warn(
      `Agent loop budget exhausted for ${options.docId ?? 'unknown-doc'}: ` +
      `${turn}/${maxTurns} turns, ${toolCallCount} tool calls. Forcing a final no-tools write.`
    );
    // One rescue request; tools intentionally omitted so none can execute.
    const sendRescue = async (instruction: string): Promise<string> => {
      messages.push({ role: 'user', content: instruction });
      const rescue = await client.chatCompletion({ model, messages, signal });
      const text = rescue.content || '';
      messages.push({ role: 'assistant', content: text });
      return text;
    };
    try {
      let rescueText = await sendRescue(rescueInstruction);
      if (options.jsonFinalReply && !/\{[\s\S]*\}/.test(rescueText)) {
        // A heading-shaped rescue is the wrong reply for a JSON loop: retry
        // ONCE with an explicit JSON-only instruction before giving up.
        rescueText = await sendRescue('Return ONLY the JSON object; no tool calls, no prose, no heading');
      }
      const accepted = options.jsonFinalReply ? /\{[\s\S]*\}/.test(rescueText) : /^#\s/m.test(rescueText);
      if (accepted) {
        finalResponse = rescueText;
      } else {
        options.logger?.warn(
          `Forced final write for ${options.docId ?? 'unknown-doc'} produced no ` +
          `${options.jsonFinalReply ? 'JSON object' : '# heading'}; keeping empty finalResponse.`
        );
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        return { finalResponse: '', messages, aborted: true, toolCallCount, turnsUsed: turn };
      }
      throw err;
    }
  }

  return {
    finalResponse,
    messages,
    toolCallCount,
    turnsUsed: turn
  };
}
