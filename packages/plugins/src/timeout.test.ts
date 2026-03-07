import { describe, it, expect } from 'vitest';
import { wrapWithTimeout, getTimeoutForTier } from './timeout.js';
import type { ToolHandler } from '@nexora-kit/core';

describe('getTimeoutForTier', () => {
  it('returns 0 for tier none', () => {
    expect(getTimeoutForTier('none')).toBe(0);
  });

  it('returns 30s for tier basic', () => {
    expect(getTimeoutForTier('basic')).toBe(30_000);
  });

  it('returns 5s for tier strict', () => {
    expect(getTimeoutForTier('strict')).toBe(5_000);
  });

  it('uses explicit timeoutMs over tier default', () => {
    expect(getTimeoutForTier('basic', 10_000)).toBe(10_000);
    expect(getTimeoutForTier('strict', 60_000)).toBe(60_000);
  });
});

describe('wrapWithTimeout', () => {
  it('passes through result when handler completes in time', async () => {
    const handler: ToolHandler = async () => 'ok';
    const wrapped = wrapWithTimeout('test', handler, 1000);
    const result = await wrapped({});
    expect(result).toBe('ok');
  });

  it('returns handler directly when timeoutMs is 0', () => {
    const handler: ToolHandler = async () => 'ok';
    const wrapped = wrapWithTimeout('test', handler, 0);
    expect(wrapped).toBe(handler);
  });

  it('throws timeout error when handler exceeds limit', async () => {
    const handler: ToolHandler = async () => {
      await new Promise((r) => setTimeout(r, 500));
      return 'too late';
    };
    const wrapped = wrapWithTimeout('slow-tool', handler, 50);
    await expect(wrapped({})).rejects.toThrow("Tool 'slow-tool' timed out after 50ms");
  });

  it('passes input and context through', async () => {
    let capturedInput: unknown;
    let capturedContext: unknown;
    const handler: ToolHandler = async (input, context) => {
      capturedInput = input;
      capturedContext = context;
      return 'done';
    };
    const wrapped = wrapWithTimeout('test', handler, 1000);
    const ctx = { conversationId: 'conv-1' };
    await wrapped({ foo: 'bar' }, ctx);
    expect(capturedInput).toEqual({ foo: 'bar' });
    expect(capturedContext).toEqual(ctx);
  });
});
