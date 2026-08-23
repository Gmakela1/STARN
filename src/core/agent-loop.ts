import { OpenRouterClient } from '../openrouter/client.js';
import { ChatMessage } from '../openrouter/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { ToolExecutionContext } from '../tools/types.js';

export interface AgentLoopOptions {
  client: OpenRouterClient;
  model: string;
  systemPrompt: string;
  userMessage: string;
  toolRegistry: ToolRegistry;
  allowedTools: string[];
  context: ToolExecutionContext;
  maxTurns?: number;
  priorMessages?: ChatMessage[];
  onToolCall?: (tool: string, args: any) => void;
}

export interface AgentLoopResult {
  finalResponse: string;
  messages: ChatMessage[];
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
    priorMessages = []
  } = options;
  const toolDefs = toolRegistry.getDefinitions(allowedTools);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...priorMessages.filter(m => m.role !== 'system'),
    { role: 'user', content: userMessage }
  ];

  let turn = 0;
  let finalResponse = '';

  while (turn < maxTurns) {
    turn++;
    const response = await client.chatCompletion({
      model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined
    });

    if (response.toolCalls && response.toolCalls.length > 0) {
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
      finalResponse = response.content || '';
      messages.push({ role: 'assistant', content: finalResponse });
      break;
    }
  }

  return {
    finalResponse,
    messages
  };
}
