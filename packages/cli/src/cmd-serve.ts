import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CliCommand } from './commands.js';
import { error, fmt } from './output.js';

import { AgentLoop, ContextManager, ToolDispatcher, JsonLogger } from '@nexora-kit/core';
import type { LogLevel } from '@nexora-kit/core';
import { ConfigResolver } from '@nexora-kit/config';
import { PermissionGate } from '@nexora-kit/sandbox';
import { PluginLifecycleManager, discoverPlugins } from '@nexora-kit/plugins';
import { SkillRegistry, SkillHandlerFactory } from '@nexora-kit/skills';
import { CommandRegistry, CommandDispatcher } from '@nexora-kit/commands';
import { McpManager } from '@nexora-kit/mcp';
import { createStorageBackend, type StorageBackend } from '@nexora-kit/storage';
import { AuditLogger, UsageAnalytics, AdminService } from '@nexora-kit/admin';
import { Gateway, ApiKeyAuth } from '@nexora-kit/api';
import { createProviderFromConfig, type LlmConfig } from '@nexora-kit/llm';

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
  sandbox?: { defaultTier?: 'none' | 'basic' | 'strict' };
  llm?: LlmConfig;
  rateLimit?: { windowMs?: number; maxRequests?: number };
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
    let storageBackend: StorageBackend;
    if (config.storage?.backend === 'postgres' && config.storage.connectionString) {
      storageBackend = await createStorageBackend({
        type: 'postgres',
        connectionString: config.storage.connectionString,
        poolSize: config.storage.poolSize,
      });
      logger.info('storage.ready', { backend: 'postgres' });
    } else {
      const dbPath = resolve(instanceDir, config.storage?.path ?? './data/nexora.db');
      storageBackend = await createStorageBackend({ type: 'sqlite', path: dbPath });
      logger.info('storage.ready', { backend: 'sqlite', path: dbPath });
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
    });

    // --- Plugin lifecycle ---
    const lifecycle = new PluginLifecycleManager({
      permissionGate,
      configResolver,
      toolDispatcher,
      skillHandlerFactory,
      skillRegistry,
      commandRegistry,
      mcpManager,
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
          lifecycle.setCommandDefinitions(result.plugin.manifest.namespace, result.commandDefinitions);
        }
        if (result.mcpServerConfigs.length > 0) {
          lifecycle.setMcpConfigs(result.plugin.manifest.namespace, result.mcpServerConfigs);
        }
        lifecycle.registerPluginDir(result.plugin.manifest.namespace, pluginsDir);
        lifecycle.enable(result.plugin.manifest.namespace);
      }
    } catch {
      // Plugins dir may not exist yet — that's fine
    }

    // Sync registered commands into the parser so isCommand() works
    commandDispatcher.syncFromRegistry();

    // --- Agent Loop ---
    const agentLoop = new AgentLoop({
      llm: llmProvider,
      contextManager: new ContextManager(),
      toolDispatcher,
      messageStore,
      commandDispatcher,
    });

    // --- Auth ---
    const auth = buildAuth(config, logger);

    // --- Admin ---
    const auditLogger = new AuditLogger(auditEventStore);
    const usageAnalytics = new UsageAnalytics(usageEventStore);
    const adminService = new AdminService({
      plugins: lifecycle,
      auditLogger,
      usageAnalytics,
    });

    // --- Gateway ---
    const gateway = new Gateway({
      port,
      host,
      agentLoop,
      auth,
      conversationStore: storageBackend.conversationStore,
      messageStore: storageBackend.messageStore,
      plugins: lifecycle,
      admin: adminService,
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
      await storageBackend.close();
      logger.info('server.stopped', {});
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  },
};

function buildAuth(config: InstanceConfig, logger: { warn: (msg: string, data: Record<string, unknown>) => void }): ApiKeyAuth {
  if (!config.auth?.keys) {
    logger.warn('auth.using_dev_key', { message: 'No auth.keys configured — using insecure fallback dev-key. Do NOT use in production.' });
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
