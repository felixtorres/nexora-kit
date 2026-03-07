import type { ToolHandler } from '@nexora-kit/core';

const DEFAULT_TIMEOUT_MS = 30_000;
const TIER_TIMEOUTS: Record<string, number> = {
  none: 0, // no timeout
  basic: DEFAULT_TIMEOUT_MS,
  strict: 5_000,
};

export function getTimeoutForTier(tier: string, explicitMs?: number): number {
  if (explicitMs !== undefined) return explicitMs;
  return TIER_TIMEOUTS[tier] ?? DEFAULT_TIMEOUT_MS;
}

export function wrapWithTimeout(
  toolName: string,
  handler: ToolHandler,
  timeoutMs: number,
): ToolHandler {
  if (timeoutMs <= 0) return handler;

  return async (input, context) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await Promise.race([
        handler(input, context),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error(`Tool '${toolName}' timed out after ${timeoutMs}ms`));
          });
        }),
      ]);
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
}
