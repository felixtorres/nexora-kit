import type { LlmProvider, TokenBudget } from '@nexora-kit/llm';
import { ContextManager } from './context.js';
import { ToolDispatcher, type ToolExecutionContext } from './dispatcher.js';
import { InMemoryMessageStore, type MessageStore } from './memory.js';
import { NoopObservability } from './observability.js';
import { ActionRouter } from './action-router.js';
import { filterPersistableBlocks } from './blocks.js';
import type {
  ArtifactContent,
  ChatEvent,
  ChatInput,
  ChatRequest,
  CommandDispatcherInterface,
  Conversation,
  Message,
  MessageContent,
  ToolCall,
  ToolSelectorInterface,
  ObservabilityHooks,
} from './types.js';

/** Minimal workspace context provider to avoid circular core→storage dependency. */
export interface WorkspaceContextProvider {
  getWorkspaceContext(workspaceId: string): Promise<{
    systemPrompt: string | null;
    documents: { title: string; content: string; priority: number; tokenCount: number }[];
  }>;
}

/** Minimal skill index provider to avoid circular core→skills dependency. */
export interface SkillIndexProvider {
  buildIndex(namespace: string): string;
}

/** Minimal artifact store interface to avoid circular core→storage dependency. */
export interface ArtifactStoreInterface {
  create(input: {
    conversationId: string;
    title: string;
    type?: string;
    language?: string;
    content: string;
    metadata?: Record<string, unknown>;
  }):
    | { id: string; currentVersion: number; content: string; [k: string]: unknown }
    | Promise<{ id: string; currentVersion: number; content: string; [k: string]: unknown }>;
  update(
    id: string,
    content: string,
  ):
    | { id: string; currentVersion: number; content: string; [k: string]: unknown }
    | undefined
    | Promise<
        { id: string; currentVersion: number; content: string; [k: string]: unknown } | undefined
      >;
  listByConversation?(conversationId: string):
    | {
        id: string;
        title: string;
        type?: string;
        language?: string | null;
        currentVersion: number;
      }[]
    | Promise<
        {
          id: string;
          title: string;
          type?: string;
          language?: string | null;
          currentVersion: number;
        }[]
      >;
}

export interface AgentLoopOptions {
  llm: LlmProvider;
  contextManager?: ContextManager;
  toolDispatcher?: ToolDispatcher;
  messageStore?: MessageStore;
  systemPrompt?: string;
  maxTurns?: number;
  model?: string;
  toolSelector?: ToolSelectorInterface;
  toolTokenBudget?: number;
  observability?: ObservabilityHooks;
  tokenBudget?: TokenBudget;
  pluginNamespace?: string;
  commandDispatcher?: CommandDispatcherInterface;
  artifactStore?: ArtifactStoreInterface;
  workspaceContextProvider?: WorkspaceContextProvider;
  workspaceTokenBudget?: number;
  artifactStreamChunkSize?: number;
  artifactTokenBudget?: number;
  skillIndexProvider?: SkillIndexProvider;
  /** Maximum tokens to keep in conversation history before each LLM call.
   *  When set, the agent loop calls ContextManager.truncate() to drop oldest
   *  messages that exceed this limit. Defaults to the ContextManager default
   *  (100 000). Set lower for models with small context windows (e.g. 8 000). */
  maxContextTokens?: number;
}

export class AgentLoop {
  private readonly llm: LlmProvider;
  private readonly context: ContextManager;
  private readonly dispatcher: ToolDispatcher;
  private readonly memory: MessageStore;
  private readonly systemPrompt: string;
  private readonly maxTurns: number;
  private readonly model: string;
  private readonly toolSelector?: ToolSelectorInterface;
  private readonly toolTokenBudget: number;
  private readonly observability: ObservabilityHooks;
  private readonly tokenBudget?: TokenBudget;
  private readonly pluginNamespace: string;
  private readonly commandDispatcher?: CommandDispatcherInterface;
  private readonly artifactStore?: ArtifactStoreInterface;
  private readonly workspaceContextProvider?: WorkspaceContextProvider;
  private readonly workspaceTokenBudget: number;
  private readonly artifactStreamChunkSize: number;
  private readonly artifactTokenBudget: number;
  private readonly skillIndexProvider?: SkillIndexProvider;
  private readonly maxContextTokens?: number;
  private readonly actionRouter = new ActionRouter();
  private abortControllers = new Map<string, AbortController>();

  constructor(options: AgentLoopOptions) {
    this.llm = options.llm;
    this.context = options.contextManager ?? new ContextManager();
    this.dispatcher = options.toolDispatcher ?? new ToolDispatcher();
    this.memory = options.messageStore ?? new InMemoryMessageStore();
    this.systemPrompt = options.systemPrompt ?? 'You are a helpful assistant.';
    this.maxTurns = options.maxTurns ?? 10;
    this.model = options.model ?? this.llm.models[0]?.id ?? 'default';
    this.toolSelector = options.toolSelector;
    this.toolTokenBudget = options.toolTokenBudget ?? 4000;
    this.observability = options.observability ?? new NoopObservability();
    this.tokenBudget = options.tokenBudget;
    this.pluginNamespace = options.pluginNamespace ?? '';
    this.commandDispatcher = options.commandDispatcher;
    this.artifactStore = options.artifactStore;
    this.workspaceContextProvider = options.workspaceContextProvider;
    this.workspaceTokenBudget = options.workspaceTokenBudget ?? 2000;
    this.artifactStreamChunkSize = options.artifactStreamChunkSize ?? 500;
    this.artifactTokenBudget = options.artifactTokenBudget ?? 500;
    this.skillIndexProvider = options.skillIndexProvider;
    this.maxContextTokens = options.maxContextTokens;
  }

  /**
   * Check if a generation is currently active for a conversation.
   */
  isActive(conversationId: string): boolean {
    return this.abortControllers.has(conversationId);
  }

  async *run(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    // Concurrency guard: one active generation per conversation
    if (this.abortControllers.has(request.conversationId)) {
      yield {
        type: 'error',
        message: 'A generation is already in progress for this conversation',
        code: 'CONFLICT',
      };
      yield { type: 'done' };
      return;
    }

    const controller = new AbortController();
    this.abortControllers.set(request.conversationId, controller);

    // Wire external signal to internal controller
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    const traceId = `trace-${request.conversationId}-${Date.now()}`;
    const traceStartTime = performance.now();

    // Extract text from ChatInput union
    const messageText = extractText(request.input);

    this.observability.onTraceStart(traceId, {
      conversationId: request.conversationId,
      message: messageText,
    });

    try {
      // Load or create conversation
      const existingMessages = await this.memory.get(request.conversationId);
      const conversation: Conversation = {
        id: request.conversationId,
        teamId: request.teamId,
        userId: request.userId,
        title: null,
        workspaceId: request.workspaceId,
        pluginNamespaces: request.pluginNamespaces ?? [],
        messages: existingMessages,
        messageCount: existingMessages.length,
        lastMessageAt: null,
        metadata: request.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      // Rebuild action router from loaded messages
      if (existingMessages.length > 0) {
        this.actionRouter.rebuildFromMessages(request.conversationId, existingMessages);
      }

      // Build execution context for tool dispatch
      const executionContext: ToolExecutionContext = {
        conversationId: request.conversationId,
        workspaceId: request.workspaceId,
        userId: request.userId,
        teamId: request.teamId,
      };

      // Append user message
      const userMessage: Message = { role: 'user', content: messageText };
      this.context.append(conversation, userMessage);
      await this.memory.append(request.conversationId, [userMessage]);

      // Action routing: dispatch directly to tool that produced the action
      if (request.input.type === 'action') {
        const mapping = this.actionRouter.resolve(request.conversationId, request.input.actionId);
        if (mapping) {
          const actionInput: Record<string, unknown> = {
            _action: true,
            actionId: request.input.actionId,
            ...request.input.payload,
          };
          const toolCall = {
            id: `action-${Date.now()}`,
            name: mapping.toolName,
            input: actionInput,
          };
          const result = await this.dispatcher.dispatch(toolCall, undefined, executionContext);

          if (result.content) {
            yield { type: 'text', content: result.content };
          }
          if (result.blocks && result.blocks.length > 0) {
            yield { type: 'blocks', blocks: result.blocks };
            this.actionRouter.registerFromBlocks(
              request.conversationId,
              mapping.toolName,
              result.blocks,
            );
          }

          // Store as assistant message
          const assistantContent: MessageContent[] = [];
          if (result.content) {
            assistantContent.push({ type: 'text', text: result.content });
          }
          if (result.blocks && result.blocks.length > 0) {
            const persistable = filterPersistableBlocks(result.blocks);
            if (persistable.length > 0) {
              assistantContent.push({ type: 'blocks', blocks: persistable });
            }
          }
          if (assistantContent.length > 0) {
            const assistantMessage: Message = {
              role: 'assistant',
              content:
                assistantContent.length === 1 && assistantContent[0].type === 'text'
                  ? assistantContent[0].text
                  : assistantContent,
            };
            this.context.append(conversation, assistantMessage);
            await this.memory.append(request.conversationId, [assistantMessage]);
          }

          this.observability.onTraceEnd(traceId, {
            totalTokens: 0,
            turns: 0,
            durationMs: performance.now() - traceStartTime,
          });
          yield { type: 'done' };
          return;
        }
        // No mapping found — fall through to LLM
      }

      // Command pre-processing: if message starts with / and matches a command, dispatch directly
      let commandPrompt: string | undefined;
      if (
        this.commandDispatcher &&
        messageText.startsWith('/') &&
        this.commandDispatcher.isCommand(messageText)
      ) {
        const cmdResult = await this.commandDispatcher.dispatch(messageText, {
          id: request.conversationId,
          userId: request.userId,
          teamId: request.teamId,
        });

        if (cmdResult.isPrompt) {
          // Prompt-based command: inject as system instruction, let LLM process it
          commandPrompt = cmdResult.content;
        } else {
          // Direct command: return result immediately (bypass LLM)
          const assistantMessage: Message = { role: 'assistant', content: cmdResult.content };
          this.context.append(conversation, assistantMessage);
          await this.memory.append(request.conversationId, [assistantMessage]);

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
      }

      // Resolve workspace context (once per run, prepended to system prompt each turn)
      let workspacePromptPrefix = '';
      if (this.workspaceContextProvider && conversation.workspaceId) {
        const wsCtx = await this.workspaceContextProvider.getWorkspaceContext(
          conversation.workspaceId,
        );
        workspacePromptPrefix = buildWorkspacePrompt(wsCtx, this.workspaceTokenBudget);
      }

      // Resolve artifact context (once per run, appended after system prompt)
      let artifactPromptSuffix = '';
      if (this.artifactStore?.listByConversation) {
        const artifacts = await this.artifactStore.listByConversation(request.conversationId);
        artifactPromptSuffix = buildArtifactPrompt(artifacts, this.artifactTokenBudget);
      }

      // Resolve skill index (once per run, appended after artifacts)
      let skillIndexSuffix = '';
      if (this.skillIndexProvider && conversation.pluginNamespaces.length > 0) {
        const parts: string[] = [];
        for (const ns of conversation.pluginNamespaces) {
          const index = this.skillIndexProvider.buildIndex(ns);
          if (index) parts.push(index);
        }
        skillIndexSuffix = parts.join('\n\n');
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
            query: messageText,
            namespaces: conversation.pluginNamespaces,
            tokenBudget: this.toolTokenBudget,
            recentToolNames: this.getRecentToolNames(conversation),
          });
          tools = selection.tools;

          this.observability.onToolSelection({
            query: messageText,
            selected: selection.tools.length,
            dropped: selection.droppedCount,
            tokensUsed: selection.totalTokens,
            timeMs: selection.selectionTimeMs,
          });
        } else {
          tools = this.dispatcher.listTools();
        }

        const baseSystemPrompt = request.systemPrompt ?? this.systemPrompt;
        let effectiveSystemPrompt = workspacePromptPrefix
          ? workspacePromptPrefix + '\n\n' + baseSystemPrompt
          : baseSystemPrompt;
        if (commandPrompt) {
          effectiveSystemPrompt = effectiveSystemPrompt + '\n\n' + commandPrompt;
        }
        if (artifactPromptSuffix) {
          effectiveSystemPrompt = effectiveSystemPrompt + '\n\n' + artifactPromptSuffix;
        }
        if (skillIndexSuffix) {
          effectiveSystemPrompt = effectiveSystemPrompt + '\n\n' + skillIndexSuffix;
        }
        // Trim conversation history to respect context window limit before assembling
        if (this.maxContextTokens !== undefined) {
          this.context.truncate(conversation, this.maxContextTokens);
        }
        const ctx = this.context.assemble(conversation, tools, effectiveSystemPrompt);

        // Check token budget before LLM call
        if (this.tokenBudget && this.pluginNamespace) {
          // Estimate tokens for this request (rough: 4 chars ≈ 1 token)
          const contextChars = ctx.messages.reduce((sum, m) => {
            return (
              sum +
              (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length)
            );
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

        const effectiveModel = request.model ?? this.model;
        const llmStartTime = performance.now();
        const llmMessages = [
          { role: 'system' as const, content: ctx.systemPrompt },
          ...ctx.messages,
        ];
        const llmStream = this.llm.chat({
          model: effectiveModel,
          messages: llmMessages as any[], // MessageContent union is a superset of LlmContentBlock
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
          model: effectiveModel,
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
            content:
              assistantContent.length === 1 && assistantContent[0].type === 'text'
                ? assistantContent[0].text
                : assistantContent,
          };
          this.context.append(conversation, assistantMessage);
          await this.memory.append(request.conversationId, [assistantMessage]);
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
          const result = await this.dispatcher.dispatch(toolCall, undefined, executionContext);
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

          // Yield blocks event if tool returned structured blocks
          if (result.blocks && result.blocks.length > 0) {
            yield { type: 'blocks', blocks: result.blocks };
            this.actionRouter.registerFromBlocks(
              request.conversationId,
              toolCall.name,
              result.blocks,
            );
          }

          // Process artifact operations
          const artifactContents: ArtifactContent[] = [];
          if (result.artifacts && result.artifacts.length > 0 && this.artifactStore) {
            for (const op of result.artifacts) {
              if (op.type === 'create' && op.title && op.content) {
                const created = await this.artifactStore.create({
                  conversationId: request.conversationId,
                  title: op.title,
                  type: op.artifactType,
                  language: op.language,
                  content: op.content,
                });
                yield {
                  type: 'artifact_create',
                  artifactId: created.id,
                  title: op.title,
                  content: '',
                };
                const chunks = chunkArtifactContent(op.content, this.artifactStreamChunkSize);
                for (const chunk of chunks) {
                  yield { type: 'artifact_stream', artifactId: created.id, delta: chunk };
                }
                yield { type: 'artifact_done', artifactId: created.id };
                artifactContents.push({ type: 'artifact', artifactId: created.id, operation: op });
              } else if (op.type === 'update' && op.content) {
                const updated = await this.artifactStore.update(op.artifactId, op.content);
                if (updated) {
                  yield {
                    type: 'artifact_update',
                    artifactId: op.artifactId,
                    title: op.title,
                    content: '',
                  };
                  const chunks = chunkArtifactContent(op.content, this.artifactStreamChunkSize);
                  for (const chunk of chunks) {
                    yield { type: 'artifact_stream', artifactId: op.artifactId, delta: chunk };
                  }
                  yield { type: 'artifact_done', artifactId: op.artifactId };
                  artifactContents.push({
                    type: 'artifact',
                    artifactId: op.artifactId,
                    operation: op,
                  });
                }
              }
            }
          }

          const toolMessageContent: MessageContent[] = [
            {
              type: 'tool_result',
              toolUseId: result.toolUseId,
              content: result.content,
              isError: result.isError,
            },
          ];

          // Store persistable blocks alongside tool result (ProgressBlock filtered out)
          if (result.blocks && result.blocks.length > 0) {
            const persistable = filterPersistableBlocks(result.blocks);
            if (persistable.length > 0) {
              toolMessageContent.push({ type: 'blocks', blocks: persistable });
            }
          }

          // Store artifact content references in message
          for (const ac of artifactContents) {
            toolMessageContent.push(ac);
          }

          const toolMessage: Message = {
            role: 'tool',
            content: toolMessageContent,
          };
          this.context.append(conversation, toolMessage);
          await this.memory.append(request.conversationId, [toolMessage]);
        }

        yield { type: 'usage', inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
        // Continue loop — LLM will see tool results and respond
      }

      // Loop ended — either abort or max turns
      this.observability.onTraceEnd(traceId, {
        totalTokens: cumulativeInputTokens + cumulativeOutputTokens,
        turns: turn,
        durationMs: performance.now() - traceStartTime,
      });

      if (controller.signal.aborted) {
        yield { type: 'cancelled' };
      } else {
        yield { type: 'error', message: `Max turns (${this.maxTurns}) reached`, code: 'MAX_TURNS' };
        yield { type: 'done' };
      }
    } finally {
      this.abortControllers.delete(request.conversationId);
    }
  }

  abort(conversationId: string): void {
    this.abortControllers.get(conversationId)?.abort();
  }

  get toolDispatcher(): ToolDispatcher {
    return this.dispatcher;
  }

  private getRecentToolNames(conversation: Conversation): string[] {
    const recent: string[] = [];
    // Walk messages in reverse, collect tool_use names
    for (let i = conversation.messages.length - 1; i >= 0 && recent.length < 20; i--) {
      const msg = conversation.messages[i];
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

function extractText(input: ChatInput): string {
  switch (input.type) {
    case 'text':
      return input.text;
    case 'action':
      return `[action:${input.actionId}]`;
    case 'file':
      return input.text ?? `[file:${input.fileId}]`;
  }
}

export function chunkArtifactContent(content: string, chunkSize: number): string[] {
  if (!content) return [];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    let end = Math.min(offset + chunkSize, content.length);
    // Prefer splitting at a newline boundary within the chunk
    if (end < content.length) {
      const newlineIdx = content.lastIndexOf('\n', end);
      if (newlineIdx > offset) {
        end = newlineIdx + 1; // include the newline
      }
    }
    chunks.push(content.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export function buildArtifactPrompt(
  artifacts: {
    id: string;
    title: string;
    type?: string;
    language?: string | null;
    currentVersion: number;
  }[],
  tokenBudget: number,
): string {
  if (artifacts.length === 0) return '';

  const lines: string[] = ['## Artifacts'];
  let estimatedTokens = 4; // heading
  for (const a of artifacts) {
    const typeLabel = a.type ?? 'document';
    const langPart = a.language ? `, ${a.language}` : '';
    const line = `- [${typeLabel}${langPart}] ${a.title} (v${a.currentVersion})`;
    const lineTokens = Math.ceil(line.length / 4);
    if (estimatedTokens + lineTokens > tokenBudget) break;
    lines.push(line);
    estimatedTokens += lineTokens;
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

function buildWorkspacePrompt(
  wsCtx: {
    systemPrompt: string | null;
    documents: { title: string; content: string; tokenCount: number }[];
  },
  tokenBudget: number,
): string {
  const parts: string[] = [];

  if (wsCtx.systemPrompt) {
    parts.push(wsCtx.systemPrompt);
  }

  if (wsCtx.documents.length > 0) {
    let usedTokens = 0;
    const docParts: string[] = [];

    // Documents are already sorted by priority DESC from the store
    for (const doc of wsCtx.documents) {
      if (usedTokens + doc.tokenCount > tokenBudget) break;
      docParts.push(`### ${doc.title}\n${doc.content}`);
      usedTokens += doc.tokenCount;
    }

    if (docParts.length > 0) {
      parts.push('## Reference Documents\n\n' + docParts.join('\n\n'));
    }
  }

  return parts.join('\n\n');
}
