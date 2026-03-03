import type { ToolHandler, ToolHandlerResponse, ToolExecutionContext } from '@nexora-kit/core';

export interface ErrorBoundaryOptions {
  maxConsecutiveFailures: number;
  onDisable: (toolName: string, error: string) => void;
}

const DEFAULT_OPTIONS: ErrorBoundaryOptions = {
  maxConsecutiveFailures: 5,
  onDisable: () => {},
};

export function wrapWithErrorBoundary(
  toolName: string,
  handler: ToolHandler,
  options: Partial<ErrorBoundaryOptions> = {},
): ToolHandler {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let consecutiveFailures = 0;
  let disabled = false;

  return async (input: Record<string, unknown>, context?: ToolExecutionContext): Promise<string | ToolHandlerResponse> => {
    if (disabled) {
      throw new Error(`Tool '${toolName}' is disabled after ${opts.maxConsecutiveFailures} consecutive failures`);
    }

    try {
      const result = await handler(input, context);
      consecutiveFailures = 0;
      return result;
    } catch (error) {
      consecutiveFailures++;
      const message = error instanceof Error ? error.message : String(error);

      if (consecutiveFailures >= opts.maxConsecutiveFailures) {
        disabled = true;
        opts.onDisable(toolName, message);
      }

      throw error;
    }
  };
}
