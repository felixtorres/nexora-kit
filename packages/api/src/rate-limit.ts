import type { RateLimitConfig, RateLimitResult } from './types.js';

interface Window {
  timestamps: number[];
}

export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly windows = new Map<string, Window>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimitConfig) {
    this.windowMs = config.windowMs;
    this.maxRequests = config.maxRequests;
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let window = this.windows.get(key);
    if (!window) {
      window = { timestamps: [] };
      this.windows.set(key, window);
    }

    // Prune expired timestamps
    window.timestamps = window.timestamps.filter((t) => t > cutoff);

    if (window.timestamps.length >= this.maxRequests) {
      const oldestInWindow = window.timestamps[0];
      return {
        allowed: false,
        remaining: 0,
        resetMs: oldestInWindow + this.windowMs - now,
      };
    }

    window.timestamps.push(now);
    return {
      allowed: true,
      remaining: this.maxRequests - window.timestamps.length,
      resetMs: this.windowMs,
    };
  }

  /** Start periodic cleanup of expired windows (prevents memory leaks in long-running servers) */
  startCleanup(intervalMs: number = 60_000): void {
    this.stopCleanup();
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.windowMs;
      for (const [key, window] of this.windows) {
        window.timestamps = window.timestamps.filter((t) => t > cutoff);
        if (window.timestamps.length === 0) {
          this.windows.delete(key);
        }
      }
    }, intervalMs);
    // Don't keep process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Get current window count for a key (for testing/monitoring) */
  getCount(key: string): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const window = this.windows.get(key);
    if (!window) return 0;
    return window.timestamps.filter((t) => t > cutoff).length;
  }

  reset(key?: string): void {
    if (key) {
      this.windows.delete(key);
    } else {
      this.windows.clear();
    }
  }
}
