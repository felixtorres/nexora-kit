/**
 * Minimal logger interface for LLM providers.
 *
 * Structurally compatible with @nexora-kit/core's Logger — any core Logger
 * instance satisfies this interface without an explicit dependency.
 */
export interface LlmLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}
