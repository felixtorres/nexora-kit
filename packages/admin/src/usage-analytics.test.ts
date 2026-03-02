import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema, SqliteUsageEventStore } from '@nexora-kit/storage';
import { UsageAnalytics } from './usage-analytics.js';

describe('UsageAnalytics', () => {
  let db: Database.Database;
  let store: SqliteUsageEventStore;
  let analytics: UsageAnalytics;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteUsageEventStore(db);
    analytics = new UsageAnalytics(store);
  });

  afterEach(() => {
    db.close();
  });

  it('summarizes usage by plugin', async () => {
    store.insert({ pluginName: 'plugin-a', inputTokens: 100, outputTokens: 50, latencyMs: 200 });
    store.insert({ pluginName: 'plugin-a', inputTokens: 200, outputTokens: 100, latencyMs: 300 });
    store.insert({ pluginName: 'plugin-b', inputTokens: 50, outputTokens: 25 });

    const summaries = await analytics.summarizeByPlugin();
    expect(summaries).toHaveLength(2);

    const a = summaries.find((s) => s.pluginName === 'plugin-a')!;
    expect(a.totalInputTokens).toBe(300);
    expect(a.totalOutputTokens).toBe(150);
    expect(a.totalTokens).toBe(450);
    expect(a.requestCount).toBe(2);
    expect(a.avgLatencyMs).toBe(250);

    const b = summaries.find((s) => s.pluginName === 'plugin-b')!;
    expect(b.totalTokens).toBe(75);
    expect(b.avgLatencyMs).toBeNull();
  });

  it('filters by user', async () => {
    store.insert({ pluginName: 'p', userId: 'u1', inputTokens: 100, outputTokens: 50 });
    store.insert({ pluginName: 'p', userId: 'u2', inputTokens: 200, outputTokens: 100 });

    const summaries = await analytics.summarizeByPlugin({ userId: 'u1' });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].totalInputTokens).toBe(100);
  });

  it('returns daily breakdown', async () => {
    store.insert({ pluginName: 'p', inputTokens: 100, outputTokens: 50 });
    store.insert({ pluginName: 'p', inputTokens: 200, outputTokens: 100 });

    const daily = await analytics.dailyBreakdown();
    expect(daily).toHaveLength(1);
    expect(daily[0].inputTokens).toBe(300);
    expect(daily[0].requestCount).toBe(2);
  });

  it('calculates total tokens', async () => {
    store.insert({ pluginName: 'a', inputTokens: 100, outputTokens: 50 });
    store.insert({ pluginName: 'b', inputTokens: 200, outputTokens: 100 });

    expect(await analytics.totalTokens()).toBe(450);
  });

  it('returns empty for no data', async () => {
    expect(await analytics.summarizeByPlugin()).toEqual([]);
    expect(await analytics.dailyBreakdown()).toEqual([]);
    expect(await analytics.totalTokens()).toBe(0);
  });
});
