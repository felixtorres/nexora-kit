import { AgentLoop, ContextManager, ToolDispatcher, InMemoryMessageStore } from '@nexora-kit/core';
import type { ToolHandler, ChatEvent, ChatInput } from '@nexora-kit/core';
import { ConfigResolver } from '@nexora-kit/config';
import { PermissionGate } from '@nexora-kit/sandbox';
import { PluginLifecycleManager, loadPlugin, type LoadResult } from '@nexora-kit/plugins';
import { SkillRegistry, SkillHandlerFactory } from '@nexora-kit/skills';
import { CommandRegistry, CommandDispatcher } from '@nexora-kit/commands';
import { McpManager } from '@nexora-kit/mcp';
import type { LlmProvider } from '@nexora-kit/llm';
import { TokenBudget } from '@nexora-kit/llm';
import { createMockLlm } from './mock-llm.js';
import type { LlmEvent } from '@nexora-kit/llm';

export interface TestInstance {
  agentLoop: AgentLoop;
  toolDispatcher: ToolDispatcher;
  permissionGate: PermissionGate;
  configResolver: ConfigResolver;
  lifecycle: PluginLifecycleManager;
  skillRegistry: SkillRegistry;
  commandDispatcher: CommandDispatcher;
  tokenBudget: TokenBudget | undefined;
  llm: LlmProvider;

  /** Install a plugin from a directory and enable it */
  installPlugin(dir: string): LoadResult;

  /** Register a tool handler directly */
  registerTool(name: string, description: string, handler: ToolHandler): void;

  /** Run a chat and collect all events */
  chat(message: string, options?: Partial<{ conversationId: string; userId: string; teamId: string }>): Promise<ChatEvent[]>;
}

interface TestInstanceOptions {
  llm?: LlmProvider;
  responses?: LlmEvent[][];
  tokenBudget?: { instanceLimit?: number; pluginLimit?: number };
  pluginNamespace?: string;
}

/**
 * Creates a fully-wired test instance with all components connected.
 * Uses InMemoryMessageStore (no SQLite needed) and mock LLM by default.
 */
export function createTestInstance(options: TestInstanceOptions = {}): TestInstance {
  const llm = options.llm ?? createMockLlm(options.responses ?? [
    [{ type: 'text', content: 'Hello!' }, { type: 'usage', inputTokens: 10, outputTokens: 5 }, { type: 'done' }],
  ]);

  const permissionGate = new PermissionGate();
  const configResolver = new ConfigResolver();
  const toolDispatcher = new ToolDispatcher();
  const skillRegistry = new SkillRegistry();
  const commandRegistry = new CommandRegistry();
  const commandDispatcher = new CommandDispatcher(commandRegistry);
  const mcpManager = new McpManager();
  const messageStore = new InMemoryMessageStore();

  const skillHandlerFactory = new SkillHandlerFactory({
    llmProvider: llm,
    configResolver,
  });

  const lifecycle = new PluginLifecycleManager({
    permissionGate,
    configResolver,
    toolDispatcher,
    skillHandlerFactory,
    skillRegistry,
    mcpManager,
  });

  const tokenBudget = options.tokenBudget
    ? new TokenBudget({
        defaultInstanceLimit: options.tokenBudget.instanceLimit ?? 1_000_000,
        defaultPluginLimit: options.tokenBudget.pluginLimit ?? 500_000,
      })
    : undefined;

  const agentLoop = new AgentLoop({
    llm,
    contextManager: new ContextManager(),
    toolDispatcher,
    messageStore,
    commandDispatcher,
    tokenBudget,
    pluginNamespace: options.pluginNamespace,
  });

  const instance: TestInstance = {
    agentLoop,
    toolDispatcher,
    permissionGate,
    configResolver,
    lifecycle,
    skillRegistry,
    commandDispatcher,
    tokenBudget,
    llm,

    installPlugin(dir: string): LoadResult {
      const result = loadPlugin(dir);
      if (result.errors.length > 0) {
        throw new Error(`Plugin load errors: ${result.errors.join(', ')}`);
      }

      lifecycle.install(result.plugin);
      const ns = result.plugin.manifest.namespace;

      if (result.skillDefinitions.size > 0) {
        lifecycle.setSkillDefinitions(ns, result.skillDefinitions);
      }
      if (result.mcpServerConfigs.length > 0) {
        lifecycle.setMcpConfigs(ns, result.mcpServerConfigs);
      }
      lifecycle.registerPluginDir(ns, dir);
      lifecycle.enable(ns);

      return result;
    },

    registerTool(name: string, description: string, handler: ToolHandler): void {
      toolDispatcher.register(
        { name, description, parameters: { type: 'object', properties: {} } },
        handler,
      );
    },

    async chat(message, opts = {}): Promise<ChatEvent[]> {
      const events: ChatEvent[] = [];
      for await (const event of agentLoop.run({
        conversationId: opts.conversationId ?? 'test-conversation',
        input: { type: 'text', text: message },
        teamId: opts.teamId ?? 'team-test',
        userId: opts.userId ?? 'user-test',
        pluginNamespaces: [],
      })) {
        events.push(event);
      }
      return events;
    },
  };

  return instance;
}
