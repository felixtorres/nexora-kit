import type { SqliteUsageEventStore, UsageEventFilter } from '@nexora-kit/storage';

export interface UsageSummary {
  pluginName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  requestCount: number;
  avgLatencyMs: number | null;
}

export interface DailyUsage {
  date: string;
  pluginName: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
}

export class UsageAnalytics {
  private readonly store: SqliteUsageEventStore;

  constructor(store: SqliteUsageEventStore) {
    this.store = store;
  }

  /** Aggregate usage by plugin */
  summarizeByPlugin(filter?: Omit<UsageEventFilter, 'limit'>): UsageSummary[] {
    const events = this.store.query(filter);

    const map = new Map<string, {
      inputTokens: number;
      outputTokens: number;
      count: number;
      totalLatency: number;
      latencyCount: number;
    }>();

    for (const event of events) {
      const entry = map.get(event.pluginName) ?? {
        inputTokens: 0,
        outputTokens: 0,
        count: 0,
        totalLatency: 0,
        latencyCount: 0,
      };

      entry.inputTokens += event.inputTokens;
      entry.outputTokens += event.outputTokens;
      entry.count++;
      if (event.latencyMs != null) {
        entry.totalLatency += event.latencyMs;
        entry.latencyCount++;
      }

      map.set(event.pluginName, entry);
    }

    return Array.from(map.entries()).map(([pluginName, entry]) => ({
      pluginName,
      totalInputTokens: entry.inputTokens,
      totalOutputTokens: entry.outputTokens,
      totalTokens: entry.inputTokens + entry.outputTokens,
      requestCount: entry.count,
      avgLatencyMs: entry.latencyCount > 0 ? Math.round(entry.totalLatency / entry.latencyCount) : null,
    }));
  }

  /** Aggregate usage by day and plugin */
  dailyBreakdown(filter?: Omit<UsageEventFilter, 'limit'>): DailyUsage[] {
    const events = this.store.query(filter);

    const map = new Map<string, {
      inputTokens: number;
      outputTokens: number;
      count: number;
    }>();

    for (const event of events) {
      const date = event.createdAt?.split('T')[0] ?? event.createdAt?.split(' ')[0] ?? 'unknown';
      const key = `${date}|${event.pluginName}`;
      const entry = map.get(key) ?? { inputTokens: 0, outputTokens: 0, count: 0 };

      entry.inputTokens += event.inputTokens;
      entry.outputTokens += event.outputTokens;
      entry.count++;

      map.set(key, entry);
    }

    return Array.from(map.entries())
      .map(([key, entry]) => {
        const [date, pluginName] = key.split('|');
        return {
          date,
          pluginName,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          requestCount: entry.count,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Get total token count across all plugins */
  totalTokens(filter?: Omit<UsageEventFilter, 'limit'>): number {
    const summaries = this.summarizeByPlugin(filter);
    return summaries.reduce((sum, s) => sum + s.totalTokens, 0);
  }
}
