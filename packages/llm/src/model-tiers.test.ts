import { describe, it, expect } from 'vitest';
import { resolveModelTier, isModelAlias } from './model-tiers.js';

describe('resolveModelTier', () => {
  it('resolves tier names for anthropic provider', () => {
    expect(resolveModelTier('fast', 'anthropic')).toContain('haiku');
    expect(resolveModelTier('balanced', 'anthropic')).toContain('sonnet');
    expect(resolveModelTier('powerful', 'anthropic')).toContain('opus');
  });

  it('resolves tier names for openai provider', () => {
    expect(resolveModelTier('fast', 'openai')).toBe('gpt-4o-mini');
    expect(resolveModelTier('balanced', 'openai')).toBe('gpt-4o');
    expect(resolveModelTier('powerful', 'openai')).toBe('gpt-4o');
  });

  it('maps Claude model names to tiers', () => {
    expect(resolveModelTier('haiku', 'anthropic')).toContain('haiku');
    expect(resolveModelTier('sonnet', 'anthropic')).toContain('sonnet');
    expect(resolveModelTier('opus', 'anthropic')).toContain('opus');
  });

  it('maps Claude names across providers', () => {
    expect(resolveModelTier('haiku', 'openai')).toBe('gpt-4o-mini');
    expect(resolveModelTier('sonnet', 'openai')).toBe('gpt-4o');
    expect(resolveModelTier('opus', 'openai')).toBe('gpt-4o');
  });

  it('passes through explicit model IDs unchanged', () => {
    expect(resolveModelTier('gpt-4o-2024-05-13', 'openai')).toBe('gpt-4o-2024-05-13');
    expect(resolveModelTier('claude-sonnet-4-6-20260226', 'anthropic')).toBe('claude-sonnet-4-6-20260226');
    expect(resolveModelTier('my-custom-model', 'anthropic')).toBe('my-custom-model');
  });

  it('passes through for unknown providers', () => {
    expect(resolveModelTier('fast', 'unknown-provider')).toBe('fast');
    expect(resolveModelTier('sonnet', 'unknown-provider')).toBe('sonnet');
    expect(resolveModelTier('gpt-4o', 'unknown-provider')).toBe('gpt-4o');
  });

  it('uses custom tier config when provided', () => {
    const config = { fast: 'custom-small', balanced: 'custom-medium', powerful: 'custom-large' };

    expect(resolveModelTier('fast', 'any', config)).toBe('custom-small');
    expect(resolveModelTier('balanced', 'any', config)).toBe('custom-medium');
    expect(resolveModelTier('powerful', 'any', config)).toBe('custom-large');
    expect(resolveModelTier('haiku', 'any', config)).toBe('custom-small');
    expect(resolveModelTier('sonnet', 'any', config)).toBe('custom-medium');
    expect(resolveModelTier('opus', 'any', config)).toBe('custom-large');
  });
});

describe('isModelAlias', () => {
  it('returns true for tier names', () => {
    expect(isModelAlias('fast')).toBe(true);
    expect(isModelAlias('balanced')).toBe(true);
    expect(isModelAlias('powerful')).toBe(true);
  });

  it('returns true for Claude model names', () => {
    expect(isModelAlias('haiku')).toBe(true);
    expect(isModelAlias('sonnet')).toBe(true);
    expect(isModelAlias('opus')).toBe(true);
  });

  it('returns false for explicit model IDs', () => {
    expect(isModelAlias('gpt-4o')).toBe(false);
    expect(isModelAlias('claude-sonnet-4-6-20260226')).toBe(false);
    expect(isModelAlias('my-model')).toBe(false);
  });
});
