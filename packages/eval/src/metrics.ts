import type { ChatEvent } from '@nexora-kit/core';
import type { CaseMetrics, CaseResult, AggregateMetrics, TimestampedEvent } from './types.js';

export function extractMetrics(
  tsEvents: TimestampedEvent[],
  wallClockMs: number,
  startTime: number,
): CaseMetrics {
  let inputTokens = 0;
  let outputTokens = 0;
  let turns = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let timeToFirstTokenMs: number | null = null;
  let hasTextBeforeTurn2 = false;
  let seenSecondTurn = false;
  const toolCallDetails: { name: string; durationMs?: number }[] = [];

  // Track tool call start times using real receive timestamps
  const toolStartTimes = new Map<string, number>();

  for (const { event, receivedAt } of tsEvents) {
    switch (event.type) {
      case 'usage':
        inputTokens += event.inputTokens;
        outputTokens += event.outputTokens;
        break;

      case 'turn_start':
        turns++;
        if (turns >= 2) seenSecondTurn = true;
        break;

      case 'tool_call':
        toolCalls++;
        toolStartTimes.set(event.id, receivedAt);
        toolCallDetails.push({ name: event.name });
        break;

      case 'tool_status':
        if (event.status === 'executing') {
          toolStartTimes.set(event.id, receivedAt);
        } else if (event.status === 'completed') {
          const execStart = toolStartTimes.get(event.id);
          if (execStart !== undefined) {
            const detail = toolCallDetails.find((d) => d.name === event.name && d.durationMs === undefined);
            if (detail) {
              detail.durationMs = receivedAt - execStart;
            }
          }
        } else if (event.status === 'error') {
          toolErrors++;
          const execStart = toolStartTimes.get(event.id);
          if (execStart !== undefined) {
            const detail = toolCallDetails.find((d) => d.name === event.name && d.durationMs === undefined);
            if (detail) {
              detail.durationMs = receivedAt - execStart;
            }
          }
        }
        break;

      case 'text':
        if (timeToFirstTokenMs === null) {
          timeToFirstTokenMs = receivedAt - startTime;
        }
        if (!seenSecondTurn) {
          hasTextBeforeTurn2 = true;
        }
        break;
    }
  }

  // If no turn_start events, assume at least 1 turn if we got any events
  if (turns === 0 && tsEvents.length > 0) {
    turns = 1;
  }

  const totalTokens = inputTokens + outputTokens;

  return {
    latencyMs: wallClockMs,
    timeToFirstTokenMs,
    inputTokens,
    outputTokens,
    totalTokens,
    turns,
    toolCalls,
    toolErrors,
    toolCallDetails,
    tokensPerTurn: turns > 0 ? totalTokens / turns : 0,
    firstTurnResolved: hasTextBeforeTurn2 && turns <= 1,
  };
}

export function aggregateMetrics(results: CaseResult[]): AggregateMetrics {
  if (results.length === 0) {
    return {
      passRate: 0,
      errorRate: 0,
      timeoutRate: 0,
      toolErrorRate: 0,
      latencyP50: 0,
      latencyP95: 0,
      latencyP99: 0,
      avgTokens: 0,
      avgTurns: 0,
      avgToolCalls: 0,
      avgToolDurationMs: 0,
      avgTokensPerTurn: 0,
      firstTurnResolutionRate: 0,
    };
  }

  const n = results.length;
  const passed = results.filter((r) => r.passed).length;
  const errors = results.filter((r) => r.error !== undefined).length;
  const timeouts = results.filter((r) => r.timedOut).length;
  const latencies = results.map((r) => r.metrics.latencyMs).sort((a, b) => a - b);
  const totalTokens = results.reduce((sum, r) => sum + r.metrics.totalTokens, 0);
  const totalTurns = results.reduce((sum, r) => sum + r.metrics.turns, 0);
  const totalToolCalls = results.reduce((sum, r) => sum + r.metrics.toolCalls, 0);
  const totalToolErrors = results.reduce((sum, r) => sum + r.metrics.toolErrors, 0);
  const firstTurnResolved = results.filter((r) => r.metrics.firstTurnResolved).length;

  // Average tool duration across all tool calls with measured durations
  const allDurations = results.flatMap((r) =>
    r.metrics.toolCallDetails.filter((d) => d.durationMs !== undefined).map((d) => d.durationMs!),
  );
  const avgToolDurationMs = allDurations.length > 0
    ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length
    : 0;

  return {
    passRate: passed / n,
    errorRate: errors / n,
    timeoutRate: timeouts / n,
    toolErrorRate: totalToolCalls > 0 ? totalToolErrors / totalToolCalls : 0,
    latencyP50: percentile(latencies, 0.5),
    latencyP95: percentile(latencies, 0.95),
    latencyP99: percentile(latencies, 0.99),
    avgTokens: totalTokens / n,
    avgTurns: totalTurns / n,
    avgToolCalls: totalToolCalls / n,
    avgToolDurationMs,
    avgTokensPerTurn: totalTurns > 0 ? totalTokens / totalTurns : 0,
    firstTurnResolutionRate: passed > 0 ? firstTurnResolved / passed : 0,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}
