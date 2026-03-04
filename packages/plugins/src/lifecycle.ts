import type {
  PluginInstance,
  PluginState,
  PluginConfigField,
  ToolDefinition,
} from '@nexora-kit/core';
import type { ToolDispatcher, ToolHandler, Logger } from '@nexora-kit/core';
import type { PermissionGate, PermissionRule } from '@nexora-kit/sandbox';
import type { ConfigResolver } from '@nexora-kit/config';
import { ConfigLayer } from '@nexora-kit/config';
import type { SkillDefinition, SkillHandlerFactory, SkillRegistry } from '@nexora-kit/skills';
import type { CommandDefinition, CommandRegistry } from '@nexora-kit/commands';
import type { McpManager, McpServerConfig } from '@nexora-kit/mcp';
import { resolveDependencies } from './dependency.js';
import { wrapWithErrorBoundary } from './error-boundary.js';
import { loadPlugin } from './loader.js';

export interface LifecycleOptions {
  permissionGate: PermissionGate;
  configResolver: ConfigResolver;
  toolDispatcher: ToolDispatcher;
  toolHandlers?: Map<string, ToolHandler>;
  skillHandlerFactory?: SkillHandlerFactory;
  skillRegistry?: SkillRegistry;
  commandRegistry?: CommandRegistry;
  mcpManager?: McpManager;
  logger?: Logger;
}

export class PluginLifecycleManager {
  private plugins = new Map<string, PluginInstance>();
  private pluginSkills = new Map<string, Map<string, SkillDefinition>>();
  private pluginCommands = new Map<string, Map<string, CommandDefinition>>();
  private pluginMcpConfigs = new Map<string, McpServerConfig[]>();
  private pluginDirs = new Map<string, string>();
  private readonly permissionGate: PermissionGate;
  private readonly configResolver: ConfigResolver;
  private readonly toolDispatcher: ToolDispatcher;
  private readonly toolHandlers: Map<string, ToolHandler>;
  private readonly skillHandlerFactory?: SkillHandlerFactory;
  private readonly skillRegistry?: SkillRegistry;
  private readonly commandRegistry?: CommandRegistry;
  private readonly mcpManager?: McpManager;
  private readonly logger?: Logger;

  constructor(options: LifecycleOptions) {
    this.permissionGate = options.permissionGate;
    this.configResolver = options.configResolver;
    this.toolDispatcher = options.toolDispatcher;
    this.toolHandlers = options.toolHandlers ?? new Map();
    this.skillHandlerFactory = options.skillHandlerFactory;
    this.skillRegistry = options.skillRegistry;
    this.commandRegistry = options.commandRegistry;
    this.mcpManager = options.mcpManager;
    this.logger = options.logger;
  }

  install(plugin: PluginInstance): void {
    const ns = plugin.manifest.namespace;
    if (this.plugins.has(ns)) {
      throw new Error(`Plugin '${ns}' is already installed`);
    }
    this.plugins.set(ns, { ...plugin, state: 'installed' });
    this.logger?.info('plugin.installed', { namespace: ns, version: plugin.manifest.version });
  }

  enable(namespace: string): void {
    const plugin = this.plugins.get(namespace);
    if (!plugin) {
      throw new Error(`Plugin '${namespace}' is not installed`);
    }
    if (plugin.state === 'enabled') return;

    // Resolve dependencies
    const resolution = resolveDependencies(this.plugins);
    if (resolution.missing.some((m) => m.from === namespace)) {
      const missingDeps = resolution.missing
        .filter((m) => m.from === namespace)
        .map((m) => `${m.requires}@${m.version}`);
      throw new Error(
        `Cannot enable '${namespace}': missing dependencies: ${missingDeps.join(', ')}`,
      );
    }
    if (resolution.cycles.some((c) => c.includes(namespace))) {
      throw new Error(`Cannot enable '${namespace}': circular dependency detected`);
    }

    // Grant permissions
    for (const perm of plugin.manifest.permissions) {
      this.permissionGate.grant(namespace, perm as PermissionRule);
    }

    // Set config defaults
    if (plugin.manifest.config) {
      for (const [key, field] of Object.entries(plugin.manifest.config.schema) as [
        string,
        PluginConfigField,
      ][]) {
        if (field.default !== undefined) {
          this.configResolver.set(
            `${namespace}.${key}`,
            field.default,
            ConfigLayer.PluginDefaults,
            { pluginNamespace: namespace },
          );
        }
      }
    }

    // Register tools with error boundaries
    for (const tool of plugin.tools) {
      let baseHandler = this.toolHandlers.get(tool.name);

      // Auto-generate handlers for skills via the handler factory
      if (!baseHandler && this.skillHandlerFactory) {
        const skillDefs = this.pluginSkills.get(namespace);
        const skillDef = skillDefs?.get(tool.name);
        if (skillDef) {
          baseHandler = this.skillHandlerFactory.createHandler(tool.name, skillDef, namespace);
        }
      }

      if (baseHandler) {
        const wrappedHandler = wrapWithErrorBoundary(tool.name, baseHandler, {
          maxConsecutiveFailures: 5,
          onDisable: (toolName, errMsg) => {
            this.logger?.error('plugin.tool_disabled', { namespace, tool: toolName, err: errMsg });
            this.setState(namespace, 'errored', errMsg);
          },
        });
        this.toolDispatcher.register(tool, wrappedHandler);

        // Register in skill registry if available
        if (this.skillRegistry) {
          const skillDefs = this.pluginSkills.get(namespace);
          const skillDef = skillDefs?.get(tool.name);
          if (skillDef) {
            this.skillRegistry.register(tool.name, skillDef, namespace, wrappedHandler);
          }
        }
      } else {
        // Register a placeholder that returns an error
        this.toolDispatcher.register(tool, async () => {
          throw new Error(`No handler registered for tool '${tool.name}'`);
        });
      }
    }

    // Start MCP servers and register their tools
    if (this.mcpManager) {
      const mcpConfigs = this.pluginMcpConfigs.get(namespace);
      if (mcpConfigs && mcpConfigs.length > 0) {
        // MCP server startup is async — we fire-and-forget here but errors are caught
        void this.startMcpServers(namespace, mcpConfigs);
      }
    }

    // Register commands
    if (this.commandRegistry) {
      const cmdDefs = this.pluginCommands.get(namespace);
      if (cmdDefs) {
        for (const [, cmdDef] of cmdDefs) {
          this.commandRegistry.register(namespace, cmdDef);
          const qualifiedName = `${namespace}:${cmdDef.name}`;
          if (cmdDef.handler) {
            this.commandRegistry.registerHandler(qualifiedName, cmdDef.handler);
          } else if (cmdDef.prompt) {
            const template = cmdDef.prompt;
            this.commandRegistry.registerHandler(qualifiedName, async (ctx) => {
              const resolved = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
                return ctx.args[key] !== undefined ? String(ctx.args[key]) : `{{${key}}}`;
              });
              return { content: resolved, isPrompt: true };
            });
          }
        }
      }
    }

    this.setState(namespace, 'enabled');
  }

  disable(namespace: string): void {
    const plugin = this.plugins.get(namespace);
    if (!plugin) {
      throw new Error(`Plugin '${namespace}' is not installed`);
    }
    if (plugin.state === 'disabled' || plugin.state === 'installed') return;

    // Stop MCP servers
    if (this.mcpManager) {
      void this.mcpManager.stopServers(namespace);
    }

    // Unregister tools
    for (const tool of plugin.tools) {
      this.toolDispatcher.unregister(tool.name);
    }

    // Unregister skills
    if (this.skillRegistry) {
      this.skillRegistry.unregisterNamespace(namespace);
    }

    // Unregister commands
    if (this.commandRegistry) {
      this.commandRegistry.unregisterNamespace(namespace);
    }

    // Revoke permissions
    this.permissionGate.clearAll(namespace);

    this.setState(namespace, 'disabled');
    this.logger?.info('plugin.disabled', { namespace });
  }

  uninstall(namespace: string): void {
    const plugin = this.plugins.get(namespace);
    if (!plugin) {
      throw new Error(`Plugin '${namespace}' is not installed`);
    }

    // Disable first if enabled
    if (plugin.state === 'enabled') {
      this.disable(namespace);
    }

    this.plugins.delete(namespace);
    this.logger?.info('plugin.uninstalled', { namespace });
  }

  getPlugin(namespace: string): PluginInstance | undefined {
    return this.plugins.get(namespace);
  }

  listPlugins(): PluginInstance[] {
    return [...this.plugins.values()];
  }

  registerToolHandler(qualifiedName: string, handler: ToolHandler): void {
    this.toolHandlers.set(qualifiedName, handler);
  }

  setSkillDefinitions(namespace: string, skills: Map<string, SkillDefinition>): void {
    this.pluginSkills.set(namespace, skills);
  }

  setCommandDefinitions(namespace: string, commands: Map<string, CommandDefinition>): void {
    this.pluginCommands.set(namespace, commands);
  }

  setMcpConfigs(namespace: string, configs: McpServerConfig[]): void {
    this.pluginMcpConfigs.set(namespace, configs);
  }

  registerPluginDir(namespace: string, dir: string): void {
    this.pluginDirs.set(namespace, dir);
  }

  reload(namespace: string): import('./loader.js').LoadResult {
    const dir = this.pluginDirs.get(namespace);
    if (!dir) {
      throw new Error(`No plugin directory registered for '${namespace}'`);
    }

    const wasEnabled = this.plugins.get(namespace)?.state === 'enabled';

    // Uninstall existing
    if (this.plugins.has(namespace)) {
      this.uninstall(namespace);
    }

    // Re-load from disk
    const result = loadPlugin(dir);
    this.install(result.plugin);

    if (result.skillDefinitions.size > 0) {
      this.setSkillDefinitions(namespace, result.skillDefinitions);
    }

    if (result.commandDefinitions.size > 0) {
      this.setCommandDefinitions(namespace, result.commandDefinitions);
    }

    if (result.mcpServerConfigs.length > 0) {
      this.setMcpConfigs(namespace, result.mcpServerConfigs);
    }

    // Re-register the plugin dir
    this.pluginDirs.set(namespace, dir);

    // Re-enable if it was enabled before
    if (wasEnabled && result.plugin.state !== 'errored') {
      this.enable(namespace);
    }

    this.logger?.info('plugin.reloaded', { namespace });
    return result;
  }

  private async startMcpServers(namespace: string, configs: McpServerConfig[]): Promise<void> {
    if (!this.mcpManager) return;

    this.logger?.info('mcp.starting', {
      namespace,
      servers: configs.map((c) => ({ name: c.name, transport: c.transport })),
    });

    try {
      await this.mcpManager.startServers(namespace, configs);

      // Register MCP tools in the dispatcher
      const mcpTools = this.mcpManager.getTools(namespace);
      const plugin = this.plugins.get(namespace);

      this.logger?.info('mcp.started', {
        namespace,
        toolCount: mcpTools.length,
        tools: mcpTools.map((t) => t.definition.name),
      });

      for (const { definition, handler } of mcpTools) {
        const wrappedHandler = wrapWithErrorBoundary(definition.name, handler, {
          maxConsecutiveFailures: 5,
          onDisable: (toolName, errMsg) => {
            this.logger?.error('mcp.tool_disabled', { namespace, tool: toolName, err: errMsg });
            this.setState(namespace, 'errored', errMsg);
          },
        });
        this.toolDispatcher.register(definition, wrappedHandler, {
          namespace,
          requiredPermissions: ['mcp:connect'],
        });

        // Track the tool on the plugin instance
        if (plugin) {
          plugin.tools.push(definition);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger?.error('mcp.start_failed', { namespace, err: msg });
      this.setState(namespace, 'errored', `MCP server start failed: ${msg}`);
    }
  }

  private setState(namespace: string, state: PluginState, error?: string): void {
    const plugin = this.plugins.get(namespace);
    if (plugin) {
      const prev = plugin.state;
      plugin.state = state;
      plugin.error = error;
      if (prev !== state) {
        if (state === 'errored') {
          this.logger?.error('plugin.state_change', {
            namespace,
            from: prev,
            to: state,
            err: error,
          });
        } else {
          this.logger?.info('plugin.state_change', { namespace, from: prev, to: state });
        }
      }
    }
  }
}
