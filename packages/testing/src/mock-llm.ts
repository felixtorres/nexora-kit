import type { LlmProvider, LlmEvent, LlmRequest, ModelInfo } from '@nexora-kit/llm';

export interface MockLlmOptions {
  /** Pre-defined response sequences — one array per LLM call */
  responses?: LlmEvent[][];
  /** Called on each chat() invocation with the request */
  onChat?: (request: LlmRequest, callIndex: number) => void;
  /** Token count to return from countTokens() */
  tokenCount?: number;
}

/**
 * Creates a mock LLM provider for testing.
 * Each call to chat() returns the next response sequence from `responses`.
 */
export function createMockLlm(options: MockLlmOptions | LlmEvent[][] = []): LlmProvider {
  const opts: MockLlmOptions = Array.isArray(options) ? { responses: options } : options;
  const responses = opts.responses ?? [];
  let callIndex = 0;

  const model: ModelInfo = {
    id: 'mock-1',
    name: 'Mock',
    provider: 'mock',
    contextWindow: 100_000,
    maxOutputTokens: 4_096,
  };

  return {
    name: 'mock',
    models: [model],

    async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
      const idx = callIndex++;
      opts.onChat?.(request, idx);

      const events = responses[idx] ?? [
        { type: 'text' as const, content: 'no more responses configured' },
        { type: 'done' as const },
      ];

      for (const event of events) {
        yield event;
      }
    },

    async countTokens() {
      return opts.tokenCount ?? 100;
    },
  };
}
