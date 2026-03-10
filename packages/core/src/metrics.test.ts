import { describe, it, expect } from 'vitest';
import {
  answerCorrectness,
  toolSelection,
  retrievalRelevance,
  userSatisfaction,
  compactionRetention,
  MetricRegistry,
  type ExecutionTraceInput,
  type MetricContext,
} from './metrics.js';

function makeTrace(overrides: Partial<ExecutionTraceInput> = {}): ExecutionTraceInput {
  return {
    prompt: 'test prompt',
    finalAnswer: 'test answer',
    toolCalls: [],
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 200,
    ...overrides,
  };
}

describe('answerCorrectness', () => {
  it('returns 0.5 when no expected answer provided', () => {
    const result = answerCorrectness(makeTrace(), {});
    expect(result.score).toBe(0.5);
    expect(result.feedback).toContain('No expected answer');
  });

  it('returns 0 for empty answer', () => {
    const result = answerCorrectness(makeTrace({ finalAnswer: '' }), { expectedAnswer: 'hello world' });
    expect(result.score).toBe(0);
    expect(result.feedback).toContain('no answer');
  });

  it('scores high for matching answers', () => {
    const result = answerCorrectness(
      makeTrace({ finalAnswer: 'The capital of France is Paris' }),
      { expectedAnswer: 'The capital of France is Paris' },
    );
    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('scores low for unrelated answers', () => {
    const result = answerCorrectness(
      makeTrace({ finalAnswer: 'The weather today is sunny and warm' }),
      { expectedAnswer: 'The capital of France is Paris' },
    );
    expect(result.score).toBeLessThan(0.3);
  });

  it('penalizes very short answers', () => {
    const result = answerCorrectness(
      makeTrace({ finalAnswer: 'Paris' }),
      { expectedAnswer: 'The capital of France is Paris and it is a major European city' },
    );
    expect(result.feedback).toContain('too short');
  });

  it('provides feedback about missing terms', () => {
    const result = answerCorrectness(
      makeTrace({ finalAnswer: 'The capital is Berlin' }),
      { expectedAnswer: 'The capital of France is Paris' },
    );
    expect(result.feedback).toContain('Missing');
  });
});

describe('toolSelection', () => {
  it('returns 0.5 when no expected tools provided', () => {
    const result = toolSelection(makeTrace(), {});
    expect(result.score).toBe(0.5);
  });

  it('scores 1.0 for perfect tool match', () => {
    const result = toolSelection(
      makeTrace({
        toolCalls: [
          { name: 'search', input: {}, isError: false },
          { name: 'format', input: {}, isError: false },
        ],
      }),
      { expectedTools: ['search', 'format'] },
    );
    expect(result.score).toBe(1);
    expect(result.feedback).toContain('correctly');
  });

  it('penalizes missing tools', () => {
    const result = toolSelection(
      makeTrace({
        toolCalls: [{ name: 'search', input: {}, isError: false }],
      }),
      { expectedTools: ['search', 'format', 'validate'] },
    );
    expect(result.score).toBeLessThan(0.7);
    expect(result.feedback).toContain('Missing tools');
    expect(result.feedback).toContain('format');
  });

  it('penalizes unnecessary tool calls', () => {
    const result = toolSelection(
      makeTrace({
        toolCalls: [
          { name: 'search', input: {}, isError: false },
          { name: 'debug', input: {}, isError: false },
          { name: 'cleanup', input: {}, isError: false },
        ],
      }),
      { expectedTools: ['search'] },
    );
    expect(result.score).toBeLessThan(0.7);
    expect(result.feedback).toContain('Unnecessary tools');
  });

  it('penalizes error calls', () => {
    const result = toolSelection(
      makeTrace({
        toolCalls: [
          { name: 'search', input: {}, isError: true },
          { name: 'format', input: {}, isError: false },
        ],
      }),
      { expectedTools: ['search', 'format'] },
    );
    expect(result.score).toBeLessThan(1);
    expect(result.feedback).toContain('error');
  });
});

describe('retrievalRelevance', () => {
  it('returns 0.5 when no gold documents provided', () => {
    const result = retrievalRelevance(makeTrace(), {});
    expect(result.score).toBe(0.5);
  });

  it('returns 0 when nothing retrieved but gold docs expected', () => {
    const result = retrievalRelevance(makeTrace({ retrievedDocs: [] }), {
      goldDocuments: ['important document about testing'],
    });
    expect(result.score).toBe(0);
    expect(result.feedback).toContain('No documents were retrieved');
  });

  it('scores high when retrieved docs match gold', () => {
    const result = retrievalRelevance(
      makeTrace({
        retrievedDocs: [
          'PostgreSQL supports JSON columns and indexing for document storage.',
          'Use CREATE INDEX for better query performance on large tables.',
        ],
      }),
      {
        goldDocuments: [
          'PostgreSQL JSON columns and document storage',
          'CREATE INDEX for query performance',
        ],
      },
    );
    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('penalizes too many irrelevant results', () => {
    const gold = ['specific important fact'];
    const retrieved = Array.from({ length: 10 }, (_, i) => `irrelevant document number ${i}`);
    retrieved.push('contains specific important fact here');

    const result = retrievalRelevance(makeTrace({ retrievedDocs: retrieved }), { goldDocuments: gold });
    expect(result.feedback).toContain('too many irrelevant');
  });
});

describe('userSatisfaction', () => {
  it('returns 0.5 when no feedback provided', () => {
    const result = userSatisfaction(makeTrace(), {});
    expect(result.score).toBe(0.5);
    expect(result.feedback).toContain('No user feedback');
  });

  it('returns 1.0 for thumbs up', () => {
    const result = userSatisfaction(makeTrace(), { userRating: true });
    expect(result.score).toBe(1);
    expect(result.feedback).toContain('positive');
  });

  it('returns 0 for thumbs down without correction', () => {
    const result = userSatisfaction(makeTrace(), { userRating: false });
    expect(result.score).toBe(0);
    expect(result.feedback).toContain('negative');
  });

  it('returns 0.1 for thumbs down with correction', () => {
    const result = userSatisfaction(makeTrace(), {
      userRating: false,
      userCorrection: 'The answer should have mentioned the deadline',
    });
    expect(result.score).toBe(0.1);
    expect(result.feedback).toContain('correction');
    expect(result.feedback).toContain('deadline');
  });
});

describe('compactionRetention', () => {
  it('returns 0.5 when no key facts provided', () => {
    const result = compactionRetention(makeTrace(), {});
    expect(result.score).toBe(0.5);
  });

  it('returns 0 when compaction produces no output', () => {
    const result = compactionRetention(makeTrace({ finalAnswer: '' }), {
      keyFacts: ['important fact'],
    });
    expect(result.score).toBe(0);
  });

  it('scores high when all facts retained', () => {
    const result = compactionRetention(
      makeTrace({
        finalAnswer: 'The project deadline is March 15. Budget is $50,000. The team has 5 members.',
      }),
      {
        keyFacts: [
          'deadline is March 15',
          'budget is $50,000',
          'team has 5 members',
        ],
      },
    );
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.feedback).toContain('3/3');
  });

  it('identifies lost facts', () => {
    const result = compactionRetention(
      makeTrace({
        finalAnswer: 'The project has a team of 5 members.',
      }),
      {
        keyFacts: [
          'deadline is March 15',
          'budget is $50,000',
          'team has 5 members',
        ],
      },
    );
    expect(result.score).toBeLessThan(0.5);
    expect(result.feedback).toContain('Lost facts');
  });

  it('warns when compaction barely reduces content', () => {
    const original = 'This is some content that should be compressed significantly.';
    const result = compactionRetention(
      makeTrace({ finalAnswer: original }),
      {
        keyFacts: ['content'],
        preCompactionContent: original,
      },
    );
    expect(result.feedback).toContain('barely reduced');
  });
});

describe('MetricRegistry', () => {
  it('has all 5 built-in metrics', () => {
    const registry = new MetricRegistry();
    const names = registry.list();
    expect(names).toContain('answer_correctness');
    expect(names).toContain('tool_selection');
    expect(names).toContain('retrieval_relevance');
    expect(names).toContain('user_satisfaction');
    expect(names).toContain('compaction_retention');
    expect(names).toHaveLength(5);
  });

  it('evaluates a single metric', () => {
    const registry = new MetricRegistry();
    const result = registry.evaluate('user_satisfaction', makeTrace(), { userRating: true });
    expect(result.score).toBe(1);
  });

  it('throws for unknown metric', () => {
    const registry = new MetricRegistry();
    expect(() => registry.evaluate('nonexistent', makeTrace(), {})).toThrow('Unknown metric');
  });

  it('evaluates all metrics', () => {
    const registry = new MetricRegistry();
    const results = registry.evaluateAll(makeTrace(), {});
    expect(results.size).toBe(5);
    for (const [, result] of results) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(typeof result.feedback).toBe('string');
    }
  });

  it('supports custom metrics', () => {
    const registry = new MetricRegistry();
    registry.register('custom_speed', (trace) => ({
      score: trace.durationMs < 1000 ? 1 : 0,
      feedback: trace.durationMs < 1000 ? 'Fast enough' : 'Too slow',
    }));

    const fast = registry.evaluate('custom_speed', makeTrace({ durationMs: 500 }), {});
    expect(fast.score).toBe(1);

    const slow = registry.evaluate('custom_speed', makeTrace({ durationMs: 2000 }), {});
    expect(slow.score).toBe(0);
  });
});
