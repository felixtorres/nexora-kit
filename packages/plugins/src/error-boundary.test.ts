import { describe, it, expect, vi } from 'vitest';
import { wrapWithErrorBoundary } from './error-boundary.js';

describe('wrapWithErrorBoundary', () => {
  it('passes through successful calls', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    const wrapped = wrapWithErrorBoundary('test-tool', handler);
    const result = await wrapped({ key: 'value' });
    expect(result).toBe('ok');
    expect(handler).toHaveBeenCalledWith({ key: 'value' });
  });

  it('resets failure count on success', async () => {
    let callCount = 0;
    const handler = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 3) throw new Error('fail');
      return 'ok';
    });
    const wrapped = wrapWithErrorBoundary('test-tool', handler, { maxConsecutiveFailures: 5 });

    // 3 failures, then success
    for (let i = 0; i < 3; i++) {
      await expect(wrapped({})).rejects.toThrow('fail');
    }
    const result = await wrapped({});
    expect(result).toBe('ok');
  });

  it('disables after max consecutive failures', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('broken'));
    const onDisable = vi.fn();
    const wrapped = wrapWithErrorBoundary('test-tool', handler, {
      maxConsecutiveFailures: 3,
      onDisable,
    });

    for (let i = 0; i < 3; i++) {
      await expect(wrapped({})).rejects.toThrow('broken');
    }

    expect(onDisable).toHaveBeenCalledWith('test-tool', 'broken');
    await expect(wrapped({})).rejects.toThrow('disabled');
  });

  it('uses default of 5 max failures', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('fail'));
    const wrapped = wrapWithErrorBoundary('test-tool', handler);

    for (let i = 0; i < 4; i++) {
      await expect(wrapped({})).rejects.toThrow('fail');
    }
    // 5th failure triggers disable
    await expect(wrapped({})).rejects.toThrow('fail');
    // 6th should be disabled
    await expect(wrapped({})).rejects.toThrow('disabled');
  });

  it('propagates original error before disable', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('specific error'));
    const wrapped = wrapWithErrorBoundary('test-tool', handler, { maxConsecutiveFailures: 2 });

    await expect(wrapped({})).rejects.toThrow('specific error');
    await expect(wrapped({})).rejects.toThrow('specific error');
    // Now disabled
    await expect(wrapped({})).rejects.toThrow('disabled');
  });

  it('handles non-Error thrown values', async () => {
    const handler = vi.fn().mockRejectedValue('string error');
    const onDisable = vi.fn();
    const wrapped = wrapWithErrorBoundary('test-tool', handler, {
      maxConsecutiveFailures: 1,
      onDisable,
    });

    await expect(wrapped({})).rejects.toBe('string error');
    expect(onDisable).toHaveBeenCalledWith('test-tool', 'string error');
  });

  it('includes tool name in disabled message', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('fail'));
    const wrapped = wrapWithErrorBoundary('my-special-tool', handler, { maxConsecutiveFailures: 1 });

    await expect(wrapped({})).rejects.toThrow('fail');
    await expect(wrapped({})).rejects.toThrow("'my-special-tool' is disabled");
  });
});
