import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rate-limit.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.stopCleanup();
  });

  it('allows requests within limit', () => {
    limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });
    const r1 = limiter.check('user1');
    const r2 = limiter.check('user1');
    const r3 = limiter.check('user1');

    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it('denies requests over limit', () => {
    limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    limiter.check('user1');
    limiter.check('user1');
    const r3 = limiter.check('user1');

    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.resetMs).toBeGreaterThan(0);
  });

  it('tracks keys independently', () => {
    limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
    const r1 = limiter.check('user1');
    const r2 = limiter.check('user2');

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });

  it('allows requests after window expires', () => {
    vi.useFakeTimers();
    limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1 });

    limiter.check('user1');
    const denied = limiter.check('user1');
    expect(denied.allowed).toBe(false);

    vi.advanceTimersByTime(1001);
    const allowed = limiter.check('user1');
    expect(allowed.allowed).toBe(true);

    vi.useRealTimers();
  });

  it('reports count for monitoring', () => {
    limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 10 });
    expect(limiter.getCount('user1')).toBe(0);

    limiter.check('user1');
    limiter.check('user1');
    expect(limiter.getCount('user1')).toBe(2);
  });

  it('resets a specific key', () => {
    limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
    limiter.check('user1');
    limiter.check('user2');

    limiter.reset('user1');
    expect(limiter.getCount('user1')).toBe(0);
    expect(limiter.getCount('user2')).toBe(1);
  });

  it('resets all keys', () => {
    limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
    limiter.check('user1');
    limiter.check('user2');

    limiter.reset();
    expect(limiter.getCount('user1')).toBe(0);
    expect(limiter.getCount('user2')).toBe(0);
  });

  it('cleanup removes expired windows', () => {
    vi.useFakeTimers();
    limiter = new RateLimiter({ windowMs: 100, maxRequests: 10 });

    limiter.check('user1');
    vi.advanceTimersByTime(200);

    limiter.startCleanup(50);
    vi.advanceTimersByTime(51);

    expect(limiter.getCount('user1')).toBe(0);

    vi.useRealTimers();
  });
});
