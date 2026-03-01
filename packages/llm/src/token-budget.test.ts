import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBudget } from './token-budget.js';

describe('TokenBudget', () => {
  let budget: TokenBudget;

  beforeEach(() => {
    budget = new TokenBudget({ defaultInstanceLimit: 10_000, defaultPluginLimit: 5_000 });
  });

  it('allows requests under budget', () => {
    const result = budget.check('plugin-x', 1000);
    expect(result.allowed).toBe(true);
  });

  it('tracks consumption', () => {
    budget.consume('plugin-x', { inputTokens: 3000, outputTokens: 2000 });
    const usage = budget.getInstanceUsage();
    expect(usage.used).toBe(5000);
  });

  it('denies when instance budget exceeded', () => {
    budget.consume('plugin-x', { inputTokens: 8000, outputTokens: 0 });
    const result = budget.check('plugin-x', 3000);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('Instance');
      expect(result.used).toBe(8000);
    }
  });

  it('denies when plugin budget exceeded', () => {
    budget.consume('plugin-x', { inputTokens: 4500, outputTokens: 0 });
    const result = budget.check('plugin-x', 1000);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('plugin');
    }
  });

  it('allows setting custom instance limit', () => {
    budget.setInstanceLimit(100);
    budget.consume('plugin-x', { inputTokens: 50, outputTokens: 0 });
    const result = budget.check('plugin-x', 60);
    expect(result.allowed).toBe(false);
  });

  it('allows setting custom plugin limits', () => {
    budget.setPluginLimit('plugin-x', 100);
    budget.consume('plugin-x', { inputTokens: 80, outputTokens: 0 });
    const result = budget.check('plugin-x', 30);
    expect(result.allowed).toBe(false);
  });

  it('separate plugins have independent budgets', () => {
    budget.consume('plugin-x', { inputTokens: 4500, outputTokens: 0 });
    const result = budget.check('plugin-y', 3000);
    expect(result.allowed).toBe(true);
  });
});
