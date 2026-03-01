import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRouter, type RoutingRule } from './router.js';
import type { LlmProvider } from './provider.js';
import type { LlmEvent, LlmRequest, ModelInfo } from './types.js';

function mockProvider(name: string, models: ModelInfo[]): LlmProvider {
  return {
    name,
    models,
    async *chat(_request: LlmRequest): AsyncIterable<LlmEvent> {
      yield { type: 'text', content: `response from ${name}` };
      yield { type: 'done' };
    },
    async countTokens() {
      return 0;
    },
  };
}

describe('ModelRouter', () => {
  let router: ModelRouter;
  let anthropic: LlmProvider;
  let openai: LlmProvider;

  beforeEach(() => {
    router = new ModelRouter();
    anthropic = mockProvider('anthropic', [
      { id: 'claude-sonnet-4-6', name: 'Sonnet', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 16384 },
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 8192 },
    ]);
    openai = mockProvider('openai', [
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384 },
    ]);
    router.registerProvider(anthropic);
    router.registerProvider(openai);
  });

  it('routes to provider by model ID', () => {
    const result = router.route({ model: 'gpt-4o' });
    expect(result.provider.name).toBe('openai');
    expect(result.modelId).toBe('gpt-4o');
  });

  it('uses default when no match', () => {
    router.setDefault('anthropic', 'claude-sonnet-4-6');
    const result = router.route({ model: 'nonexistent' });
    expect(result.provider.name).toBe('anthropic');
    expect(result.modelId).toBe('claude-sonnet-4-6');
  });

  it('falls back to first provider when no default', () => {
    const result = router.route({});
    expect(result.provider).toBeDefined();
    expect(result.modelId).toBeDefined();
  });

  it('throws when no providers registered', () => {
    const emptyRouter = new ModelRouter();
    expect(() => emptyRouter.route({})).toThrow('No LLM providers registered');
  });

  it('applies routing rules by priority', () => {
    const rule: RoutingRule = {
      name: 'team-x-uses-openai',
      priority: 10,
      match: (req) => req.teamId === 'team-x',
      resolve: (_req, providers) => {
        const p = providers.get('openai');
        return p ? { provider: p, modelId: 'gpt-4o' } : null;
      },
    };
    router.addRule(rule);

    const result = router.route({ teamId: 'team-x', model: 'claude-sonnet-4-6' });
    expect(result.provider.name).toBe('openai');
  });

  it('higher priority rules win', () => {
    router.addRule({
      name: 'low-priority',
      priority: 1,
      match: () => true,
      resolve: (_req, providers) => {
        const p = providers.get('openai');
        return p ? { provider: p, modelId: 'gpt-4o' } : null;
      },
    });
    router.addRule({
      name: 'high-priority',
      priority: 100,
      match: () => true,
      resolve: (_req, providers) => {
        const p = providers.get('anthropic');
        return p ? { provider: p, modelId: 'claude-haiku-4-5-20251001' } : null;
      },
    });

    const result = router.route({});
    expect(result.provider.name).toBe('anthropic');
    expect(result.modelId).toBe('claude-haiku-4-5-20251001');
  });

  it('lists providers', () => {
    expect(router.listProviders()).toHaveLength(2);
  });

  it('gets provider by name', () => {
    expect(router.getProvider('anthropic')).toBe(anthropic);
    expect(router.getProvider('unknown')).toBeUndefined();
  });
});
