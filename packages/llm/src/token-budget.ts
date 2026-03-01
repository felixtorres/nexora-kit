export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type BudgetResult =
  | { allowed: true }
  | { allowed: false; reason: string; limit: number; used: number };

export interface TokenBudgetOptions {
  /** Default monthly token limit for this instance */
  defaultInstanceLimit?: number;
  /** Default monthly token limit per plugin */
  defaultPluginLimit?: number;
}

interface BudgetEntry {
  used: number;
  limit: number;
  periodStart: Date;
}

export class TokenBudget {
  private instanceBudget: BudgetEntry | null = null;
  private pluginBudgets = new Map<string, BudgetEntry>();
  private defaultInstanceLimit: number;
  private defaultPluginLimit: number;

  constructor(options: TokenBudgetOptions = {}) {
    this.defaultInstanceLimit = options.defaultInstanceLimit ?? 10_000_000;
    this.defaultPluginLimit = options.defaultPluginLimit ?? 2_000_000;
  }

  check(pluginNamespace: string, estimatedTokens: number): BudgetResult {
    const instanceEntry = this.getOrCreateInstanceEntry();
    if (instanceEntry.used + estimatedTokens > instanceEntry.limit) {
      return {
        allowed: false,
        reason: 'Instance budget exceeded',
        limit: instanceEntry.limit,
        used: instanceEntry.used,
      };
    }

    const pluginEntry = this.getOrCreatePluginEntry(pluginNamespace);
    if (pluginEntry.used + estimatedTokens > pluginEntry.limit) {
      return {
        allowed: false,
        reason: `Plugin '${pluginNamespace}' budget exceeded`,
        limit: pluginEntry.limit,
        used: pluginEntry.used,
      };
    }

    return { allowed: true };
  }

  consume(pluginNamespace: string, usage: TokenUsage): void {
    const total = usage.inputTokens + usage.outputTokens;
    const instanceEntry = this.getOrCreateInstanceEntry();
    instanceEntry.used += total;

    const pluginEntry = this.getOrCreatePluginEntry(pluginNamespace);
    pluginEntry.used += total;
  }

  setInstanceLimit(limit: number): void {
    const entry = this.getOrCreateInstanceEntry();
    entry.limit = limit;
  }

  setPluginLimit(pluginNamespace: string, limit: number): void {
    const entry = this.getOrCreatePluginEntry(pluginNamespace);
    entry.limit = limit;
  }

  getInstanceUsage(): { used: number; limit: number } {
    const entry = this.getOrCreateInstanceEntry();
    return { used: entry.used, limit: entry.limit };
  }

  private getOrCreateInstanceEntry(): BudgetEntry {
    if (!this.instanceBudget || this.isExpired(this.instanceBudget)) {
      this.instanceBudget = { used: 0, limit: this.defaultInstanceLimit, periodStart: this.periodStart() };
    }
    return this.instanceBudget;
  }

  private getOrCreatePluginEntry(key: string): BudgetEntry {
    let entry = this.pluginBudgets.get(key);
    if (!entry || this.isExpired(entry)) {
      entry = { used: 0, limit: this.defaultPluginLimit, periodStart: this.periodStart() };
      this.pluginBudgets.set(key, entry);
    }
    return entry;
  }

  private isExpired(entry: BudgetEntry): boolean {
    const now = new Date();
    return now.getMonth() !== entry.periodStart.getMonth() ||
      now.getFullYear() !== entry.periodStart.getFullYear();
  }

  private periodStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}
