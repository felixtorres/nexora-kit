/**
 * Regression monitor for deployed optimized prompts.
 *
 * Periodically calculates a 7-day rolling average score for each active
 * optimized prompt and auto-rolls back if the score drops below the
 * original score minus a configurable threshold.
 */

export interface RegressionMonitorStore {
  /** Get all active optimized prompts. */
  queryActive(): { id: string; componentName: string; componentType: string; score: number; botId: string | null }[]
    | Promise<{ id: string; componentName: string; componentType: string; score: number; botId: string | null }[]>;
  /** Update the rolling score for an optimized prompt. */
  updateRollingScore(id: string, score: number): void | Promise<void>;
  /** Roll back (set status to 'rolled_back'). */
  rollback(id: string): void | Promise<void>;
}

export interface RegressionTraceStore {
  /** Get average score for traces related to a component in the last N days. */
  averageScore(componentName: string, botId: string | null, days: number): number | null | Promise<number | null>;
}

export interface RegressionMonitorConfig {
  promptStore: RegressionMonitorStore;
  traceStore: RegressionTraceStore;
  /** Score drop (0.0–1.0) from original that triggers auto-rollback. Default: 0.05 */
  regressionThreshold?: number;
  /** Rolling window in days. Default: 7 */
  windowDays?: number;
  /** Callback when a rollback is triggered. */
  onRollback?: (promptId: string, componentName: string, rollingScore: number, originalScore: number) => void;
}

export class RegressionMonitor {
  private readonly promptStore: RegressionMonitorStore;
  private readonly traceStore: RegressionTraceStore;
  private readonly threshold: number;
  private readonly windowDays: number;
  private readonly onRollback: RegressionMonitorConfig['onRollback'];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RegressionMonitorConfig) {
    this.promptStore = config.promptStore;
    this.traceStore = config.traceStore;
    this.threshold = config.regressionThreshold ?? 0.05;
    this.windowDays = config.windowDays ?? 7;
    this.onRollback = config.onRollback;
  }

  /**
   * Run a single check cycle: calculate rolling scores and auto-rollback if needed.
   * Returns the number of prompts that were rolled back.
   */
  async check(): Promise<number> {
    const activePrompts = await this.promptStore.queryActive();
    let rollbacks = 0;

    for (const prompt of activePrompts) {
      const avg = await this.traceStore.averageScore(prompt.componentName, prompt.botId, this.windowDays);

      if (avg === null) {
        // Not enough recent traces — skip
        continue;
      }

      // Update rolling score
      await this.promptStore.updateRollingScore(prompt.id, avg);

      // Check regression
      const dropThreshold = prompt.score - this.threshold;
      if (avg < dropThreshold) {
        await this.promptStore.rollback(prompt.id);
        rollbacks++;
        this.onRollback?.(prompt.id, prompt.componentName, avg, prompt.score);
      }
    }

    return rollbacks;
  }

  /**
   * Start periodic monitoring.
   * @param intervalMs Check interval in milliseconds. Default: 1 hour.
   */
  start(intervalMs = 3_600_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.check();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }
}
