import { ChatMessage } from '../openrouter/types.js';
import { OpenRouterClient } from '../openrouter/client.js';
import { Logger } from '../util/logger.js';

const CHARS_PER_TOKEN = 4;
const TOOL_RESULT_TRUNCATE = 2000;

/**
 * Cheap token estimate (~4 chars/token). No external tokenizer dependency.
 */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (msg.content) chars += msg.content.length;
    if (msg.tool_calls) {
      for (const call of msg.tool_calls) {
        chars += call.function.name.length + call.function.arguments.length;
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Flattens messages to labeled text for summarization. Tool results are
 * truncated to TOOL_RESULT_TRUNCATE chars (pi's rule — tool results are the
 * biggest context hogs). System messages are excluded (preserved separately).
 */
export function serializeConversation(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'user') {
      lines.push(`[User]: ${msg.content || ''}`);
    } else if (msg.role === 'assistant') {
      if (msg.content) lines.push(`[Assistant]: ${msg.content}`);
      if (msg.tool_calls) {
        const calls = msg.tool_calls
          .map(c => `${c.function.name}(${c.function.arguments})`)
          .join('; ');
        lines.push(`[Assistant tool calls]: ${calls}`);
      }
    } else if (msg.role === 'tool') {
      const content = msg.content || '';
      const truncated = content.length > TOOL_RESULT_TRUNCATE
        ? content.slice(0, TOOL_RESULT_TRUNCATE) + `\n[...truncated ${content.length - TOOL_RESULT_TRUNCATE} chars]`
        : content;
      lines.push(`[Tool result]: ${truncated}`);
    }
  }
  return lines.join('\n');
}

const SUMMARY_PROMPT_PREFIX = `Summarize the following conversation history in this exact structured markdown format:

## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements mentioned by user]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data needed to continue]

Conversation history to summarize:
`;

/**
 * Calls the compaction model to produce a structured summary of the given
 * messages. Uses the configured compactionModel (independent of working model).
 */
export async function generateSummary(
  client: OpenRouterClient,
  model: string,
  messagesToSummarize: ChatMessage[]
): Promise<string> {
  const conversationText = serializeConversation(messagesToSummarize);
  const res = await client.chatCompletion({
    model,
    messages: [{ role: 'user', content: SUMMARY_PROMPT_PREFIX + conversationText }],
    temperature: 0.1
  });
  return res.content || '(summary unavailable)';
}

export interface MaybeCompactOptions {
  client: OpenRouterClient;
  messages: ChatMessage[];
  compactionModel: string;
  threshold: number;
  keepRecentTokens: number;
  logger?: Logger;
}

export interface MaybeCompactResult {
  messages: ChatMessage[];
  compacted: boolean;
  tokensBefore?: number;
  tokensAfter?: number;
}

/**
 * Checks context size; if over threshold, compacts by summarizing older
 * messages and keeping recent ones. Mirrors pi's compaction approach:
 * - Walk backwards accumulating tokens until keepRecentTokens reached.
 * - Cut at a safe boundary (never mid-tool-call; snap to user message).
 * - Summarize everything before the cut into one assistant message.
 * - Rebuilt context = [system] + [summary] + [kept recent messages].
 *
 * If under threshold, returns messages unchanged.
 */
export async function maybeCompact(options: MaybeCompactOptions): Promise<MaybeCompactResult> {
  const { client, messages, compactionModel, threshold, keepRecentTokens, logger } = options;
  const tokensBefore = estimateTokens(messages);
  if (tokensBefore <= threshold) {
    return { messages, compacted: false };
  }

  logger?.info(`Compacting session: ${tokensBefore} tokens > ${threshold} threshold`);

  // Walk backwards to find the cut point (keep recent messages)
  let keptTokens = 0;
  let cutIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens([messages[i]]);
    if (keptTokens + msgTokens > keepRecentTokens && i < messages.length - 1) {
      cutIndex = i + 1;
      break;
    }
    keptTokens += msgTokens;
    cutIndex = i;
  }

  // Snap cut to a safe boundary (user message); never cut mid-tool-call.
  while (cutIndex < messages.length && messages[cutIndex].role !== 'user' && cutIndex > 1) {
    cutIndex--;
  }

  // System messages are preserved separately (not summarized).
  const systemMessages = messages.filter(m => m.role === 'system');
  const messagesToSummarize = messages.slice(0, cutIndex).filter(m => m.role !== 'system');
  const keptMessages = messages.slice(cutIndex);

  if (messagesToSummarize.length === 0) {
    return { messages, compacted: false };
  }

  const summary = await generateSummary(client, compactionModel, messagesToSummarize);

  const compactedMessages: ChatMessage[] = [
    ...systemMessages,
    { role: 'assistant', content: `## Session Summary (compacted)\n${summary}` },
    ...keptMessages
  ];

  const tokensAfter = estimateTokens(compactedMessages);
  logger?.info(`Compaction complete: ${tokensBefore} -> ${tokensAfter} tokens`);

  return { messages: compactedMessages, compacted: true, tokensBefore, tokensAfter };
}
