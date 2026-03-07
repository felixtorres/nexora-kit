import { describe, it, expect } from 'vitest';
import { extractMetrics, aggregateMetrics } from './metrics.js';
import type { ChatEvent } from '@nexora-kit/core';
import type { CaseResult, CaseMetrics, TimestampedEvent } from './types.js';

/** Wrap events with timestamps spaced 100ms apart starting from baseTime */
function stamp(events: ChatEvent[], baseTime = 1000): { tsEvents: TimestampedEvent[]; startTime: number } {
  const startTime = baseTime;
  const tsEvents = events.map((event, i) => ({
    event,
    receivedAt: baseTime + (i + 1) * 100,
  }));
  return { tsEvents, startTime };
}

const DEFAULT_METRICS: CaseMetrics = {
  latencyMs: 0,
  timeToFirstTokenMs: null,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  turns: 1,
  toolCalls: 0,
  toolErrors: 0,
  toolCallDetails: [],
  tokensPerTurn: 0,
  firstTurnResolved: false,
};

function m(overrides: Partial<CaseMetrics>): CaseMetrics {
  return { ...DEFAULT_METRICS, ...overrides };
}

describe('extractMetrics', () => {
  it('extracts tokens from usage events', () => {
    const { tsEvents, startTime } = stamp([
      { type: 'turn_start', turn: 1, maxTurns: 25 },
      { type: 'text', content: 'Hello' },
      { type: 'usage', inputTokens: 100, outputTokens: 50 },
      { type: 'done' },
    ]);
    const metrics = extractMetrics(tsEvents, 1500, startTime);
    expect(metrics.inputTokens).toBe(100);
    expect(metrics.outputTokens).toBe(50);
    expect(metrics.totalTokens).toBe(150);
    expect(metrics.turns).toBe(1);
    expect(metrics.latencyMs).toBe(1500);
    expect(metrics.tokensPerTurn).toBe(150);
  });

  it('accumulates multiple usage events', () => {
    const { tsEvents, startTime } = stamp([
      { type: 'turn_start', turn: 1, maxTurns: 25 },
      { type: 'usage', inputTokens: 100, outputTokens: 50 },
      { type: 'turn_start', turn: 2, maxTurns: 25 },
      { type: 'usage', inputTokens: 200, outputTokens: 100 },
      { type: 'done' },
    ]);
    const metrics = extractMetrics(tsEvents, 3000, startTime);
    expect(metrics.inputTokens).toBe(300);
    expect(metrics.outputTokens).toBe(150);
    expect(metrics.turns).toBe(2);
    expect(metrics.tokensPerTurn).toBe(225);
  });

  it('counts tool calls and tool errors', () => {
    const base = 1000;
    const tsEvents: TimestampedEvent[] = [
      { event: { type: 'turn_start', turn: 1, maxTurns: 25 }, receivedAt: base + 100 },
      { event: { type: 'tool_call', id: 'tc1', name: 'get_data', input: {} }, receivedAt: base + 200 },
      { event: { type: 'tool_status', id: 'tc1', name: 'get_data', status: 'executing' }, receivedAt: base + 210 },
      { event: { type: 'tool_status', id: 'tc1', name: 'get_data', status: 'error' }, receivedAt: base + 500 },
      { event: { type: 'tool_call', id: 'tc2', name: 'analyze', input: {} }, receivedAt: base + 600 },
      { event: { type: 'tool_status', id: 'tc2', name: 'analyze', status: 'executing' }, receivedAt: base + 610 },
      { event: { type: 'tool_status', id: 'tc2', name: 'analyze', status: 'completed' }, receivedAt: base + 900 },
      { event: { type: 'usage', inputTokens: 50, outputTokens: 25 }, receivedAt: base + 950 },
      { event: { type: 'done' }, receivedAt: base + 1000 },
    ];
    const metrics = extractMetrics(tsEvents, 1000, base);
    expect(metrics.toolCalls).toBe(2);
    expect(metrics.toolErrors).toBe(1);
    expect(metrics.toolCallDetails).toHaveLength(2);
    expect(metrics.toolCallDetails[0].name).toBe('get_data');
    expect(metrics.toolCallDetails[0].durationMs).toBe(290);
    expect(metrics.toolCallDetails[1].name).toBe('analyze');
    expect(metrics.toolCallDetails[1].durationMs).toBe(290);
  });

  it('computes tool call duration from tool_status events', () => {
    const base = 1000;
    const tsEvents: TimestampedEvent[] = [
      { event: { type: 'turn_start', turn: 1, maxTurns: 25 }, receivedAt: base + 100 },
      { event: { type: 'tool_call', id: 'tc1', name: 'slow_tool', input: {} }, receivedAt: base + 200 },
      { event: { type: 'tool_status', id: 'tc1', name: 'slow_tool', status: 'executing' }, receivedAt: base + 250 },
      { event: { type: 'tool_status', id: 'tc1', name: 'slow_tool', status: 'completed' }, receivedAt: base + 750 },
      { event: { type: 'usage', inputTokens: 10, outputTokens: 5 }, receivedAt: base + 800 },
      { event: { type: 'done' }, receivedAt: base + 850 },
    ];
    const metrics = extractMetrics(tsEvents, 850, base);
    expect(metrics.toolCallDetails[0].durationMs).toBe(500);
  });

  it('sets TTFT from receive timestamp', () => {
    const base = 1000;
    const tsEvents: TimestampedEvent[] = [
      { event: { type: 'turn_start', turn: 1, maxTurns: 25 }, receivedAt: base + 100 },
      { event: { type: 'text', content: 'H' }, receivedAt: base + 350 },
      { event: { type: 'text', content: 'ello' }, receivedAt: base + 400 },
      { event: { type: 'done' }, receivedAt: base + 500 },
    ];
    const metrics = extractMetrics(tsEvents, 500, base);
    expect(metrics.timeToFirstTokenMs).toBe(350);
  });

  it('returns null TTFT when no text events', () => {
    const { tsEvents, startTime } = stamp([{ type: 'done' }]);
    const metrics = extractMetrics(tsEvents, 100, startTime);
    expect(metrics.timeToFirstTokenMs).toBeNull();
  });

  it('defaults to 1 turn when no turn_start events', () => {
    const { tsEvents, startTime } = stamp([
      { type: 'text', content: 'Hello' },
      { type: 'done' },
    ]);
    const metrics = extractMetrics(tsEvents, 500, startTime);
    expect(metrics.turns).toBe(1);
  });

  it('detects first-turn resolution', () => {
    const { tsEvents, startTime } = stamp([
      { type: 'turn_start', turn: 1, maxTurns: 25 },
      { type: 'text', content: 'Done!' },
      { type: 'usage', inputTokens: 10, outputTokens: 5 },
      { type: 'done' },
    ]);
    const metrics = extractMetrics(tsEvents, 500, startTime);
    expect(metrics.firstTurnResolved).toBe(true);
  });

  it('detects multi-turn (not first-turn resolved)', () => {
    const { tsEvents, startTime } = stamp([
      { type: 'turn_start', turn: 1, maxTurns: 25 },
      { type: 'tool_call', id: 'tc1', name: 'search', input: {} },
      { type: 'turn_start', turn: 2, maxTurns: 25 },
      { type: 'text', content: 'Found it' },
      { type: 'usage', inputTokens: 20, outputTokens: 10 },
      { type: 'done' },
    ]);
    const metrics = extractMetrics(tsEvents, 600, startTime);
    expect(metrics.firstTurnResolved).toBe(false);
    expect(metrics.turns).toBe(2);
  });
});

describe('aggregateMetrics', () => {
  function makeResult(overrides: Partial<CaseResult> & { metrics: CaseMetrics }): CaseResult {
    return {
      caseId: 'test',
      caseName: 'Test',
      responseText: '',
      wsEvents: [],
      validations: [],
      passed: true,
      ...overrides,
    };
  }

  it('computes pass rate and error/timeout rates', () => {
    const results: CaseResult[] = [
      makeResult({ passed: true, metrics: m({ latencyMs: 100, turns: 1 }) }),
      makeResult({ passed: false, error: 'boom', metrics: m({ latencyMs: 200, turns: 2 }) }),
      makeResult({ passed: false, timedOut: true, error: 'timeout', metrics: m({ latencyMs: 0, turns: 0 }) }),
    ];
    const agg = aggregateMetrics(results);
    expect(agg.passRate).toBeCloseTo(1 / 3);
    expect(agg.errorRate).toBeCloseTo(2 / 3);
    expect(agg.timeoutRate).toBeCloseTo(1 / 3);
  });

  it('computes tool error rate', () => {
    const results: CaseResult[] = [
      makeResult({ metrics: m({ toolCalls: 3, toolErrors: 1 }) }),
      makeResult({ metrics: m({ toolCalls: 2, toolErrors: 0 }) }),
    ];
    const agg = aggregateMetrics(results);
    expect(agg.toolErrorRate).toBeCloseTo(1 / 5);
  });

  it('computes latency percentiles', () => {
    const results: CaseResult[] = Array.from({ length: 100 }, (_, i) =>
      makeResult({ metrics: m({ latencyMs: i + 1, turns: 1 }) }),
    );
    const agg = aggregateMetrics(results);
    expect(agg.latencyP50).toBe(51);
    expect(agg.latencyP95).toBe(96);
    expect(agg.latencyP99).toBe(100);
  });

  it('computes averages and tokens per turn', () => {
    const results: CaseResult[] = [
      makeResult({ metrics: m({ totalTokens: 150, turns: 2, toolCalls: 3, toolCallDetails: [{ name: 'a', durationMs: 100 }, { name: 'b', durationMs: 200 }] }) }),
      makeResult({ metrics: m({ totalTokens: 300, turns: 4, toolCalls: 1, toolCallDetails: [{ name: 'c', durationMs: 300 }] }) }),
    ];
    const agg = aggregateMetrics(results);
    expect(agg.avgTokens).toBe(225);
    expect(agg.avgTurns).toBe(3);
    expect(agg.avgToolCalls).toBe(2);
    expect(agg.avgToolDurationMs).toBe(200); // (100+200+300)/3
    expect(agg.avgTokensPerTurn).toBe(75); // 450/6
  });

  it('computes first-turn resolution rate', () => {
    const results: CaseResult[] = [
      makeResult({ passed: true, metrics: m({ firstTurnResolved: true }) }),
      makeResult({ passed: true, metrics: m({ firstTurnResolved: false }) }),
      makeResult({ passed: true, metrics: m({ firstTurnResolved: true }) }),
    ];
    const agg = aggregateMetrics(results);
    expect(agg.firstTurnResolutionRate).toBeCloseTo(2 / 3);
  });

  it('handles empty results', () => {
    const agg = aggregateMetrics([]);
    expect(agg.passRate).toBe(0);
    expect(agg.errorRate).toBe(0);
    expect(agg.timeoutRate).toBe(0);
    expect(agg.latencyP50).toBe(0);
    expect(agg.avgTokens).toBe(0);
    expect(agg.avgToolDurationMs).toBe(0);
    expect(agg.firstTurnResolutionRate).toBe(0);
  });
});
