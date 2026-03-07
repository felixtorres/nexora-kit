import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { AgentLoop, ContextManager, ToolDispatcher, JsonLogger } from '@nexora-kit/core';
import type { CompactionConfig, LogLevel } from '@nexora-kit/core';
import { ConfigResolver } from '@nexora-kit/config';
import { PermissionGate } from '@nexora-kit/sandbox';
import { PluginLifecycleManager, discoverPlugins } from '@nexora-kit/plugins';
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
import { createStorageBackend, type StorageBackend } from '@nexora-kit/storage';
import { AuditLogger, UsageAnalytics, AdminService } from '@nexora-kit/admin';
import { Gateway, ApiKeyAuth } from '@nexora-kit/api';
import { createProviderFromConfig, type LlmConfig } from '@nexora-kit/llm';

import type { EvalServer, EvalTarget } from './types.js';

interface InstanceConfig {
  name: string;
  port: number;
  host?: string;
  storage?: {
    backend?: 'sqlite' | 'postgres';
    path?: string;
    connectionString?: string;
    poolSize?: number;
  };
  plugins?: { directory?: string };
  sandbox?: { defaultTier?: 'none' | 'basic' | 'strict' };
  llm?: LlmConfig;
  agent?: {
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
  rateLimit?: { windowMs?: number; maxRequests?: number };
}

const EVAL_ADMIN_KEY = 'eval-admin-key';
const EVAL_USER_KEY = 'eval-user-key';

export async function startEvalServer(target: EvalTarget): Promise<EvalServer> {
  if (target.type === 'url') {
    return {
      baseUrl: target.url.replace(/\/$/, ''),
      adminApiKey: target.adminApiKey ?? target.apiKey,
      userApiKey: target.apiKey,
      async stop() {
        // no-op for external servers
      },
    };
  }

  const configPath = resolve(target.configPath);

  try {
    await access(configPath);
  } catch {
    throw new Error(`Eval server config not found: ${configPath}`);
  }

  const raw = await readFile(configPath, 'utf-8');
  const interpolated = raw.replace(/\$\{([^}]+)\}/g, (_, name) => {
    return process.env[name] ?? '';
  });
  const config: InstanceConfig = parseYaml(interpolated);

  const logLevel = (process.env['LOG_LEVEL'] as LogLevel | undefined) ?? 'warn';
  const logger = new JsonLogger({ level: logLevel });
  const instanceDir = resolve(configPath, '..');

  // --- Storage: ephemeral in-memory SQLite ---
  const storageBackend: StorageBackend = await createStorageBackend({
    type: 'sqlite',
    path: ':memory:',
  });

  // --- Core components ---
  const configResolver = new ConfigResolver();
  const permissionGate = new PermissionGate();
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

  const searchToolsHandler = createSearchToolsHandler({ toolIndex, conversationToolMemory });
  toolDispatcher.register(
    getSearchToolsDefinition(),
    async (input, context) => searchToolsHandler(input, context),
  );

  const skillRegistry = new SkillRegistry();
  const commandRegistry = new CommandRegistry();
  const commandDispatcher = new CommandDispatcher(commandRegistry);
  const mcpManager = new McpManager({
    logger: logger.child({ component: 'mcp' }),
  });

  // --- LLM provider ---
  const llmProvider = createProviderFromConfig(config.llm, logger.child({ component: 'llm' }));

  // --- Skill handler factory ---
  const skillHandlerFactory = new SkillHandlerFactory({
    llmProvider,
    configResolver,
  });

  const skillIndexAdapter = new SkillIndexAdapter(skillRegistry);

  // --- Plugin lifecycle ---
  const lifecycle = new PluginLifecycleManager({
    permissionGate,
    configResolver,
    toolDispatcher,
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
      if (result.errors.length > 0) continue;
      lifecycle.install(result.plugin);
      if (result.skillDefinitions.size > 0) {
        lifecycle.setSkillDefinitions(result.plugin.manifest.namespace, result.skillDefinitions);
      }
      if (result.commandDefinitions.size > 0) {
        lifecycle.setCommandDefinitions(result.plugin.manifest.namespace, result.commandDefinitions);
      }
      if (result.mcpServerConfigs.length > 0) {
        lifecycle.setMcpConfigs(result.plugin.manifest.namespace, result.mcpServerConfigs);
      }
      lifecycle.registerPluginDir(result.plugin.manifest.namespace, pluginsDir);
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
    // Plugins dir may not exist
  }

  commandDispatcher.syncFromRegistry();

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

  const agentLoop = new AgentLoop({
    llm: llmProvider,
    contextManager: new ContextManager(),
    toolDispatcher,
    messageStore: storageBackend.messageStore,
    commandDispatcher,
    skillIndexProvider: skillIndexAdapter,
    toolSelector,
    maxContextTokens: config.agent?.maxContextTokens,
    compaction: compactionConfig,
  });

  // --- Auth: hardcoded eval keys ---
  const auth = new ApiKeyAuth({
    [EVAL_ADMIN_KEY]: { userId: 'eval-admin', teamId: 'eval', role: 'admin' },
    [EVAL_USER_KEY]: { userId: 'eval-user', teamId: 'eval', role: 'user' },
  });

  // --- Admin ---
  const auditLogger = new AuditLogger(storageBackend.auditEventStore);
  const usageAnalytics = new UsageAnalytics(storageBackend.usageEventStore);
  const adminService = new AdminService({
    plugins: lifecycle,
    auditLogger,
    usageAnalytics,
  });

  // --- Gateway: port 0 for OS-assigned ---
  const gateway = new Gateway({
    port: 0,
    host: '127.0.0.1',
    agentLoop,
    auth,
    conversationStore: storageBackend.conversationStore,
    messageStore: storageBackend.messageStore,
    usageEventStore: storageBackend.usageEventStore,
    botStore: storageBackend.botStore,
    agentStore: storageBackend.agentStore,
    agentBotBindingStore: storageBackend.agentBotBindingStore,
    endUserStore: storageBackend.endUserStore,
    plugins: lifecycle,
    commandDispatcher,
    admin: adminService,
    logger: logger.child({ component: 'eval-gateway' }),
  });

  await gateway.start();
  const addr = gateway.getAddress();
  if (!addr) {
    throw new Error('Failed to get eval server address');
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;
  logger.info('eval.server.ready', { baseUrl });

  return {
    baseUrl,
    adminApiKey: EVAL_ADMIN_KEY,
    userApiKey: EVAL_USER_KEY,
    async stop() {
      await gateway.stop();
      await storageBackend.close();
    },
  };
}
