import type { PluginLifecycleManager, LoadResult } from '@nexora-kit/plugins';
import { loadPlugin } from '@nexora-kit/plugins';
import { AuditLogger } from './audit-logger.js';
import type { UsageAnalytics, UsageSummary } from './usage-analytics.js';

export interface AdminServiceConfig {
  plugins: PluginLifecycleManager;
  auditLogger: AuditLogger;
  usageAnalytics: UsageAnalytics;
  auditRetentionDays?: number;
}

export class AdminService {
  private readonly plugins: PluginLifecycleManager;
  private readonly audit: AuditLogger;
  private readonly usage: UsageAnalytics;
  private readonly retentionDays: number;

  constructor(config: AdminServiceConfig) {
    this.plugins = config.plugins;
    this.audit = config.auditLogger;
    this.usage = config.usageAnalytics;
    this.retentionDays = config.auditRetentionDays ?? 90;
  }

  /** Install a plugin from a local directory */
  installPlugin(actor: string, pluginDir: string): LoadResult {
    const result = loadPlugin(pluginDir);

    if (result.errors.length > 0) {
      this.audit.logFailure(
        actor,
        'plugin.install',
        `plugin:${result.plugin.manifest.namespace || 'unknown'}`,
        result.errors.join('; '),
      );
      return result;
    }

    this.plugins.install(result.plugin);
    this.audit.logPluginInstall(actor, result.plugin.manifest.namespace, {
      version: result.plugin.manifest.version,
      name: result.plugin.manifest.name,
    });

    return result;
  }

  /** Enable a plugin */
  enablePlugin(actor: string, namespace: string): void {
    const plugin = this.plugins.getPlugin(namespace);
    if (!plugin) {
      this.audit.logFailure(actor, 'plugin.enable', `plugin:${namespace}`, 'Plugin not found');
      throw new Error(`Plugin not found: ${namespace}`);
    }

    try {
      this.plugins.enable(namespace);
      this.audit.logPluginEnable(actor, namespace);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.audit.logFailure(actor, 'plugin.enable', `plugin:${namespace}`, msg);
      throw error;
    }
  }

  /** Disable a plugin */
  disablePlugin(actor: string, namespace: string): void {
    const plugin = this.plugins.getPlugin(namespace);
    if (!plugin) {
      this.audit.logFailure(actor, 'plugin.disable', `plugin:${namespace}`, 'Plugin not found');
      throw new Error(`Plugin not found: ${namespace}`);
    }

    try {
      this.plugins.disable(namespace);
      this.audit.logPluginDisable(actor, namespace);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.audit.logFailure(actor, 'plugin.disable', `plugin:${namespace}`, msg);
      throw error;
    }
  }

  /** Uninstall a plugin */
  uninstallPlugin(actor: string, namespace: string): void {
    const plugin = this.plugins.getPlugin(namespace);
    if (!plugin) {
      this.audit.logFailure(actor, 'plugin.uninstall', `plugin:${namespace}`, 'Plugin not found');
      throw new Error(`Plugin not found: ${namespace}`);
    }

    try {
      this.plugins.uninstall(namespace);
      this.audit.logPluginUninstall(actor, namespace);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.audit.logFailure(actor, 'plugin.uninstall', `plugin:${namespace}`, msg);
      throw error;
    }
  }

  /** Get usage analytics per plugin */
  async getUsageSummary(since?: string): Promise<UsageSummary[]> {
    return this.usage.summarizeByPlugin(since ? { since } : undefined);
  }

  /** Purge old audit events */
  async purgeAuditLog(retentionDays = this.retentionDays): Promise<number> {
    return await this.audit.purge(retentionDays);
  }

  get auditLogger(): AuditLogger {
    return this.audit;
  }

  get usageAnalytics(): UsageAnalytics {
    return this.usage;
  }
}
