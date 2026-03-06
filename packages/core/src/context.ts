import type { Context, Conversation, Message, MessageContent, ToolDefinition } from './types.js';
import { DEFAULT_SYSTEM_PROMPT } from './default-prompt.js';

export interface ContextManagerOptions {
  defaultSystemPrompt?: string;
  maxContextTokens?: number;
}

export class ContextManager {
  private readonly defaultSystemPrompt: string;
  private readonly maxContextTokens: number;

  constructor(options: ContextManagerOptions = {}) {
    this.defaultSystemPrompt = options.defaultSystemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxContextTokens = options.maxContextTokens ?? 100_000;
  }

  assemble(conversation: Conversation, tools: ToolDefinition[], systemPrompt?: string): Context {
    return {
      systemPrompt: systemPrompt ?? this.defaultSystemPrompt,
      messages: [...conversation.messages],
      tools,
      metadata: { ...conversation.metadata },
    };
  }

  append(conversation: Conversation, message: Message): void {
    conversation.messages.push(message);
    conversation.updatedAt = new Date();
  }

  truncate(conversation: Conversation, maxTokens?: number): void {
    const limit = maxTokens ?? this.maxContextTokens;

    const estimateChars = (msgs: Message[]): number =>
      msgs.reduce(
        (sum, m) =>
          sum +
          (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length),
        0,
      );

    const totalChars = estimateChars(conversation.messages);
    const estimatedTokens = Math.ceil(totalChars / 4);
    if (estimatedTokens <= limit) return;

    // Separate system messages (never dropped) from the rest
    const systemMessages = conversation.messages.filter((m) => m.role === 'system');
    const nonSystem = conversation.messages.filter((m) => m.role !== 'system');

    // Build atomic groups that must be kept or dropped together.
    // An assistant message with tool_calls + all subsequent tool result messages
    // form one group. A lone user or assistant (text-only) message is its own group.
    const groups = buildAtomicGroups(nonSystem);

    // Drop oldest groups until we're under the token limit (keep at least one group)
    while (groups.length > 1) {
      const remaining = groups.flatMap((g) => g);
      if (Math.ceil(estimateChars(remaining) / 4) <= limit) break;
      groups.shift();
    }

    conversation.messages = [...systemMessages, ...groups.flatMap((g) => g)];
  }
}

/**
 * Group messages into atomic units that must stay together when truncating.
 *
 * An "assistant with tool_calls" message and all the immediately-following
 * "tool" messages that respond to those calls form one atomic group — dropping
 * only the assistant message would leave orphaned tool results, which the
 * OpenAI API rejects with a 400.
 *
 * Layout example:
 *   [user]                    → group 0: [user]
 *   [assistant tool_calls]    → group 1 start
 *   [tool result]             →   (part of group 1)
 *   [tool result]             →   (part of group 1)
 *   [assistant text]          → group 2: [assistant]
 *   [user]                    → group 3: [user]
 */
export function buildAtomicGroups(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'assistant' && hasToolCalls(msg)) {
      // Start a new group: assistant + all immediately-following tool results
      const group: Message[] = [msg];
      i++;
      while (i < messages.length && messages[i].role === 'tool') {
        group.push(messages[i]);
        i++;
      }
      groups.push(group);
    } else {
      groups.push([msg]);
      i++;
    }
  }

  return groups;
}

function hasToolCalls(msg: Message): boolean {
  if (!Array.isArray(msg.content)) return false;
  return (msg.content as MessageContent[]).some((c) => c.type === 'tool_use');
}
