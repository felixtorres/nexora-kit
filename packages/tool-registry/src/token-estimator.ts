import type { ToolDefinition } from '@nexora-kit/core';

const CHARS_PER_TOKEN = 4;

export function estimateToolTokens(tool: ToolDefinition): number {
  const json = JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  });
  return Math.ceil(json.length / CHARS_PER_TOKEN);
}

export function estimateTotalTokens(tools: ToolDefinition[]): number {
  return tools.reduce((sum, tool) => sum + estimateToolTokens(tool), 0);
}
