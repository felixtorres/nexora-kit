import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CliCommand } from './commands.js';
import { error, fmt } from './output.js';

import {
  AgentLoop,
  ContextManager,
  ToolDispatcher,
  JsonLogger,
  TraceCapture,
  PromptOptimizer,
  NoopObservability,
  type CompactionConfig,
  type ObservabilityHooks,
} from '@nexora-kit/core';
import type { LogLevel } from '@nexora-kit/core';
import { ConfigResolver } from '@nexora-kit/config';
import { PermissionGate } from '@nexora-kit/sandbox';
import { PluginLifecycleManager, discoverPlugins, ToolExtensionLoader } from '@nexora-kit/plugins';
import {
  ToolIndex,
  AdaptiveToolSelector,
  ConversationToolMemory,
  createSearchToolsHandler,
  SEARCH_TOOLS_NAME,
  getSearchToolsDefinition,
} from '@nexora-kit/tool-registry';
import { SkillRegistry, SkillHandlerFactory, SkillIndexAdapter } from '@nexora-kit/skills';
import { CommandRegistry, CommandDispatcher } from '@nexora-kit/commands';
import { McpManager } from '@nexora-kit/mcp';
import { createStorageBackend } from '@nexora-kit/storage';
import { AuditLogger, UsageAnalytics, AdminService } from '@nexora-kit/admin';
import { Gateway, ApiKeyAuth } from '@nexora-kit/api';
import { createProviderFromConfig, type LlmConfig } from '@nexora-kit/llm';
import { createDashboardPlugin, type DashboardPluginOptions } from '@nexora-kit/dashboard-plugin';

interface InstanceConfig {
  name: string;
  port: number;
  host?: string;
  auth?: {
    type: 'api-key';
    keys: Array<{ key: string; userId: string; teamId: string; role: 'admin' | 'user' }>;
  };
  storage?: {
    backend?: 'sqlite' | 'postgres';
    path?: string;
    connectionString?: string;
    poolSize?: number;
  };
  plugins?: { directory?: string };
  tools?: {
    directory?: string;
    namespace?: string;
    sandbox?: { tier?: 'none' | 'basic' | 'strict' };
  };
  sandbox?: { defaultTier?: 'none' | 'basic' | 'strict' };
  llm?: LlmConfig;
  agent?: {
    /** Maximum tokens to keep in conversation history per turn.
     *  Lower this for models with small context windows (e.g. 8000 for gpt-5.2). */
    maxContextTokens?: number;
    compaction?: {
      model?: string;
      triggerRatio?: number;
      keepRecentGroups?: number;
      maxSummaryTokens?: number;
    };
    toolSelection?: {
      searchModeThreshold?: number;
      passthroughBudgetRatio?: number;
      essentialTools?: string[];
    };
  };
  optimization?: {
    /** Enable execution trace capture and prompt optimization. Default: false */
    enabled?: boolean;
    /** LLM model for the reflection/rewrite step. Defaults to the instance's primary model. */
    model?: string;
  };
  rateLimit?: { windowMs?: number; maxRequests?: number };
  dashboard?: DashboardPluginOptions;
}

export const serveCommand: CliCommand = {
  name: 'serve',
  description: 'Start the NexoraKit instance',
  usage: 'nexora-kit serve [--config <path>] [--port <port>]',

  async run(args) {
    const configPath = resolve((args.flags['config'] as string) ?? 'nexora.yaml');

    // --- Root logger ---
    const logLevel = (process.env['LOG_LEVEL'] as LogLevel | undefined) ?? 'info';
    const logger = new JsonLogger({ level: logLevel });

    try {
      await access(configPath);
    } catch {
      logger.error('config.not_found', { path: configPath });
      error(`Config file not found: ${configPath}`);
      error(`Run 'nexora-kit init' to create one.`);
      process.exitCode = 1;
      return;
    }

    const raw = await readFile(configPath, 'utf-8');
    const missingEnvVars: string[] = [];
    const interpolated = raw.replace(/\$\{([^}]+)\}/g, (_, name) => {
      const value = process.env[name];
      if (value === undefined) missingEnvVars.push(name);
      return value ?? '';
    });
    if (missingEnvVars.length > 0) {
      logger.warn('config.env_vars_missing', { vars: missingEnvVars });
    }
    const config: InstanceConfig = parseYaml(interpolated);

    const port = (args.flags['port'] as string)
      ? Number(args.flags['port'])
      : (config.port ?? 3000);
    const host = (args.flags['host'] as string) ?? config.host ?? '127.0.0.1';
    const instanceDir = resolve(configPath, '..');

    logger.info('server.starting', {
      name: config.name ?? 'nexora-kit',
      host,
      port,
      logLevel,
    });

    // --- Storage ---
    const storageBackend =
      config.storage?.backend === 'postgres' && config.storage.connectionString
        ? await createStorageBackend({
            type: 'postgres',
            connectionString: config.storage.connectionString,
            poolSize: config.storage.poolSize,
          })
        : await createStorageBackend({
            type: 'sqlite',
            path: resolve(instanceDir, config.storage?.path ?? './data/nexora.db'),
          });

    if (config.storage?.backend === 'postgres' && config.storage.connectionString) {
      logger.info('storage.ready', { backend: 'postgres' });
    } else {
      logger.info('storage.ready', {
        backend: 'sqlite',
        path: resolve(instanceDir, config.storage?.path ?? './data/nexora.db'),
      });
    }

    const messageStore = storageBackend.messageStore;
    const auditEventStore = storageBackend.auditEventStore;
    const usageEventStore = storageBackend.usageEventStore;

    // --- Config ---
    const configResolver = new ConfigResolver();

    // --- Sandbox ---
    const permissionGate = new PermissionGate();

    // --- Tools & Skills ---
    const toolDispatcher = new ToolDispatcher();
    const toolIndex = new ToolIndex();
    const conversationToolMemory = new ConversationToolMemory();
    const toolSelectionConfig = config.agent?.toolSelection;
    const toolSelector = new AdaptiveToolSelector({
      index: toolIndex,
      conversationToolMemory,
      searchModeThreshold: toolSelectionConfig?.searchModeThreshold,
      passthroughBudgetRatio: toolSelectionConfig?.passthroughBudgetRatio,
      essentialTools: toolSelectionConfig?.essentialTools,
      innerSelectorOptions: { index: toolIndex },
    });

    // Register _search_tools handler in the dispatcher (NOT in toolIndex)
    const searchToolsHandler = createSearchToolsHandler({
      toolIndex,
      conversationToolMemory,
    });
    toolDispatcher.register(getSearchToolsDefinition(), async (input, context) =>
      searchToolsHandler(input, context),
    );
    const skillRegistry = new SkillRegistry();
    const commandRegistry = new CommandRegistry();
    const commandDispatcher = new CommandDispatcher(commandRegistry);
    const mcpManager = new McpManager({
      logger: logger.child({ component: 'mcp' }),
    });

    // --- LLM provider ---
    const llmProvider = createProviderFromConfig(config.llm, logger.child({ component: 'llm' }));
    logger.info('llm.provider', { name: llmProvider.name });

    // --- Skill handler factory ---
    const skillHandlerFactory = new SkillHandlerFactory({
      llmProvider,
      configResolver,
      toolDispatcher,
    });

    // --- Skill index adapter ---
    const skillIndexAdapter = new SkillIndexAdapter(skillRegistry);

    // --- Dashboard plugin (optional, if configured) ---
    const toolHandlers = new Map<string, import('@nexora-kit/core').ToolHandler>();
    let dashboardPlugin: Awaited<ReturnType<typeof createDashboardPlugin>> | undefined;
    if (config.dashboard?.dataSources && config.dashboard.dataSources.length > 0) {
      try {
        dashboardPlugin = await createDashboardPlugin(config.dashboard);
        for (const [name, handler] of dashboardPlugin.toolHandlers) {
          toolHandlers.set(name, handler);
        }
        logger.info('dashboard.initialized', { sources: config.dashboard.dataSources.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('dashboard.init_error', { err: msg });
        error(`Dashboard plugin init error: ${msg}`);
      }
    }

    // --- Plugin lifecycle ---
    const lifecycle = new PluginLifecycleManager({
      permissionGate,
      configResolver,
      toolDispatcher,
      toolHandlers,
      skillHandlerFactory,
      skillRegistry,
      commandRegistry,
      mcpManager,
      toolIndex,
      logger: logger.child({ component: 'plugins' }),
    });

    // --- Discover and install plugins ---
    const pluginsDir = resolve(instanceDir, config.plugins?.directory ?? './plugins');
    try {
      const results = discoverPlugins(pluginsDir);
      for (const result of results) {
        if (result.errors.length > 0) {
          for (const err of result.errors) {
            logger.error('plugin.load_error', { err });
            error(`Plugin load error: ${err}`);
          }
          continue;
        }
        lifecycle.install(result.plugin);
        if (result.skillDefinitions.size > 0) {
          lifecycle.setSkillDefinitions(result.plugin.manifest.namespace, result.skillDefinitions);
        }
        if (result.commandDefinitions.size > 0) {
          lifecycle.setCommandDefinitions(
            result.plugin.manifest.namespace,
            result.commandDefinitions,
          );
        }
        if (result.mcpServerConfigs.length > 0) {
          lifecycle.setMcpConfigs(result.plugin.manifest.namespace, result.mcpServerConfigs);
        }
        lifecycle.registerPluginDir(result.plugin.manifest.namespace, pluginsDir);

        // Wire plugin docs into skill index adapter
        const ns = result.plugin.manifest.namespace;
        if (result.pluginDocs) {
          skillIndexAdapter.setPluginDocs(ns, result.pluginDocs);
        }
        if (result.plugin.manifest.skillIndex === false) {
          skillIndexAdapter.disableForNamespace(ns);
        }

        lifecycle.enable(ns);
      }
    } catch {
      // Plugins dir may not exist yet — that's fine
    }

    // Sync registered commands into the parser so isCommand() works
    commandDispatcher.syncFromRegistry();

    // --- Tool Extensions ---
    const toolsDir = resolve(instanceDir, config.tools?.directory ?? './tools');
    const toolExtensionLoader = new ToolExtensionLoader({
      toolDispatcher,
      toolIndex,
      logger: logger.child({ component: 'tool-extensions' }),
      defaultNamespace: config.tools?.namespace,
      defaultSandboxTier: config.tools?.sandbox?.tier ?? config.sandbox?.defaultTier ?? 'basic',
    });
    try {
      const toolResult = await toolExtensionLoader.loadDirectory(toolsDir);
      if (toolResult.loaded.length > 0) {
        logger.info('tool_extensions.loaded', { count: toolResult.loaded.length });
      }
      for (const err of toolResult.errors) {
        error(`Tool extension error: ${err}`);
      }
    } catch {
      // tools/ directory may not exist — that's fine
    }

    // --- Trace Capture (opt-in via optimization.enabled) ---
    const optimizationEnabled = config.optimization?.enabled === true;
    let baseObservability: ObservabilityHooks | undefined;

    if (optimizationEnabled) {
      baseObservability = new TraceCapture(async (trace) => {
        try {
          await storageBackend.executionTraceStore.insert({
            conversationId: trace.conversationId,
            traceId: trace.traceId,
            model: trace.model ?? undefined,
            prompt: trace.prompt,
            toolCalls: trace.toolCalls,
            agentReasoning: trace.agentReasoning ?? undefined,
            finalAnswer: trace.finalAnswer,
            inputTokens: trace.inputTokens,
            outputTokens: trace.outputTokens,
            durationMs: trace.durationMs,
          });
        } catch (err) {
          logger.warn('trace_capture.insert_failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      });
      logger.info('optimization.trace_capture_enabled', {});
    }

    // --- Agent Loop ---
    let compactionConfig: CompactionConfig | undefined;
    if (config.agent?.compaction) {
      const cc = config.agent.compaction;
      compactionConfig = {
        model: cc.model,
        triggerRatio: cc.triggerRatio,
        keepRecentGroups: cc.keepRecentGroups,
        maxSummaryTokens: cc.maxSummaryTokens,
      };
    }

    // Observability: compose base (TraceCapture) with audit-backed sub-agent hooks
    // AuditLogger is created below, so we wire via a deferred reference
    let auditLogger: AuditLogger | undefined;
    const base: ObservabilityHooks = baseObservability ?? new NoopObservability();
    const observabilityHooks: ObservabilityHooks = {
      onTraceStart: base.onTraceStart.bind(base),
      onGeneration: base.onGeneration.bind(base),
      onToolCall: base.onToolCall.bind(base),
      onToolSelection: base.onToolSelection.bind(base),
      onTraceEnd: base.onTraceEnd.bind(base),
      flush: base.flush.bind(base),
      onSubAgentStart(data) {
        base.onSubAgentStart?.(data);
        auditLogger?.logSubAgentStart(data.conversationId, data.agentId, data.task);
      },
      onSubAgentEnd(data) {
        base.onSubAgentEnd?.(data);
        auditLogger?.logSubAgentEnd(data.conversationId, data.agentId, data.tokensUsed);
      },
    };

    const agentLoop = new AgentLoop({
      llm: llmProvider,
      contextManager: new ContextManager(),
      toolDispatcher,
      messageStore,
      commandDispatcher,
      skillIndexProvider: skillIndexAdapter,
      toolSelector,
      observability: observabilityHooks,
      maxContextTokens: config.agent?.maxContextTokens,
      compaction: compactionConfig,
      logger: logger.child({ component: 'agent-loop' }),
    });

    // --- Auth ---
    const auth = buildAuth(config, logger);

    // --- Admin ---
    auditLogger = new AuditLogger(auditEventStore);
    const usageAnalytics = new UsageAnalytics(usageEventStore);
    // --- Prompt Optimizer (only when optimization is enabled) ---
    let promptOptimizer: PromptOptimizer | undefined;
    if (optimizationEnabled) {
      promptOptimizer = new PromptOptimizer({
        llm: llmProvider,
        model: config.optimization?.model,
      });
    }

    const adminService = new AdminService({
      plugins: lifecycle,
      auditLogger,
      usageAnalytics,
      ...(optimizationEnabled && {
        executionTraceStore: storageBackend.executionTraceStore,
        optimizedPromptStore: storageBackend.optimizedPromptStore,
        promptOptimizer,
      }),
    });

    // --- Gateway ---
    const gateway = new Gateway({
      port,
      host,
      agentLoop,
      auth,
      conversationStore: storageBackend.conversationStore,
      messageStore: storageBackend.messageStore,
      usageEventStore,
      botStore: storageBackend.botStore,
      agentStore: storageBackend.agentStore,
      agentBotBindingStore: storageBackend.agentBotBindingStore,
      endUserStore: storageBackend.endUserStore,
      feedbackStore: storageBackend.feedbackStore,
      plugins: lifecycle,
      commandDispatcher,
      admin: adminService,
      dashboardStore: dashboardPlugin?.store,
      logger: logger.child({ component: 'gateway' }),
      rateLimit: config.rateLimit
        ? {
            windowMs: config.rateLimit.windowMs ?? 60_000,
            maxRequests: config.rateLimit.maxRequests ?? 100,
          }
        : undefined,
    });

    await gateway.start();

    const addr = gateway.getAddress();
    logger.info('server.ready', {
      host: addr?.host ?? host,
      port: addr?.port ?? port,
      url: `http://${addr?.host ?? host}:${addr?.port ?? port}`,
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('server.stopping', {});
      await gateway.stop();
      if (dashboardPlugin) await dashboardPlugin.close();
      await storageBackend.close();
      logger.info('server.stopped', {});
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  },
};

function buildAuth(
  config: InstanceConfig,
  logger: { warn: (msg: string, data: Record<string, unknown>) => void },
): ApiKeyAuth {
  if (!config.auth?.keys) {
    logger.warn('auth.using_dev_key', {
      message:
        'No auth.keys configured — using insecure fallback dev-key. Do NOT use in production.',
    });
  }

  const keys = config.auth?.keys ?? [
    { key: 'dev-key', userId: 'dev', teamId: 'default', role: 'admin' as const },
  ];

  const keyRecord: Record<string, { userId: string; teamId: string; role: 'admin' | 'user' }> = {};
  for (const k of keys) {
    keyRecord[k.key] = { userId: k.userId, teamId: k.teamId, role: k.role };
  }
  return new ApiKeyAuth(keyRecord);
}
