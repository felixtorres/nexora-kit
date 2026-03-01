import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in closed state', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('stays closed below failure threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('opens after reaching failure threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('resets consecutive failures on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getConsecutiveFailures()).toBe(0);
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
  });

  it('transitions from open to half-open after reset timeout', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(5000);
    expect(cb.getState()).toBe('half-open');
    expect(cb.canExecute()).toBe(true);
  });

  it('stays open before reset timeout elapses', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();

    vi.advanceTimersByTime(4999);
    expect(cb.getState()).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('transitions from half-open to closed after enough successes', () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 1000,
      halfOpenSuccesses: 2,
    });
    cb.recordFailure();
    cb.recordFailure();

    vi.advanceTimersByTime(1000);
    expect(cb.getState()).toBe('half-open');

    cb.recordSuccess();
    expect(cb.getState()).toBe('half-open');

    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.getConsecutiveFailures()).toBe(0);
  });

  it('transitions from half-open back to open on failure', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();

    vi.advanceTimersByTime(1000);
    expect(cb.getState()).toBe('half-open');

    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('reset() returns to initial state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.getConsecutiveFailures()).toBe(0);
    expect(cb.canExecute()).toBe(true);
  });

  it('uses default config values', () => {
    const cb = new CircuitBreaker();
    // Default threshold is 5
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('tracks consecutive failures accurately', () => {
    const cb = new CircuitBreaker({ failureThreshold: 10 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getConsecutiveFailures()).toBe(3);

    cb.recordSuccess();
    expect(cb.getConsecutiveFailures()).toBe(0);
  });
});
