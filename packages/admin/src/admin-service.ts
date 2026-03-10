import type { PluginLifecycleManager, LoadResult } from '@nexora-kit/plugins';
import { loadPlugin } from '@nexora-kit/plugins';
import type { PromptOptimizer, OptimizationResult } from '@nexora-kit/core';
import { AuditLogger } from './audit-logger.js';
import type { UsageAnalytics, UsageSummary } from './usage-analytics.js';
import type {
  IExecutionTraceStore,
  IOptimizedPromptStore,
  OptimizedPromptRecord,
  OptimizedPromptFilter,
  OptimizedPromptComponentType,
  ExecutionTraceFilter,
  ExecutionTraceRecord,
} from '@nexora-kit/storage';

export interface AdminServiceConfig {
  plugins: PluginLifecycleManager;
  auditLogger: AuditLogger;
  usageAnalytics: UsageAnalytics;
  auditRetentionDays?: number;
  executionTraceStore?: IExecutionTraceStore;
  optimizedPromptStore?: IOptimizedPromptStore;
  promptOptimizer?: PromptOptimizer;
}

export class AdminService {
  private readonly plugins: PluginLifecycleManager;
  private readonly audit: AuditLogger;
  private readonly usage: UsageAnalytics;
  private readonly retentionDays: number;
  private readonly traceStore: IExecutionTraceStore | null;
  private readonly promptStore: IOptimizedPromptStore | null;
  private readonly optimizer: PromptOptimizer | null;

  constructor(config: AdminServiceConfig) {
    this.plugins = config.plugins;
    this.audit = config.auditLogger;
    this.usage = config.usageAnalytics;
    this.retentionDays = config.auditRetentionDays ?? 90;
    this.traceStore = config.executionTraceStore ?? null;
    this.promptStore = config.optimizedPromptStore ?? null;
    this.optimizer = config.promptOptimizer ?? null;
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

  // --- Optimization methods ---

  /** Query optimization candidates */
  async listOptimizationCandidates(
    filter?: OptimizedPromptFilter,
  ): Promise<OptimizedPromptRecord[]> {
    if (!this.promptStore) throw new Error('Optimized prompt store not configured');
    return await this.promptStore.query(filter ?? { status: 'candidate' });
  }

  /** Approve an optimization candidate for deployment */
  async approveOptimization(actor: string, promptId: string): Promise<void> {
    if (!this.promptStore) throw new Error('Optimized prompt store not configured');

    const record = await this.promptStore.get(promptId);
    if (!record) {
      this.audit.logFailure(actor, 'optimization.approve', `prompt:${promptId}`, 'Prompt not found');
      throw new Error(`Optimized prompt not found: ${promptId}`);
    }

    try {
      // Deactivate any existing active prompt for this component
      const existing = await this.promptStore.getActive(
        record.componentType,
        record.componentName,
        record.botId ?? undefined,
      );
      if (existing) {
        await this.promptStore.updateStatus(existing.id, 'rolled_back');
      }

      await this.promptStore.updateStatus(promptId, 'active', actor);
      this.audit.logOptimizationApprove(actor, promptId, {
        componentType: record.componentType,
        componentName: record.componentName,
        scoreImprovement: record.scoreImprovement,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.audit.logFailure(actor, 'optimization.approve', `prompt:${promptId}`, msg);
      throw error;
    }
  }

  /** Roll back an optimized prompt to original */
  async rollbackOptimization(actor: string, promptId: string): Promise<void> {
    if (!this.promptStore) throw new Error('Optimized prompt store not configured');

    const record = await this.promptStore.get(promptId);
    if (!record) {
      this.audit.logFailure(actor, 'optimization.rollback', `prompt:${promptId}`, 'Prompt not found');
      throw new Error(`Optimized prompt not found: ${promptId}`);
    }

    try {
      await this.promptStore.updateStatus(promptId, 'rolled_back');
      this.audit.logOptimizationRollback(actor, promptId, {
        componentType: record.componentType,
        componentName: record.componentName,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.audit.logFailure(actor, 'optimization.rollback', `prompt:${promptId}`, msg);
      throw error;
    }
  }

  /** Get optimization readiness for a component */
  async getOptimizationReadiness(
    componentType: OptimizedPromptComponentType,
    componentName: string,
    botId?: string,
    minTraces = 20,
  ): Promise<{ ready: boolean; traceCount: number; negativeCount: number; minRequired: number }> {
    if (!this.traceStore) throw new Error('Execution trace store not configured');

    const filter: ExecutionTraceFilter = { skillName: componentName };
    if (botId) filter.botId = botId;

    const traceCount = await this.traceStore.count({ ...filter, hasScore: true });
    const negativeCount = await this.traceStore.count({ ...filter, hasNegativeScore: true });

    return {
      ready: traceCount >= minTraces && negativeCount >= 3,
      traceCount,
      negativeCount,
      minRequired: minTraces,
    };
  }

  /** Run optimization: fetch traces, call the LLM, store the candidate. */
  async runOptimization(
    actor: string,
    componentType: OptimizedPromptComponentType,
    componentName: string,
    currentPrompt: string,
    botId?: string,
  ): Promise<OptimizationResult & { candidateId: string }> {
    if (!this.optimizer) throw new Error('Prompt optimizer not configured');
    if (!this.traceStore) throw new Error('Execution trace store not configured');
    if (!this.promptStore) throw new Error('Optimized prompt store not configured');

    // Fetch scored traces for this component
    const filter: ExecutionTraceFilter = { skillName: componentName, hasScore: true };
    if (botId) filter.botId = botId;
    const traces = await this.traceStore.query(filter);

    const scoredTraces = traces
      .filter((t) => t.score !== null)
      .map((t) => ({
        prompt: t.prompt,
        finalAnswer: t.finalAnswer,
        score: t.score!,
        scoreFeedback: t.scoreFeedback ?? '',
        toolCalls: t.toolCalls.map((tc) => ({ name: tc.name, isError: tc.isError })),
      }));

    this.audit.logOptimizationStart(actor, componentType, componentName, {
      botId,
      traceCount: scoredTraces.length,
    });

    const result = await this.optimizer.optimize({
      currentPrompt,
      componentType,
      componentName,
      traces: scoredTraces,
    });

    // Store the candidate
    const candidateId = await this.promptStore.insert({
      componentType,
      componentName,
      botId,
      originalPrompt: currentPrompt,
      optimizedPrompt: result.optimizedPrompt,
      score: result.estimatedScore,
      scoreImprovement: result.scoreImprovement,
      reflectionLog: result.reflectionLog,
      optimizedForModel: 'default',
    });

    this.audit.logOptimizationComplete(actor, componentType, componentName, {
      candidateId,
      scoreImprovement: result.scoreImprovement,
      tracesAnalyzed: result.tracesAnalyzed,
    });

    return { ...result, candidateId };
  }

  /** Get traces for a component */
  async getTraces(filter?: ExecutionTraceFilter): Promise<ExecutionTraceRecord[]> {
    if (!this.traceStore) throw new Error('Execution trace store not configured');
    return await this.traceStore.query(filter);
  }

  get executionTraceStore(): IExecutionTraceStore | null {
    return this.traceStore;
  }

  get optimizedPromptStore(): IOptimizedPromptStore | null {
    return this.promptStore;
  }

  get auditLogger(): AuditLogger {
    return this.audit;
  }

  get usageAnalytics(): UsageAnalytics {
    return this.usage;
  }
}
