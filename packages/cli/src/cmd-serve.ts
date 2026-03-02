import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CliCommand } from './commands.js';
import { success, error, info, fmt } from './output.js';

import { AgentLoop, ContextManager, ToolDispatcher, InMemoryStore } from '@nexora-kit/core';
import { ConfigResolver } from '@nexora-kit/config';
import { PermissionGate } from '@nexora-kit/sandbox';
import { PluginLifecycleManager, discoverPlugins } from '@nexora-kit/plugins';
import { SkillRegistry, SkillHandlerFactory } from '@nexora-kit/skills';
import { CommandRegistry, CommandDispatcher } from '@nexora-kit/commands';
import { McpManager } from '@nexora-kit/mcp';
import {
  StorageDatabase, initSchema,
  SqliteMemoryStore, SqliteConfigStore,
  SqliteAuditEventStore, SqliteUsageEventStore,
  createStorageBackend,
  type StorageBackend,
} from '@nexora-kit/storage';
import { AuditLogger, UsageAnalytics, AdminService } from '@nexora-kit/admin';
import { Gateway, ApiKeyAuth } from '@nexora-kit/api';
import type { LlmProvider } from '@nexora-kit/llm';

interface InstanceConfig {
  name: string;
  port: number;
  host?: string;
  auth?: {
    type: 'api-key';
    keys: Array<{ key: string; userId: string; teamId: string; role: 'admin' | 'user' }>;
  };
  storage?: { backend?: 'sqlite' | 'postgres'; path?: string; connectionString?: string; poolSize?: number };
  plugins?: { directory?: string };
  sandbox?: { defaultTier?: 'none' | 'basic' | 'strict' };
  llm?: { provider?: string; apiKey?: string; model?: string };
  rateLimit?: { windowMs?: number; maxRequests?: number };
}

export const serveCommand: CliCommand = {
  name: 'serve',
  description: 'Start the NexoraKit instance',
  usage: 'nexora-kit serve [--config <path>] [--port <port>]',

  async run(args) {
    const configPath = resolve((args.flags['config'] as string) ?? 'nexora.yaml');

    try {
      await access(configPath);
    } catch {
      error(`Config file not found: ${configPath}`);
      error(`Run 'nexora-kit init' to create one.`);
      process.exitCode = 1;
      return;
    }

    const raw = await readFile(configPath, 'utf-8');
    const config: InstanceConfig = parseYaml(raw);

    const port = (args.flags['port'] as string) ? Number(args.flags['port']) : config.port ?? 3000;
    const host = (args.flags['host'] as string) ?? config.host ?? '127.0.0.1';
    const instanceDir = resolve(configPath, '..');

    info(`Starting ${fmt.bold(config.name ?? 'nexora-kit')} on ${host}:${port}`);

    // --- Storage ---
    let storageBackend: StorageBackend;
    if (config.storage?.backend === 'postgres' && config.storage.connectionString) {
      storageBackend = await createStorageBackend({
        type: 'postgres',
        connectionString: config.storage.connectionString,
        poolSize: config.storage.poolSize,
      });
      info('Using PostgreSQL storage backend');
    } else {
      const dbPath = resolve(instanceDir, config.storage?.path ?? './data/nexora.db');
      storageBackend = await createStorageBackend({ type: 'sqlite', path: dbPath });
    }

    const memoryStore = storageBackend.memoryStore;
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
    const mcpManager = new McpManager();

    // --- LLM provider (stub — users configure real providers via plugin or env) ---
    const llmProvider = createStubLlmProvider();

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
      mcpManager,
    });

    // --- Discover and install plugins ---
    const pluginsDir = resolve(instanceDir, config.plugins?.directory ?? './plugins');
    try {
      const results = discoverPlugins(pluginsDir);
      for (const result of results) {
        if (result.errors.length > 0) {
          for (const err of result.errors) {
            error(`Plugin load error: ${err}`);
          }
          continue;
        }
        lifecycle.install(result.plugin);
        if (result.skillDefinitions.size > 0) {
          lifecycle.setSkillDefinitions(result.plugin.manifest.namespace, result.skillDefinitions);
        }
        if (result.mcpServerConfigs.length > 0) {
          lifecycle.setMcpConfigs(result.plugin.manifest.namespace, result.mcpServerConfigs);
        }
        lifecycle.registerPluginDir(result.plugin.manifest.namespace, pluginsDir);
        lifecycle.enable(result.plugin.manifest.namespace);
        success(`Plugin loaded: ${result.plugin.manifest.namespace} (${result.plugin.tools.length} tools)`);
      }
    } catch {
      // Plugins dir may not exist yet — that's fine
    }

    // --- Agent Loop ---
    const agentLoop = new AgentLoop({
      llm: llmProvider,
      contextManager: new ContextManager(),
      toolDispatcher,
      memoryStore,
      commandDispatcher,
    });

    // --- Auth ---
    const auth = buildAuth(config);

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
      plugins: lifecycle,
      admin: adminService,
      rateLimit: config.rateLimit
        ? { windowMs: config.rateLimit.windowMs ?? 60_000, maxRequests: config.rateLimit.maxRequests ?? 100 }
        : undefined,
    });

    await gateway.start();

    const addr = gateway.getAddress();
    success(`Server running at http://${addr?.host ?? host}:${addr?.port ?? port}`);
    info(`Press Ctrl+C to stop`);

    // Graceful shutdown
    const shutdown = async () => {
      info('Shutting down...');
      await gateway.stop();
      await storageBackend.close();
      success('Stopped.');
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  },
};

function buildAuth(config: InstanceConfig): ApiKeyAuth {
  const keys = config.auth?.keys ?? [
    { key: 'dev-key', userId: 'dev', teamId: 'default', role: 'admin' as const },
  ];

  const keyRecord: Record<string, { userId: string; teamId: string; role: 'admin' | 'user' }> = {};
  for (const k of keys) {
    keyRecord[k.key] = { userId: k.userId, teamId: k.teamId, role: k.role };
  }
  return new ApiKeyAuth(keyRecord);
}

function createStubLlmProvider(): LlmProvider {
  return {
    name: 'stub',
    models: [{
      id: 'stub',
      name: 'Stub Provider',
      provider: 'stub',
      contextWindow: 100_000,
      maxOutputTokens: 4_096,
    }],
    async *chat() {
      yield { type: 'text' as const, content: 'LLM provider not configured. Set llm.provider in nexora.yaml.' };
    },
    async countTokens() {
      return 0;
    },
  };
}
