import type { LlmEvent, LlmRequest, ModelInfo } from './types.js';

export interface LlmProvider {
  readonly name: string;
  readonly models: ModelInfo[];
  chat(request: LlmRequest): AsyncIterable<LlmEvent>;
  countTokens(messages: LlmRequest['messages']): Promise<number>;
}
