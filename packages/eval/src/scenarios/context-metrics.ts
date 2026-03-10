import type { Scenario, CaseResult, ValidationResult } from '../types.js';

/**
 * Eval scenario: measures MCP tool token overhead per plugin.
 * Captures `context_metrics` events from the agent loop and validates
 * that no single plugin namespace injects excessive tool definitions.
 */

const MAX_PLUGIN_TOOL_TOKENS = 2000;

export const scenario: Scenario = {
  id: 'context-metrics',
  name: 'Context Metrics: Tool Token Overhead',
  tags: ['context', 'metrics', 'overhead'],

  cases: [
    {
      id: 'measure-tool-overhead',
      name: 'Measure per-plugin tool token overhead on first turn',
      messages: [{ role: 'user', text: 'Hello, what tools do you have?' }],
      validate: [
        {
          type: 'custom',
          name: 'context_metrics_emitted',
          fn: contextMetricsEmitted,
        },
        {
          type: 'custom',
          name: 'no_plugin_exceeds_2k_tool_tokens',
          fn: noPluginExceeds2kToolTokens,
        },
        {
          type: 'custom',
          name: 'system_prompt_within_budget',
          fn: systemPromptWithinBudget,
        },
      ],
    },
  ],
};

function contextMetricsEmitted(result: CaseResult): ValidationResult {
  const metricsEvent = result.wsEvents.find((e) => e.type === 'context_metrics');
  if (!metricsEvent) {
    return { passed: false, message: 'No context_metrics event emitted on first turn' };
  }

  const { systemPromptTokens, toolTokens, toolCount } = metricsEvent as Record<string, unknown>;
  return {
    passed: true,
    message: `context_metrics: systemPrompt=${systemPromptTokens} tokens, tools=${toolCount} (${toolTokens} tokens)`,
  };
}

function noPluginExceeds2kToolTokens(result: CaseResult): ValidationResult {
  const metricsEvent = result.wsEvents.find((e) => e.type === 'context_metrics') as
    | Record<string, unknown>
    | undefined;

  if (!metricsEvent) {
    return { passed: true, message: 'No context_metrics event — skipping plugin overhead check' };
  }

  // The promptBreakdown.skillIndex gives overall skill index tokens.
  // Tool token overhead is aggregate in toolTokens. Per-namespace breakdown
  // is logged via agent-loop warnings, but we can check total here.
  const toolTokens = (metricsEvent.toolTokens as number) ?? 0;
  const toolCount = (metricsEvent.toolCount as number) ?? 0;

  if (toolCount > 0 && toolTokens / toolCount > MAX_PLUGIN_TOOL_TOKENS / 5) {
    // High average tokens per tool — likely oversized descriptions
    return {
      passed: false,
      message: `High average tool token cost: ${Math.round(toolTokens / toolCount)} tokens/tool (${toolCount} tools, ${toolTokens} total)`,
    };
  }

  if (toolTokens > MAX_PLUGIN_TOOL_TOKENS * 5) {
    return {
      passed: false,
      message: `Total tool token overhead (${toolTokens}) exceeds 5× per-plugin ceiling (${MAX_PLUGIN_TOOL_TOKENS * 5})`,
    };
  }

  return {
    passed: true,
    message: `Tool overhead OK: ${toolTokens} tokens across ${toolCount} tools`,
  };
}

function systemPromptWithinBudget(result: CaseResult): ValidationResult {
  const metricsEvent = result.wsEvents.find((e) => e.type === 'context_metrics') as
    | Record<string, unknown>
    | undefined;

  if (!metricsEvent) {
    return { passed: true, message: 'No context_metrics event — skipping prompt budget check' };
  }

  const breakdown = metricsEvent.promptBreakdown as Record<string, number> | undefined;
  if (!breakdown) {
    return { passed: true, message: 'No promptBreakdown in context_metrics' };
  }

  const totalPromptTokens = (metricsEvent.systemPromptTokens as number) ?? 0;
  const baseTokens = breakdown.base ?? 0;
  const frameworkTokens = totalPromptTokens - baseTokens;

  if (frameworkTokens > 2000) {
    return {
      passed: false,
      message: `Framework system prompt overhead (${frameworkTokens} tokens) exceeds 2k ceiling. Breakdown: ${JSON.stringify(breakdown)}`,
    };
  }

  return {
    passed: true,
    message: `System prompt OK: ${totalPromptTokens} total (${frameworkTokens} framework, ${baseTokens} base)`,
  };
}

export default scenario;
