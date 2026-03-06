/**
 * Provider-agnostic model tiers for Claude plugin compatibility.
 *
 * Claude skills use `model: sonnet/opus/haiku` in frontmatter. NexoraKit maps
 * these to abstract tiers, which resolve to the actual model ID configured for
 * the active provider. Explicit model IDs (e.g., 'gpt-4o') pass through unchanged.
 */

export type ModelTier = 'fast' | 'balanced' | 'powerful';

/** Claude model name → NexoraKit tier */
const CLAUDE_TO_TIER: Record<string, ModelTier> = {
  haiku: 'fast',
  sonnet: 'balanced',
  opus: 'powerful',
};

/** Default tier model mappings per provider. Providers can override at registration. */
const DEFAULT_TIER_MODELS: Record<string, Record<ModelTier, string>> = {
  anthropic: {
    fast: 'claude-haiku-4-5-20251001',
    balanced: 'claude-sonnet-4-6-20260226',
    powerful: 'claude-opus-4-6-20260226',
  },
  openai: {
    fast: 'gpt-4o-mini',
    balanced: 'gpt-4o',
    powerful: 'gpt-4o',
  },
};

export interface ModelTierConfig {
  fast: string;
  balanced: string;
  powerful: string;
}

/**
 * Resolve a model string that may be a tier name, Claude model name, or explicit model ID.
 *
 * Resolution order:
 * 1. If it's a tier name (fast/balanced/powerful), resolve via tier config
 * 2. If it's a Claude name (haiku/sonnet/opus), map to tier then resolve
 * 3. Otherwise, pass through as explicit model ID
 */
export function resolveModelTier(
  model: string,
  providerName: string,
  tierConfig?: ModelTierConfig,
): string {
  const config = tierConfig ?? DEFAULT_TIER_MODELS[providerName];

  // Direct tier name
  if (config && isTier(model)) {
    return config[model];
  }

  // Claude model name → tier → model ID
  const tier = CLAUDE_TO_TIER[model];
  if (tier && config) {
    return config[tier];
  }

  // Explicit model ID — pass through
  return model;
}

function isTier(value: string): value is ModelTier {
  return value === 'fast' || value === 'balanced' || value === 'powerful';
}

/**
 * Check if a string is a tier name or Claude model alias (not an explicit model ID).
 */
export function isModelAlias(model: string): boolean {
  return isTier(model) || model in CLAUDE_TO_TIER;
}
