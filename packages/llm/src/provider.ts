import type { LlmEvent, LlmRequest, ModelInfo } from './types.js';
import type { Tokenizer } from './tokenizer.js';

export interface LlmProvider {
  readonly name: string;
  readonly models: ModelInfo[];
  chat(request: LlmRequest): AsyncIterable<LlmEvent>;
  countTokens(messages: LlmRequest['messages']): Promise<number>;
  /** Optional tokenizer for accurate token counting. When absent, char/4 heuristic is used. */
  readonly tokenizer?: Tokenizer;
}
