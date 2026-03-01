import { describe, it, expect } from 'vitest';
import { ResourceLimiter } from './resource-limiter.js';

describe('ResourceLimiter', () => {
  it('allows execution when under capacity', () => {
    const limiter = new ResourceLimiter(3);
    expect(limiter.canExecute()).toBe(true);
    expect(limiter.active).toBe(0);
  });

  it('tracks active executions', () => {
    const limiter = new ResourceLimiter(3);
    const slot1 = limiter.acquire();
    const slot2 = limiter.acquire();
    expect(limiter.active).toBe(2);
    slot1?.release();
    expect(limiter.active).toBe(1);
    slot2?.release();
    expect(limiter.active).toBe(0);
  });

  it('denies when at capacity', () => {
    const limiter = new ResourceLimiter(2);
    limiter.acquire();
    limiter.acquire();
    expect(limiter.canExecute()).toBe(false);
    expect(limiter.acquire()).toBeNull();
  });

  it('allows again after release', () => {
    const limiter = new ResourceLimiter(1);
    const slot = limiter.acquire();
    expect(limiter.acquire()).toBeNull();
    slot?.release();
    expect(limiter.acquire()).not.toBeNull();
  });

  it('reports capacity', () => {
    const limiter = new ResourceLimiter(5);
    expect(limiter.capacity).toBe(5);
  });
});
