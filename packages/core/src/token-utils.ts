const CHARS_PER_TOKEN = 4;

/**
 * Truncate a tool result string to fit within a token budget.
 * Cuts at a line boundary and appends a truncation notice.
 */
export function truncateToolResult(content: string, maxTokens: number): string {
  const estimatedTokens = Math.ceil(content.length / CHARS_PER_TOKEN);
  if (estimatedTokens <= maxTokens) return content;

  const maxChars = maxTokens * CHARS_PER_TOKEN;
  // Find last newline within budget
  let cutoff = content.lastIndexOf('\n', maxChars);
  if (cutoff <= 0) cutoff = maxChars;

  const truncated = content.slice(0, cutoff);
  return `${truncated}\n[Truncated: ${content.length} chars total]`;
}

/**
 * Estimate token count for a string using char/4 heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
