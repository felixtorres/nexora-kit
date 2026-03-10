import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RegressionMonitor, type RegressionMonitorStore, type RegressionTraceStore } from './regression-monitor.js';

function createMockStores(prompts: { id: string; componentName: string; componentType: string; score: number; botId: string | null }[] = []) {
  const rollbacks: string[] = [];
  const rollingScores: { id: string; score: number }[] = [];

  const promptStore: RegressionMonitorStore = {
    queryActive: vi.fn(() => prompts),
    updateRollingScore: vi.fn((id: string, score: number) => { rollingScores.push({ id, score }); }),
    rollback: vi.fn((id: string) => { rollbacks.push(id); }),
  };

  const scores = new Map<string, number | null>();
  const traceStore: RegressionTraceStore = {
    averageScore: vi.fn((componentName: string, botId: string | null) => {
      const key = botId ? `${componentName}:${botId}` : componentName;
      return scores.get(key) ?? null;
    }),
  };

  return { promptStore, traceStore, rollbacks, rollingScores, scores };
}

describe('RegressionMonitor', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does nothing when no active prompts', async () => {
    const { promptStore, traceStore } = createMockStores([]);
    const monitor = new RegressionMonitor({ promptStore, traceStore });

    const count = await monitor.check();
    expect(count).toBe(0);
  });

  it('skips prompts with no recent traces', async () => {
    const { promptStore, traceStore, rollbacks, rollingScores } = createMockStores([
      { id: 'p1', componentName: 'greeting-skill', componentType: 'skill', score: 0.8, botId: null },
    ]);
    // scores map is empty — averageScore returns null

    const monitor = new RegressionMonitor({ promptStore, traceStore });
    const count = await monitor.check();

    expect(count).toBe(0);
    expect(rollbacks).toHaveLength(0);
    expect(rollingScores).toHaveLength(0);
  });

  it('updates rolling score when average is above threshold', async () => {
    const { promptStore, traceStore, rollbacks, rollingScores, scores } = createMockStores([
      { id: 'p1', componentName: 'greeting-skill', componentType: 'skill', score: 0.8, botId: null },
    ]);
    scores.set('greeting-skill', 0.82); // Above 0.8 - 0.05 = 0.75

    const monitor = new RegressionMonitor({ promptStore, traceStore });
    const count = await monitor.check();

    expect(count).toBe(0);
    expect(rollbacks).toHaveLength(0);
    expect(rollingScores).toEqual([{ id: 'p1', score: 0.82 }]);
  });

  it('triggers rollback when score drops below threshold', async () => {
    const onRollback = vi.fn();
    const { promptStore, traceStore, rollbacks, scores } = createMockStores([
      { id: 'p1', componentName: 'greeting-skill', componentType: 'skill', score: 0.8, botId: null },
    ]);
    scores.set('greeting-skill', 0.7); // Below 0.8 - 0.05 = 0.75

    const monitor = new RegressionMonitor({ promptStore, traceStore, onRollback });
    const count = await monitor.check();

    expect(count).toBe(1);
    expect(rollbacks).toEqual(['p1']);
    expect(onRollback).toHaveBeenCalledWith('p1', 'greeting-skill', 0.7, 0.8);
  });

  it('does not roll back when score is at threshold boundary', async () => {
    const { promptStore, traceStore, rollbacks, scores } = createMockStores([
      { id: 'p1', componentName: 'skill-a', componentType: 'skill', score: 0.8, botId: null },
    ]);
    scores.set('skill-a', 0.75); // Exactly at 0.8 - 0.05 = 0.75

    const monitor = new RegressionMonitor({ promptStore, traceStore });
    const count = await monitor.check();

    expect(count).toBe(0);
    expect(rollbacks).toHaveLength(0);
  });

  it('handles bot-scoped prompts correctly', async () => {
    const { promptStore, traceStore, rollbacks, scores } = createMockStores([
      { id: 'p1', componentName: 'system-prompt', componentType: 'system_prompt', score: 0.9, botId: 'support-bot' },
    ]);
    scores.set('system-prompt:support-bot', 0.6); // Below threshold

    const monitor = new RegressionMonitor({ promptStore, traceStore });
    const count = await monitor.check();

    expect(count).toBe(1);
    expect(rollbacks).toEqual(['p1']);
    expect(traceStore.averageScore).toHaveBeenCalledWith('system-prompt', 'support-bot', 7);
  });

  it('uses custom threshold', async () => {
    const { promptStore, traceStore, rollbacks, scores } = createMockStores([
      { id: 'p1', componentName: 'skill-a', componentType: 'skill', score: 0.8, botId: null },
    ]);
    scores.set('skill-a', 0.72); // Below 0.8 - 0.1 = 0.7? No, 0.72 > 0.7

    const monitor = new RegressionMonitor({ promptStore, traceStore, regressionThreshold: 0.1 });
    const count = await monitor.check();

    expect(count).toBe(0);
    expect(rollbacks).toHaveLength(0);
  });

  it('handles multiple prompts with mixed results', async () => {
    const { promptStore, traceStore, rollbacks, rollingScores, scores } = createMockStores([
      { id: 'p1', componentName: 'skill-a', componentType: 'skill', score: 0.8, botId: null },
      { id: 'p2', componentName: 'skill-b', componentType: 'skill', score: 0.9, botId: null },
      { id: 'p3', componentName: 'skill-c', componentType: 'skill', score: 0.7, botId: null },
    ]);
    scores.set('skill-a', 0.82); // Fine
    scores.set('skill-b', 0.5);  // Regressed
    // skill-c has no scores (null)

    const monitor = new RegressionMonitor({ promptStore, traceStore });
    const count = await monitor.check();

    expect(count).toBe(1);
    expect(rollbacks).toEqual(['p2']);
    expect(rollingScores).toHaveLength(2); // p1 and p2 updated, p3 skipped
  });

  it('starts and stops periodic monitoring', () => {
    const { promptStore, traceStore } = createMockStores([]);
    const monitor = new RegressionMonitor({ promptStore, traceStore });

    expect(monitor.isRunning).toBe(false);
    monitor.start(60_000);
    expect(monitor.isRunning).toBe(true);

    // Should not start twice
    monitor.start(60_000);

    monitor.stop();
    expect(monitor.isRunning).toBe(false);
  });

  it('runs check periodically when started', async () => {
    const { promptStore, traceStore } = createMockStores([]);
    const monitor = new RegressionMonitor({ promptStore, traceStore });

    monitor.start(1000);

    vi.advanceTimersByTime(3500);
    // Should have called queryActive 3 times (at 1s, 2s, 3s)
    expect(promptStore.queryActive).toHaveBeenCalledTimes(3);

    monitor.stop();
  });
});
