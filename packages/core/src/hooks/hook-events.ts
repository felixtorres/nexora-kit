/**
 * Hook event types fired at lifecycle points in the agent loop.
 * Mirrors Claude Code's hook system for plugin compatibility.
 */

export type HookEventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'SessionEnd';

export interface HookEventPayload {
  sessionId: string;
  conversationId?: string;
  hookEventName: HookEventName;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  isError?: boolean;
}

export type HookVerdict = 'allow' | 'block';

export interface HookResult {
  verdict: HookVerdict;
  reason?: string;
  injectedContext?: string;
}
