import type { LlmProvider, TokenBudget } from '@nexora-kit/llm';
import { ContextManager } from './context.js';
import { ToolDispatcher, type ToolExecutionContext } from './dispatcher.js';
import { InMemoryMessageStore, type MessageStore } from './memory.js';
import { NoopObservability } from './observability.js';
import { NoopLogger, type Logger } from './logger.js';
import { ActionRouter } from './action-router.js';
import { filterPersistableBlocks } from './blocks.js';
import { estimateTokens } from './token-utils.js';
import { ContextCompactor, type CompactionConfig } from './compaction.js';
import { InMemoryWorkingMemory } from './working-memory.js';
import { getBuiltinToolDefinitions } from './builtin-tools.js';
import { SystemPromptBuilder } from './system-prompt-builder.js';
import { SubAgentRunner, type SubAgentConfig } from './sub-agent.js';
import { SkillActivationManager } from './skill-activation.js';
import { DEFAULT_SYSTEM_PROMPT } from './default-prompt.js';
import type { UserMemoryStoreInterface } from './user-memory-interface.js';
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
  ToolResult,
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
   *  messages that exceed this limit. When omitted, auto-derived from
   *  ModelInfo.contextWindow - maxOutputTokens - toolTokenBudget. */
  maxContextTokens?: number;
  /** Maximum tokens for the skill index section in the system prompt.
   *  Overflow namespaces get a one-line summary. Defaults to 500. */
  skillIndexTokenBudget?: number;
  /** Maximum additional turns granted when _request_continue is called.
   *  Defaults to 10. */
  maxContinueTurns?: number;
  /** Context compaction configuration. When set, compaction replaces hard truncation. */
  compaction?: CompactionConfig;
  /** Enable working memory built-in tools (_note_to_self, _recall). Default: true */
  enableWorkingMemory?: boolean;
  /** User memory store for _save_to_memory tool. When provided, enables persistent memory promotion. */
  userMemoryStore?: UserMemoryStoreInterface;
  /** Sub-agent spawning configuration. When set, registers _spawn_agent tool. */
  subAgent?: SubAgentConfig;
  /** Skill activation manager for behavioral skill overlays. When provided,
   *  active skill instructions are injected into the system prompt each turn,
   *  and tool restrictions from active skills are applied. */
  skillActivationManager?: SkillActivationManager;
  /** Internal: current nesting depth. Do not set directly. */
  _depth?: number;
  /** Internal: parent trace ID for sub-agent observability correlation. */
  _parentTraceId?: string;
  /** Logger for agent loop warnings (context budget, compaction, etc.). */
  logger?: Logger;
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
  private readonly maxContextTokens: number;
  private readonly skillIndexTokenBudget: number;
  private readonly maxContinueTurns: number;
  private readonly compactor?: ContextCompactor;
  private readonly workingMemory: InMemoryWorkingMemory;
  private readonly promptBuilder = new SystemPromptBuilder();
  private readonly enableWorkingMemory: boolean;
  private readonly subAgentRunner?: SubAgentRunner;
  private readonly skillActivation: SkillActivationManager;
  private readonly parentTraceId?: string;
  private readonly logger: Logger;
  private currentTraceId?: string;
  private readonly actionRouter = new ActionRouter();
  private abortControllers = new Map<string, AbortController>();

  constructor(options: AgentLoopOptions) {
    this.llm = options.llm;
    this.context = options.contextManager ?? new ContextManager();
    this.dispatcher = options.toolDispatcher ?? new ToolDispatcher();
    this.memory = options.messageStore ?? new InMemoryMessageStore();
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxTurns = options.maxTurns ?? 25;
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
    this.skillIndexTokenBudget = options.skillIndexTokenBudget ?? 500;
    this.maxContinueTurns = options.maxContinueTurns ?? 10;
    this.enableWorkingMemory = options.enableWorkingMemory ?? true;
    this.workingMemory = new InMemoryWorkingMemory();
    this.skillActivation = options.skillActivationManager ?? new SkillActivationManager();
    this.logger = options.logger ?? new NoopLogger();

    // Set up compaction
    if (options.compaction) {
      this.compactor = new ContextCompactor(this.llm, {
        ...options.compaction,
        logger: this.logger.child({ component: 'compaction' }),
      });
    }

    // Register built-in tools
    if (this.enableWorkingMemory) {
      const builtinTools = getBuiltinToolDefinitions(this.workingMemory, {
        userMemoryStore: options.userMemoryStore,
      });
      for (const tool of builtinTools) {
        this.dispatcher.register(tool.definition, tool.handler);
      }
    }

    this.parentTraceId = options._parentTraceId;

    // Register sub-agent tool
    const depth = options._depth ?? 0;
    if (options.subAgent) {
      const maxDepth = options.subAgent.maxDepth ?? 2;
      if (depth < maxDepth) {
        this.subAgentRunner = new SubAgentRunner(options, depth, options.subAgent);
        this.dispatcher.register(
          {
            name: '_spawn_agent',
            description:
              'Spawn a sub-agent to handle a complex subtask independently. The sub-agent gets its own conversation and returns a text result. Use this to decompose complex tasks into parallel subtasks.',
            parameters: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: 'The task for the sub-agent to accomplish',
                },
                context: {
                  type: 'string',
                  description: 'Optional context to pass to the sub-agent',
                },
                tools: {
                  type: 'string',
                  description: 'Comma-separated list of tool names to make available (default: all non-internal tools)',
                },
              },
              required: ['task'],
            },
          },
          async (input) => {
            if (!this.subAgentRunner?.canSpawn()) {
              return 'Cannot spawn sub-agent: depth or concurrency limit reached.';
            }
            const toolList = input.tools
              ? String(input.tools).split(',').map((t) => t.trim())
              : undefined;
            const result = await this.subAgentRunner.run(
              {
                task: String(input.task),
                context: input.context ? String(input.context) : undefined,
                tools: toolList,
              },
              undefined,
              this.currentTraceId,
            );
            return `[Sub-agent ${result.agentId}]\n${result.output}`;
          },
        );
      }
    }

    // Derive maxContextTokens from ModelInfo if not explicitly set
    if (options.maxContextTokens !== undefined) {
      this.maxContextTokens = options.maxContextTokens;
    } else {
      const modelInfo = this.llm.models.find((m) => m.id === this.model);
      if (modelInfo) {
        this.maxContextTokens =
          modelInfo.contextWindow - modelInfo.maxOutputTokens - this.toolTokenBudget;
      } else {
        this.maxContextTokens = 100_000; // safe fallback
      }
    }
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
    this.currentTraceId = traceId;
    const traceStartTime = performance.now();

    // Extract text from ChatInput union
    const messageText = extractText(request.input);

    this.observability.onTraceStart(traceId, {
      conversationId: request.conversationId,
      message: messageText,
      parentTraceId: this.parentTraceId,
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

      // Resolve skill index (once per run, appended after artifacts) with budget
      let skillIndexSuffix = '';
      if (this.skillIndexProvider && conversation.pluginNamespaces.length > 0) {
        const parts: string[] = [];
        let usedTokens = 0;
        for (const ns of conversation.pluginNamespaces) {
          const index = this.skillIndexProvider.buildIndex(ns);
          if (!index) continue;
          const indexTokens = estimateTokens(index);
          if (usedTokens + indexTokens <= this.skillIndexTokenBudget) {
            parts.push(index);
            usedTokens += indexTokens;
          } else {
            // Overflow: one-line summary instead
            parts.push(`[${ns}: use get_skill_context for details]`);
          }
        }
        skillIndexSuffix = parts.join('\n\n');
      }

      // Agent loop: LLM call → tool execution → repeat
      let turn = 0;
      let effectiveMaxTurns = this.maxTurns;
      let continueUsed = false;
      let cumulativeInputTokens = 0;
      let cumulativeOutputTokens = 0;

      while (turn < effectiveMaxTurns) {
        if (controller.signal.aborted) break;
        turn++;

        yield { type: 'turn_start', turn, maxTurns: effectiveMaxTurns };

        // Register _request_continue tool when approaching turn limit
        const continueToolName = '_request_continue';
        const nearLimit = turn >= effectiveMaxTurns - 2;
        if (nearLimit && !continueUsed && !this.dispatcher.hasHandler(continueToolName)) {
          this.dispatcher.register(
            {
              name: continueToolName,
              description: 'Request additional turns to complete the current task. Use this when you are near the turn limit and need more steps.',
              parameters: { type: 'object', properties: {}, required: [] },
            },
            async () => `Granted ${this.maxContinueTurns} additional turns.`,
          );
        }

        // Tool selection: use toolSelector if available, otherwise list all
        let tools;
        if (this.toolSelector) {
          const selection = this.toolSelector.select({
            query: messageText,
            namespaces: conversation.pluginNamespaces,
            tokenBudget: this.toolTokenBudget,
            recentToolNames: this.getRecentToolNames(conversation),
            conversationId: conversation.id,
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

        // Apply tool restrictions from active behavioral skills
        const skillAllowedTools = this.skillActivation.getAllowedTools(request.conversationId);
        if (skillAllowedTools) {
          const allowedSet = new Set(skillAllowedTools);
          // Always allow internal tools (prefixed with _)
          tools = tools.filter((t) => t.name.startsWith('_') || allowedSet.has(t.name));
        }

        // Build system prompt with dynamic components
        const workingMemoryNotes = this.enableWorkingMemory
          ? this.workingMemory.getNotes(request.conversationId)
          : [];
        const turnReminders = this.promptBuilder.buildTurnReminders(turn, effectiveMaxTurns);

        // Get active behavioral skill instructions
        const activeSkillInstructions = this.skillActivation.getActiveInstructions(
          request.conversationId,
        );

        const { prompt: effectiveSystemPrompt, metrics: promptMetrics } = this.promptBuilder.buildWithMetrics({
          workspacePrefix: workspacePromptPrefix || undefined,
          basePrompt: request.systemPrompt ?? this.systemPrompt,
          commandPrompt,
          activeSkillInstructions,
          artifactSuffix: artifactPromptSuffix || undefined,
          skillIndexSuffix: skillIndexSuffix || undefined,
          workingMemoryNotes: [...workingMemoryNotes, ...turnReminders],
        });

        // Estimate tool token overhead (aggregate + per-namespace)
        const namespaceTokens = new Map<string, number>();
        const toolTokens = tools.reduce((sum, t) => {
          const desc = `${t.name} ${t.description} ${JSON.stringify(t.parameters)}`;
          const tokens = Math.ceil(desc.length / 4);
          // Extract namespace from tool name (e.g. "@ns/tool" → "@ns", "tool" → "_builtin")
          const slashIdx = t.name.indexOf('/');
          const ns = slashIdx > 0 ? t.name.slice(0, slashIdx) : '_builtin';
          namespaceTokens.set(ns, (namespaceTokens.get(ns) ?? 0) + tokens);
          return sum + tokens;
        }, 0);

        // Emit context metrics on first turn (avoid noise on subsequent turns)
        if (turn === 1) {
          yield {
            type: 'context_metrics',
            systemPromptTokens: promptMetrics.totalTokens,
            toolTokens,
            toolCount: tools.length,
            promptBreakdown: promptMetrics.breakdown,
          };

          // Warn if framework system prompt tokens exceed recommended ceiling
          const frameworkTokens = promptMetrics.totalTokens - promptMetrics.breakdown.base;
          if (frameworkTokens > 2000) {
            this.logger.warn('context.system_prompt_overhead', {
              frameworkTokens,
              totalSystemPromptTokens: promptMetrics.totalTokens,
              breakdown: promptMetrics.breakdown,
              message: 'Framework system prompt exceeds 2k token ceiling — consider reducing skill index or working memory',
            });
          }

          // Warn if any plugin namespace injects >2k tokens of tool definitions
          for (const [ns, tokens] of namespaceTokens) {
            if (ns !== '_builtin' && tokens > 2000) {
              this.logger.warn('context.plugin_tool_overhead', {
                namespace: ns,
                toolTokens: tokens,
                message: `Plugin "${ns}" injects ${tokens} tokens of tool definitions per turn`,
              });
            }
          }
        }

        // Compact conversation history if configured, otherwise hard-truncate
        if (this.compactor) {
          const currentChars = conversation.messages.reduce(
            (sum, m) =>
              sum +
              (typeof m.content === 'string'
                ? m.content.length
                : JSON.stringify(m.content).length),
            0,
          );
          const currentTokens = Math.ceil(currentChars / 4);
          if (this.compactor.shouldCompact(currentTokens, this.maxContextTokens)) {
            const result = await this.compactor.compact(conversation.messages);
            if (result.compactedMessages > 0) {
              // Remove compacted messages and prepend summary
              const systemMessages = conversation.messages.filter((m) => m.role === 'system');
              const nonSystem = conversation.messages.filter((m) => m.role !== 'system');
              const groups = (await import('./context.js')).buildAtomicGroups(nonSystem);
              const keepCount = Math.min(4, groups.length);
              const kept = groups.slice(groups.length - keepCount).flatMap((g) => g);
              const summaryMessage: Message = {
                role: 'system',
                content: `[Conversation Summary]\n${result.summary}`,
              };
              conversation.messages = [...systemMessages, summaryMessage, ...kept];

              yield {
                type: 'compaction',
                compactedMessages: result.compactedMessages,
                summaryTokens: result.summaryTokens,
              };
            }
          }
        }

        // Fallback: hard-truncate if still over budget
        this.context.truncate(conversation, this.maxContextTokens);
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

            case 'thinking':
              yield { type: 'thinking', content: event.content };
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

        // Emit sub_agent_start for _spawn_agent calls before execution
        for (const tc of pendingToolCalls) {
          if (tc.name === '_spawn_agent') {
            const task = String((tc.input as Record<string, unknown>).task ?? '');
            yield { type: 'sub_agent_start', agentId: tc.id, task };
            this.observability.onSubAgentStart?.({
              conversationId: request.conversationId,
              agentId: tc.id,
              task,
            });
          }
        }

        // Execute tool calls in parallel
        for (const tc of pendingToolCalls) {
          yield { type: 'tool_status', id: tc.id, name: tc.name, status: 'executing' };
        }

        const toolStartTime = performance.now();
        const results = await Promise.all(
          pendingToolCalls.map((toolCall) =>
            this.dispatcher
              .dispatch(toolCall, undefined, executionContext)
              .then((result) => ({ toolCall, result, error: undefined as unknown }))
              .catch((error) => ({
                toolCall,
                result: {
                  toolUseId: toolCall.id,
                  content: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
                  isError: true as const,
                } as ToolResult,
                error,
              })),
          ),
        );
        const toolDurationMs = performance.now() - toolStartTime;

        // Process results in original order, yield events and store messages
        let hadContinueRequest = false;
        const toolMessages: Message[] = [];

        for (const { toolCall, result } of results) {
          if (controller.signal.aborted) break;

          yield {
            type: 'tool_status',
            id: toolCall.id,
            name: toolCall.name,
            status: result.isError ? 'error' : 'completed',
          };

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

          toolMessages.push({ role: 'tool', content: toolMessageContent });

          // Handle _request_continue
          if (toolCall.name === continueToolName && !continueUsed) {
            hadContinueRequest = true;
          }

          // Emit sub_agent_end for completed sub-agent calls
          if (toolCall.name === '_spawn_agent' && this.subAgentRunner) {
            // Extract agentId from result content: "[Sub-agent <agentId>]\n..."
            const agentIdMatch = result.content.match(/\[Sub-agent (sub-[^\]]+)\]/);
            const subAgentId = agentIdMatch?.[1] ?? toolCall.id;
            const subTokens = this.subAgentRunner.getTokensUsed(subAgentId);
            cumulativeInputTokens += subTokens;
            yield { type: 'sub_agent_end', agentId: subAgentId, tokensUsed: subTokens };
            this.observability.onSubAgentEnd?.({
              conversationId: request.conversationId,
              agentId: subAgentId,
              tokensUsed: subTokens,
            });
          }
        }

        // Store all tool messages after parallel execution completes
        for (const toolMessage of toolMessages) {
          this.context.append(conversation, toolMessage);
        }
        await this.memory.append(request.conversationId, toolMessages);

        // Apply continue extension
        if (hadContinueRequest && !continueUsed) {
          continueUsed = true;
          effectiveMaxTurns += this.maxContinueTurns;
          yield { type: 'turn_continue', currentTurn: turn, additionalTurns: this.maxContinueTurns };
          // Unregister the continue tool — one-shot only
          this.dispatcher.unregister(continueToolName);
        }

        yield { type: 'usage', inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
        // Continue loop — LLM will see tool results and respond
      }

      // Clean up _request_continue tool if still registered
      if (this.dispatcher.hasHandler('_request_continue')) {
        this.dispatcher.unregister('_request_continue');
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
        yield { type: 'error', message: `Max turns (${effectiveMaxTurns}) reached`, code: 'MAX_TURNS' };
        yield { type: 'done' };
      }
    } finally {
      this.abortControllers.delete(request.conversationId);
    }
  }

  abort(conversationId: string): void {
    this.abortControllers.get(conversationId)?.abort();
  }

  /** Clean up all in-memory state for a deleted conversation. */
  clearConversation(conversationId: string): void {
    this.abortControllers.get(conversationId)?.abort();
    this.abortControllers.delete(conversationId);
    this.actionRouter.clear(conversationId);
    this.workingMemory.clear(conversationId);
  }

  get toolDispatcher(): ToolDispatcher {
    return this.dispatcher;
  }

  get skillActivationManager(): SkillActivationManager {
    return this.skillActivation;
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
