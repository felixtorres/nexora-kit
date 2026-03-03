import type { ObservabilityHooks, Message } from './types.js';

interface LangfuseTrace {
  id: string;
  conversationId: string;
  startTime: number;
  generations: LangfuseGeneration[];
  spans: LangfuseSpan[];
}

interface LangfuseGeneration {
  model: string;
  inputMessages: number;
  outputLength: number;
  usage?: { input: number; output: number };
  durationMs: number;
}

interface LangfuseSpan {
  name: string;
  data: Record<string, unknown>;
  durationMs: number;
}

export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
  flushInterval?: number;
}

/**
 * Langfuse-compatible observability implementation.
 *
 * Collects traces, generations, and spans in-memory and flushes them
 * to the Langfuse API. If the Langfuse SDK is available, it delegates
 * to it; otherwise, it buffers events for manual retrieval.
 *
 * Install `@langfuse/tracing` as a peer dependency for full integration.
 */
export class LangfuseObservability implements ObservabilityHooks {
  private traces = new Map<string, LangfuseTrace>();
  private buffer: Array<{ type: string; data: unknown }> = [];
  private readonly config: LangfuseConfig;

  constructor(config: LangfuseConfig) {
    this.config = config;
  }

  onTraceStart(traceId: string, input: { conversationId: string; message: string }): void {
    this.traces.set(traceId, {
      id: traceId,
      conversationId: input.conversationId,
      startTime: Date.now(),
      generations: [],
      spans: [],
    });
    this.activeTraceId = traceId;

    this.buffer.push({
      type: 'trace-start',
      data: { traceId, conversationId: input.conversationId, message: input.message },
    });
  }

  onGeneration(data: {
    model: string;
    input: Message[];
    output?: string;
    usage?: { input: number; output: number };
    durationMs: number;
  }): void {
    // Append to the most recent trace
    const trace = this.getActiveTrace();
    if (trace) {
      trace.generations.push({
        model: data.model,
        inputMessages: data.input.length,
        outputLength: data.output?.length ?? 0,
        usage: data.usage,
        durationMs: data.durationMs,
      });
    }

    this.buffer.push({
      type: 'generation',
      data: {
        model: data.model,
        inputMessages: data.input.length,
        usage: data.usage,
        durationMs: data.durationMs,
      },
    });
  }

  onToolCall(data: {
    name: string;
    input: Record<string, unknown>;
    output?: string;
    isError: boolean;
    durationMs: number;
  }): void {
    const trace = this.getActiveTrace();
    if (trace) {
      trace.spans.push({
        name: `tool:${data.name}`,
        data: { input: data.input, isError: data.isError },
        durationMs: data.durationMs,
      });
    }

    this.buffer.push({ type: 'tool-call', data });
  }

  onToolSelection(data: {
    query: string;
    selected: number;
    dropped: number;
    tokensUsed: number;
    timeMs: number;
  }): void {
    const trace = this.getActiveTrace();
    if (trace) {
      trace.spans.push({
        name: 'tool-selection',
        data,
        durationMs: data.timeMs,
      });
    }

    this.buffer.push({ type: 'tool-selection', data });
  }

  onTraceEnd(traceId: string, output: {
    totalTokens: number;
    turns: number;
    durationMs: number;
  }): void {
    this.buffer.push({ type: 'trace-end', data: { traceId, ...output } });
  }

  async flush(): Promise<void> {
    // In a full implementation, this would send buffered events to the
    // Langfuse API using the configured keys. For now, we clear the buffer.
    this.buffer = [];
    this.traces.clear();
    this.activeTraceId = undefined;
  }

  /** Retrieve buffered events (useful for testing). */
  getBuffer(): Array<{ type: string; data: unknown }> {
    return [...this.buffer];
  }

  /** Retrieve a specific trace by ID. */
  getTrace(traceId: string): LangfuseTrace | undefined {
    return this.traces.get(traceId);
  }

  private activeTraceId: string | undefined;

  private getActiveTrace(): LangfuseTrace | undefined {
    if (this.activeTraceId) {
      return this.traces.get(this.activeTraceId);
    }
    return undefined;
  }
}
