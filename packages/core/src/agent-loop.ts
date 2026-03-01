import type { LlmProvider, TokenBudget } from '@nexora-kit/llm';
import { ContextManager } from './context.js';
import { ToolDispatcher } from './dispatcher.js';
import { InMemoryStore, type MemoryStore } from './memory.js';
import { NoopObservability } from './observability.js';
import type {
  ChatEvent,
  ChatRequest,
  CommandDispatcherInterface,
  Message,
  MessageContent,
  Session,
  ToolCall,
  ToolSelectorInterface,
  ObservabilityHooks,
} from './types.js';

export interface AgentLoopOptions {
  llm: LlmProvider;
  contextManager?: ContextManager;
  toolDispatcher?: ToolDispatcher;
  memoryStore?: MemoryStore;
  systemPrompt?: string;
  maxTurns?: number;
  model?: string;
  toolSelector?: ToolSelectorInterface;
  toolTokenBudget?: number;
  observability?: ObservabilityHooks;
  tokenBudget?: TokenBudget;
  pluginNamespace?: string;
  commandDispatcher?: CommandDispatcherInterface;
}

export class AgentLoop {
  private readonly llm: LlmProvider;
  private readonly context: ContextManager;
  private readonly dispatcher: ToolDispatcher;
  private readonly memory: MemoryStore;
  private readonly systemPrompt: string;
  private readonly maxTurns: number;
  private readonly model: string;
  private readonly toolSelector?: ToolSelectorInterface;
  private readonly toolTokenBudget: number;
  private readonly observability: ObservabilityHooks;
  private readonly tokenBudget?: TokenBudget;
  private readonly pluginNamespace: string;
  private readonly commandDispatcher?: CommandDispatcherInterface;
  private abortControllers = new Map<string, AbortController>();

  constructor(options: AgentLoopOptions) {
    this.llm = options.llm;
    this.context = options.contextManager ?? new ContextManager();
    this.dispatcher = options.toolDispatcher ?? new ToolDispatcher();
    this.memory = options.memoryStore ?? new InMemoryStore();
    this.systemPrompt = options.systemPrompt ?? 'You are a helpful assistant.';
    this.maxTurns = options.maxTurns ?? 10;
    this.model = options.model ?? this.llm.models[0]?.id ?? 'default';
    this.toolSelector = options.toolSelector;
    this.toolTokenBudget = options.toolTokenBudget ?? 4000;
    this.observability = options.observability ?? new NoopObservability();
    this.tokenBudget = options.tokenBudget;
    this.pluginNamespace = options.pluginNamespace ?? '';
    this.commandDispatcher = options.commandDispatcher;
  }

  async *run(request: ChatRequest): AsyncIterable<ChatEvent> {
    const controller = new AbortController();
    this.abortControllers.set(request.sessionId, controller);
    const traceId = `trace-${request.sessionId}-${Date.now()}`;
    const traceStartTime = performance.now();

    this.observability.onTraceStart(traceId, {
      sessionId: request.sessionId,
      message: request.message,
    });

    try {
      // Load or create session
      const existingMessages = await this.memory.get(request.sessionId);
      const session: Session = {
        id: request.sessionId,
        teamId: request.teamId,
        userId: request.userId,
        pluginNamespaces: request.pluginNamespaces ?? [],
        messages: existingMessages,
        metadata: request.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Append user message
      const userMessage: Message = { role: 'user', content: request.message };
      this.context.append(session, userMessage);
      await this.memory.append(request.sessionId, [userMessage]);

      // Command pre-processing: if message starts with / and matches a command, dispatch directly
      if (this.commandDispatcher && request.message.startsWith('/') && this.commandDispatcher.isCommand(request.message)) {
        const cmdResult = await this.commandDispatcher.dispatch(request.message, {
          id: request.sessionId,
          userId: request.userId,
          teamId: request.teamId,
        });

        const assistantMessage: Message = { role: 'assistant', content: cmdResult.content };
        this.context.append(session, assistantMessage);
        await this.memory.append(request.sessionId, [assistantMessage]);

        yield { type: 'text', content: cmdResult.content };
        if (cmdResult.isError) {
          yield { type: 'error', message: cmdResult.content, code: 'COMMAND_ERROR' };
        }
        this.observability.onTraceEnd(traceId, {
          totalTokens: 0,
          turns: 0,
          durationMs: performance.now() - traceStartTime,
        });
        yield { type: 'done' };
        return;
      }

      // Agent loop: LLM call → tool execution → repeat
      let turn = 0;
      let cumulativeInputTokens = 0;
      let cumulativeOutputTokens = 0;

      while (turn < this.maxTurns) {
        if (controller.signal.aborted) break;
        turn++;

        // Tool selection: use toolSelector if available, otherwise list all
        let tools;
        if (this.toolSelector) {
          const selection = this.toolSelector.select({
            query: request.message,
            namespaces: session.pluginNamespaces,
            tokenBudget: this.toolTokenBudget,
            recentToolNames: this.getRecentToolNames(session),
          });
          tools = selection.tools;

          this.observability.onToolSelection({
            query: request.message,
            selected: selection.tools.length,
            dropped: selection.droppedCount,
            tokensUsed: selection.totalTokens,
            timeMs: selection.selectionTimeMs,
          });
        } else {
          tools = this.dispatcher.listTools();
        }

        const ctx = this.context.assemble(session, tools, this.systemPrompt);

        // Check token budget before LLM call
        if (this.tokenBudget && this.pluginNamespace) {
          // Estimate tokens for this request (rough: 4 chars ≈ 1 token)
          const contextChars = ctx.messages.reduce((sum, m) => {
            return sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length);
          }, 0);
          const estimatedTokens = Math.ceil(contextChars / 4);
          const budgetCheck = this.tokenBudget.check(this.pluginNamespace, estimatedTokens);
          if (!budgetCheck.allowed) {
            yield { type: 'error', message: budgetCheck.reason, code: 'BUDGET_EXCEEDED' };
            yield { type: 'done' };
            return;
          }
        }

        // Collect response from LLM
        const pendingToolCalls: ToolCall[] = [];
        let textAccumulator = '';
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        const llmStartTime = performance.now();
        const llmStream = this.llm.chat({
          model: this.model,
          messages: ctx.messages,
          tools: ctx.tools.length > 0 ? ctx.tools : undefined,
          stream: true,
        });

        for await (const event of llmStream) {
          if (controller.signal.aborted) break;

          switch (event.type) {
            case 'text':
              textAccumulator += event.content;
              yield { type: 'text', content: event.content };
              break;

            case 'tool_call':
              pendingToolCalls.push({
                id: event.id,
                name: event.name,
                input: event.input as Record<string, unknown>,
              });
              yield {
                type: 'tool_call',
                id: event.id,
                name: event.name,
                input: event.input as Record<string, unknown>,
              };
              break;

            case 'usage':
              totalInputTokens += event.inputTokens;
              totalOutputTokens += event.outputTokens;
              break;

            case 'done':
              break;
          }
        }

        const llmDurationMs = performance.now() - llmStartTime;
        cumulativeInputTokens += totalInputTokens;
        cumulativeOutputTokens += totalOutputTokens;

        // Consume tokens from budget
        if (this.tokenBudget && this.pluginNamespace) {
          this.tokenBudget.consume(this.pluginNamespace, {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          });
        }

        this.observability.onGeneration({
          model: this.model,
          input: ctx.messages,
          output: textAccumulator || undefined,
          usage: { input: totalInputTokens, output: totalOutputTokens },
          durationMs: llmDurationMs,
        });

        // Store assistant message
        if (textAccumulator || pendingToolCalls.length > 0) {
          const assistantContent: MessageContent[] = [];
          if (textAccumulator) {
            assistantContent.push({ type: 'text', text: textAccumulator });
          }
          for (const tc of pendingToolCalls) {
            assistantContent.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input,
            });
          }
          const assistantMessage: Message = {
            role: 'assistant',
            content: assistantContent.length === 1 && assistantContent[0].type === 'text'
              ? assistantContent[0].text
              : assistantContent,
          };
          this.context.append(session, assistantMessage);
          await this.memory.append(request.sessionId, [assistantMessage]);
        }

        // If no tool calls, we're done
        if (pendingToolCalls.length === 0) {
          yield { type: 'usage', inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
          this.observability.onTraceEnd(traceId, {
            totalTokens: cumulativeInputTokens + cumulativeOutputTokens,
            turns: turn,
            durationMs: performance.now() - traceStartTime,
          });
          yield { type: 'done' };
          return;
        }

        // Execute tool calls and append results
        for (const toolCall of pendingToolCalls) {
          if (controller.signal.aborted) break;

          const toolStartTime = performance.now();
          const result = await this.dispatcher.dispatch(toolCall);
          const toolDurationMs = performance.now() - toolStartTime;

          this.observability.onToolCall({
            name: toolCall.name,
            input: toolCall.input,
            output: result.content,
            isError: result.isError ?? false,
            durationMs: toolDurationMs,
          });

          yield {
            type: 'tool_result',
            toolUseId: result.toolUseId,
            content: result.content,
            isError: result.isError,
          };

          const toolMessage: Message = {
            role: 'tool',
            content: [
              {
                type: 'tool_result',
                toolUseId: result.toolUseId,
                content: result.content,
                isError: result.isError,
              },
            ],
          };
          this.context.append(session, toolMessage);
          await this.memory.append(request.sessionId, [toolMessage]);
        }

        yield { type: 'usage', inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
        // Continue loop — LLM will see tool results and respond
      }

      // Max turns reached
      this.observability.onTraceEnd(traceId, {
        totalTokens: cumulativeInputTokens + cumulativeOutputTokens,
        turns: turn,
        durationMs: performance.now() - traceStartTime,
      });
      yield { type: 'error', message: `Max turns (${this.maxTurns}) reached`, code: 'MAX_TURNS' };
      yield { type: 'done' };
    } finally {
      this.abortControllers.delete(request.sessionId);
    }
  }

  abort(sessionId: string): void {
    this.abortControllers.get(sessionId)?.abort();
  }

  get toolDispatcher(): ToolDispatcher {
    return this.dispatcher;
  }

  private getRecentToolNames(session: Session): string[] {
    const recent: string[] = [];
    // Walk messages in reverse, collect tool_use names
    for (let i = session.messages.length - 1; i >= 0 && recent.length < 20; i--) {
      const msg = session.messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'tool_use') {
            recent.push(part.name);
          }
        }
      }
    }
    return recent.reverse();
  }
}
