import type { LlmMessage, LlmToolDefinition } from './types.js';

/**
 * Interface for counting tokens in text, messages, and tool definitions.
 * Provider implementations can supply accurate token counts; when absent,
 * the HeuristicTokenizer (char/4) is used as a fallback.
 */
export interface Tokenizer {
  countTokens(text: string): number;
  countMessageTokens(messages: LlmMessage[]): number;
  countToolTokens(tools: LlmToolDefinition[]): number;
}

const CHARS_PER_TOKEN = 4;

/**
 * Fallback tokenizer using a char/4 heuristic.
 * Used when a provider does not supply a real tokenizer.
 */
export class HeuristicTokenizer implements Tokenizer {
  countTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  countMessageTokens(messages: LlmMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      // ~4 tokens overhead per message (role, delimiters)
      total += 4;
      if (typeof msg.content === 'string') {
        total += this.countTokens(msg.content);
      } else {
        total += this.countTokens(JSON.stringify(msg.content));
      }
    }
    return total;
  }

  countToolTokens(tools: LlmToolDefinition[]): number {
    let total = 0;
    for (const tool of tools) {
      total += this.countTokens(JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    }
    return total;
  }
}
