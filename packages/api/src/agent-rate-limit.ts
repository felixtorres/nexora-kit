import type { AgentRateLimits } from '@nexora-kit/core';

interface SlidingWindow {
  timestamps: number[];
}

export class AgentRateLimiter {
  private readonly messageWindows = new Map<string, SlidingWindow>();
  private readonly conversationWindows = new Map<string, SlidingWindow>();

  check(endUserId: string, limits: AgentRateLimits, metric: 'message' | 'conversation'): { allowed: boolean; retryAfterMs: number } {
    if (metric === 'message') {
      return this.checkWindow(
        this.messageWindows,
        endUserId,
        limits.messagesPerMinute,
        60_000,
      );
    }
    return this.checkWindow(
      this.conversationWindows,
      endUserId,
      limits.conversationsPerDay,
      86_400_000,
    );
  }

  private checkWindow(
    windows: Map<string, SlidingWindow>,
    key: string,
    maxRequests: number | undefined,
    windowMs: number,
  ): { allowed: boolean; retryAfterMs: number } {
    if (!maxRequests) return { allowed: true, retryAfterMs: 0 };

    const now = Date.now();
    const cutoff = now - windowMs;

    let window = windows.get(key);
    if (!window) {
      window = { timestamps: [] };
      windows.set(key, window);
    }

    // Prune old timestamps
    window.timestamps = window.timestamps.filter((t) => t > cutoff);

    if (window.timestamps.length >= maxRequests) {
      const oldest = window.timestamps[0];
      const retryAfterMs = oldest + windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
    }

    window.timestamps.push(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  cleanup(): void {
    const now = Date.now();
    const dayAgo = now - 86_400_000;

    for (const [key, w] of this.messageWindows) {
      w.timestamps = w.timestamps.filter((t) => t > now - 60_000);
      if (w.timestamps.length === 0) this.messageWindows.delete(key);
    }
    for (const [key, w] of this.conversationWindows) {
      w.timestamps = w.timestamps.filter((t) => t > dayAgo);
      if (w.timestamps.length === 0) this.conversationWindows.delete(key);
    }
  }
}
