import { describe, it, expect } from 'vitest';
import { ContextBudget } from './context-budget.js';

describe('ContextBudget', () => {
  const defaultBudget = new ContextBudget({
    contextWindow: 128_000,
    reservedOutput: 4_096,
  });

  describe('allocate', () => {
    it('computes messages budget as remainder after components', () => {
      const result = defaultBudget.allocate({
        systemPromptTokens: 500,
        toolTokens: 2000,
        workspaceTokens: 1000,
        artifactTokens: 200,
        skillIndexTokens: 300,
      });

      expect(result.messagesBudget).toBe(128_000 - 4_096 - 500 - 2000 - 1000 - 200 - 300);
      expect(result.overflow).toBe(false);
      expect(result.totalAvailable).toBe(128_000 - 4_096);
    });

    it('clamps messages budget to 0 on overflow', () => {
      const smallBudget = new ContextBudget({
        contextWindow: 8_000,
        reservedOutput: 2_000,
      });

      const result = smallBudget.allocate({
        systemPromptTokens: 3000,
        toolTokens: 2000,
        workspaceTokens: 1000,
        artifactTokens: 500,
        skillIndexTokens: 500,
      });

      expect(result.messagesBudget).toBe(0);
      expect(result.overflow).toBe(true);
    });

    it('returns breakdown of all components', () => {
      const result = defaultBudget.allocate({
        systemPromptTokens: 100,
        toolTokens: 200,
        workspaceTokens: 300,
        artifactTokens: 400,
        skillIndexTokens: 500,
      });

      expect(result.breakdown.systemPrompt).toBe(100);
      expect(result.breakdown.tools).toBe(200);
      expect(result.breakdown.workspace).toBe(300);
      expect(result.breakdown.artifacts).toBe(400);
      expect(result.breakdown.skillIndex).toBe(500);
      expect(result.breakdown.messages).toBe(result.messagesBudget);
    });

    it('handles zero-component scenario', () => {
      const result = defaultBudget.allocate({
        systemPromptTokens: 0,
        toolTokens: 0,
        workspaceTokens: 0,
        artifactTokens: 0,
        skillIndexTokens: 0,
      });

      expect(result.messagesBudget).toBe(128_000 - 4_096);
      expect(result.overflow).toBe(false);
    });
  });

  describe('adaptiveToolBudget', () => {
    it('returns full budget when messages are under 70%', () => {
      const budget = new ContextBudget({
        contextWindow: 100_000,
        reservedOutput: 4_000,
        toolBudget: 4000,
      });

      // 60% of available (96000) = 57600 message tokens
      expect(budget.adaptiveToolBudget(57_600)).toBe(4000);
    });

    it('scales down when messages exceed 70%', () => {
      const budget = new ContextBudget({
        contextWindow: 100_000,
        reservedOutput: 4_000,
        toolBudget: 4000,
      });

      // 80% of available (96000) = 76800 message tokens
      const result = budget.adaptiveToolBudget(76_800);
      expect(result).toBeLessThan(4000);
      expect(result).toBeGreaterThan(0);
    });

    it('floors at 30% of budget when messages are at 90%+', () => {
      const budget = new ContextBudget({
        contextWindow: 100_000,
        reservedOutput: 4_000,
        toolBudget: 4000,
      });

      const result = budget.adaptiveToolBudget(92_000);
      expect(result).toBe(Math.floor(4000 * 0.3));
    });
  });

  describe('estimateTokens', () => {
    it('estimates tokens using char/4', () => {
      expect(ContextBudget.estimateTokens('abcdefgh')).toBe(2);
      expect(ContextBudget.estimateTokens('')).toBe(0);
      expect(ContextBudget.estimateTokens('abc')).toBe(1);
    });
  });

  describe('defaults', () => {
    it('exposes default budgets', () => {
      const budget = new ContextBudget({
        contextWindow: 128_000,
        reservedOutput: 4_096,
        toolBudget: 3000,
        workspaceBudget: 1500,
      });

      expect(budget.defaults.toolBudget).toBe(3000);
      expect(budget.defaults.workspaceBudget).toBe(1500);
      expect(budget.defaults.artifactBudget).toBe(500);
      expect(budget.defaults.skillIndexBudget).toBe(500);
    });
  });
});
