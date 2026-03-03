import { describe, it, expect } from 'vitest';
import { AgentRateLimiter } from './agent-rate-limit.js';

describe('AgentRateLimiter', () => {
  it('allows requests under the limit', () => {
    const limiter = new AgentRateLimiter();
    const limits = { messagesPerMinute: 5 };

    for (let i = 0; i < 5; i++) {
      const result = limiter.check('user-1', limits, 'message');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks when limit is exceeded', () => {
    const limiter = new AgentRateLimiter();
    const limits = { messagesPerMinute: 3 };

    for (let i = 0; i < 3; i++) {
      limiter.check('user-1', limits, 'message');
    }

    const result = limiter.check('user-1', limits, 'message');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('tracks users independently', () => {
    const limiter = new AgentRateLimiter();
    const limits = { messagesPerMinute: 2 };

    limiter.check('user-1', limits, 'message');
    limiter.check('user-1', limits, 'message');

    // user-1 is at limit
    expect(limiter.check('user-1', limits, 'message').allowed).toBe(false);

    // user-2 is fine
    expect(limiter.check('user-2', limits, 'message').allowed).toBe(true);
  });

  it('allows when no limit configured', () => {
    const limiter = new AgentRateLimiter();
    const limits = {};

    for (let i = 0; i < 100; i++) {
      expect(limiter.check('user-1', limits, 'message').allowed).toBe(true);
    }
  });

  it('tracks conversations separately from messages', () => {
    const limiter = new AgentRateLimiter();
    const limits = { messagesPerMinute: 2, conversationsPerDay: 1 };

    // Use up conversation limit
    limiter.check('user-1', limits, 'conversation');
    expect(limiter.check('user-1', limits, 'conversation').allowed).toBe(false);

    // Messages still allowed
    expect(limiter.check('user-1', limits, 'message').allowed).toBe(true);
  });

  it('cleanup removes stale entries', () => {
    const limiter = new AgentRateLimiter();
    const limits = { messagesPerMinute: 1 };

    limiter.check('user-1', limits, 'message');
    limiter.cleanup();

    // Still blocked (within window)
    expect(limiter.check('user-1', limits, 'message').allowed).toBe(false);
  });
});
