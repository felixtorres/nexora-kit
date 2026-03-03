import type { ObservabilityHooks, Message } from './types.js';

export class NoopObservability implements ObservabilityHooks {
  onTraceStart(_traceId: string, _input: { conversationId: string; message: string }): void {}

  onGeneration(_data: {
    model: string;
    input: Message[];
    output?: string;
    usage?: { input: number; output: number };
    durationMs: number;
  }): void {}

  onToolCall(_data: {
    name: string;
    input: Record<string, unknown>;
    output?: string;
    isError: boolean;
    durationMs: number;
  }): void {}

  onToolSelection(_data: {
    query: string;
    selected: number;
    dropped: number;
    tokensUsed: number;
    timeMs: number;
  }): void {}

  onTraceEnd(_traceId: string, _output: {
    totalTokens: number;
    turns: number;
    durationMs: number;
  }): void {}

  async flush(): Promise<void> {}
}
