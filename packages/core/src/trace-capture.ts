import type { ObservabilityHooks, Message } from './types.js';

/**
 * Execution trace data accumulated during a single agent run.
 * Used by the GEPA optimizer to analyze and improve prompts.
 */
export interface CapturedTrace {
  traceId: string;
  conversationId: string;
  model: string | null;
  prompt: string;
  toolCalls: { name: string; input: Record<string, unknown>; output?: string; isError: boolean }[];
  agentReasoning: string | null;
  finalAnswer: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export type TraceCallback = (trace: CapturedTrace) => void | Promise<void>;

/**
 * ObservabilityHooks implementation that captures execution traces
 * for the GEPA prompt optimizer. Wraps an optional inner hooks instance
 * (e.g., Langfuse) so both can run simultaneously.
 */
export class TraceCapture implements ObservabilityHooks {
  private readonly inner: ObservabilityHooks | null;
  private readonly onTrace: TraceCallback;

  // Per-trace state
  private currentTraceId: string | null = null;
  private currentConversationId: string | null = null;
  private currentModel: string | null = null;
  private currentPrompt: string = '';
  private toolCalls: CapturedTrace['toolCalls'] = [];
  private reasoning: string | null = null;
  private finalAnswer: string = '';
  private inputTokens: number = 0;
  private outputTokens: number = 0;
  private startTime: number = 0;

  constructor(onTrace: TraceCallback, inner?: ObservabilityHooks) {
    this.onTrace = onTrace;
    this.inner = inner ?? null;
  }

  onTraceStart(traceId: string, input: { conversationId: string; message: string; parentTraceId?: string }): void {
    this.currentTraceId = traceId;
    this.currentConversationId = input.conversationId;
    this.currentPrompt = input.message;
    this.toolCalls = [];
    this.reasoning = null;
    this.finalAnswer = '';
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.currentModel = null;
    this.startTime = Date.now();

    this.inner?.onTraceStart(traceId, input);
  }

  onGeneration(data: {
    model: string;
    input: Message[];
    output?: string;
    usage?: { input: number; output: number };
    durationMs: number;
  }): void {
    this.currentModel = data.model;
    if (data.usage) {
      this.inputTokens += data.usage.input;
      this.outputTokens += data.usage.output;
    }
    if (data.output) {
      this.finalAnswer = data.output;
    }

    this.inner?.onGeneration(data);
  }

  onToolCall(data: {
    name: string;
    input: Record<string, unknown>;
    output?: string;
    isError: boolean;
    durationMs: number;
  }): void {
    this.toolCalls.push({
      name: data.name,
      input: data.input,
      output: data.output,
      isError: data.isError,
    });

    this.inner?.onToolCall(data);
  }

  onToolSelection(data: {
    query: string;
    selected: number;
    dropped: number;
    tokensUsed: number;
    timeMs: number;
  }): void {
    this.inner?.onToolSelection(data);
  }

  onSubAgentStart?(data: { conversationId: string; agentId: string; task: string }): void {
    this.inner?.onSubAgentStart?.(data);
  }

  onSubAgentEnd?(data: { conversationId: string; agentId: string; tokensUsed: number }): void {
    this.inner?.onSubAgentEnd?.(data);
  }

  onTraceEnd(traceId: string, output: {
    totalTokens: number;
    turns: number;
    durationMs: number;
  }): void {
    if (this.currentTraceId === traceId) {
      const trace: CapturedTrace = {
        traceId,
        conversationId: this.currentConversationId ?? '',
        model: this.currentModel,
        prompt: this.currentPrompt,
        toolCalls: this.toolCalls,
        agentReasoning: this.reasoning,
        finalAnswer: this.finalAnswer,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        durationMs: output.durationMs,
      };

      // Fire-and-forget — don't block the agent loop
      try {
        const result = this.onTrace(trace);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {});
        }
      } catch {
        // Swallow sync errors from the callback
      }

      this.currentTraceId = null;
    }

    this.inner?.onTraceEnd(traceId, output);
  }

  async flush(): Promise<void> {
    await this.inner?.flush();
  }
}
