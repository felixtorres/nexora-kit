import { describe, it, expect } from 'vitest';
import { checkRegressions, checkCaseChanges } from './baseline.js';
import type { AggregateMetrics, Baseline, RegressionThresholds, ScenarioResult, CaseResult, CaseMetrics } from './types.js';

const DEFAULT_AGG: AggregateMetrics = {
  passRate: 1.0,
  errorRate: 0,
  timeoutRate: 0,
  toolErrorRate: 0,
  latencyP50: 500,
  latencyP95: 1000,
  latencyP99: 1500,
  avgTokens: 200,
  avgTurns: 2,
  avgToolCalls: 3,
  avgToolDurationMs: 100,
  avgTokensPerTurn: 100,
  firstTurnResolutionRate: 0.5,
};

const DEFAULT_METRICS: CaseMetrics = {
  latencyMs: 1000,
  timeToFirstTokenMs: 200,
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  turns: 2,
  toolCalls: 1,
  toolErrors: 0,
  toolCallDetails: [],
  tokensPerTurn: 75,
  firstTurnResolved: false,
};

function makeBaseline(overrides: Partial<AggregateMetrics> = {}, cases: Baseline['cases'] = {}): Baseline {
  return {
    scenarioId: 'test-scenario',
    timestamp: '2026-01-01T00:00:00.000Z',
    aggregate: { ...DEFAULT_AGG, ...overrides },
    cases,
  };
}

const THRESHOLDS: RegressionThresholds = {
  maxTokenIncrease: 0.15,
  maxLatencyIncrease: 0.25,
  maxPassRateDecrease: 0.05,
};

describe('checkRegressions', () => {
  it('reports no regression when within thresholds', () => {
    const current: AggregateMetrics = { ...DEFAULT_AGG, avgTokens: 210, latencyP95: 1100 };
    const reports = checkRegressions(current, makeBaseline(), THRESHOLDS);
    expect(reports.every((r) => !r.regressed)).toBe(true);
  });

  it('detects token regression', () => {
    const current: AggregateMetrics = { ...DEFAULT_AGG, avgTokens: 300 };
    const reports = checkRegressions(current, makeBaseline(), THRESHOLDS);
    const tokenReport = reports.find((r) => r.metric === 'avgTokens');
    expect(tokenReport).toBeDefined();
    expect(tokenReport!.regressed).toBe(true);
    expect(tokenReport!.changePercent).toBe(50);
  });

  it('detects latency regression', () => {
    const current: AggregateMetrics = { ...DEFAULT_AGG, latencyP95: 1500 };
    const reports = checkRegressions(current, makeBaseline(), THRESHOLDS);
    const latencyReport = reports.find((r) => r.metric === 'latencyP95');
    expect(latencyReport).toBeDefined();
    expect(latencyReport!.regressed).toBe(true);
    expect(latencyReport!.changePercent).toBe(50);
  });

  it('detects pass rate regression', () => {
    const current: AggregateMetrics = { ...DEFAULT_AGG, passRate: 0.8 };
    const reports = checkRegressions(current, makeBaseline(), THRESHOLDS);
    const passReport = reports.find((r) => r.metric === 'passRate');
    expect(passReport).toBeDefined();
    expect(passReport!.regressed).toBe(true);
  });

  it('detects error rate increase', () => {
    const current: AggregateMetrics = { ...DEFAULT_AGG, errorRate: 0.2 };
    const reports = checkRegressions(current, makeBaseline(), THRESHOLDS);
    const errorReport = reports.find((r) => r.metric === 'errorRate');
    expect(errorReport).toBeDefined();
    expect(errorReport!.regressed).toBe(true);
  });

  it('detects timeout rate increase', () => {
    const current: AggregateMetrics = { ...DEFAULT_AGG, timeoutRate: 0.1 };
    const reports = checkRegressions(current, makeBaseline(), THRESHOLDS);
    const timeoutReport = reports.find((r) => r.metric === 'timeoutRate');
    expect(timeoutReport).toBeDefined();
    expect(timeoutReport!.regressed).toBe(true);
  });

  it('detects tool error rate increase', () => {
    const current: AggregateMetrics = { ...DEFAULT_AGG, toolErrorRate: 0.2 };
    const reports = checkRegressions(current, makeBaseline(), THRESHOLDS);
    const toolReport = reports.find((r) => r.metric === 'toolErrorRate');
    expect(toolReport).toBeDefined();
    expect(toolReport!.regressed).toBe(true);
  });

  it('detects tool duration regression (>50% increase)', () => {
    const current: AggregateMetrics = { ...DEFAULT_AGG, avgToolDurationMs: 200 };
    const reports = checkRegressions(current, makeBaseline(), THRESHOLDS);
    const durReport = reports.find((r) => r.metric === 'avgToolDurationMs');
    expect(durReport).toBeDefined();
    expect(durReport!.regressed).toBe(true);
  });

  it('handles improvement (no regression)', () => {
    const current: AggregateMetrics = { ...DEFAULT_AGG, avgTokens: 150, latencyP95: 800 };
    const reports = checkRegressions(current, makeBaseline(), THRESHOLDS);
    expect(reports.every((r) => !r.regressed)).toBe(true);
  });
});

describe('checkCaseChanges', () => {
  function makeCaseResult(id: string, passed: boolean, error?: string): CaseResult {
    return {
      caseId: id,
      caseName: `Case ${id}`,
      responseText: '',
      wsEvents: [],
      metrics: DEFAULT_METRICS,
      validations: [],
      passed,
      error,
    };
  }

  it('detects previously passing case now failing', () => {
    const sr: ScenarioResult = {
      scenarioId: 'test-scenario',
      scenarioName: 'Test',
      cases: [
        makeCaseResult('case-a', false, 'validation failed'),
        makeCaseResult('case-b', true),
      ],
      aggregate: DEFAULT_AGG,
    };
    const baseline = makeBaseline({}, {
      'case-a': { passed: true, metrics: DEFAULT_METRICS },
      'case-b': { passed: true, metrics: DEFAULT_METRICS },
    });

    const { newFailures, fixed } = checkCaseChanges(sr, baseline);
    expect(newFailures).toHaveLength(1);
    expect(newFailures[0].caseId).toBe('case-a');
    expect(newFailures[0].previouslyPassed).toBe(true);
    expect(newFailures[0].error).toBe('validation failed');
    expect(fixed).toHaveLength(0);
  });

  it('detects previously failing case now passing', () => {
    const sr: ScenarioResult = {
      scenarioId: 'test-scenario',
      scenarioName: 'Test',
      cases: [makeCaseResult('case-a', true)],
      aggregate: DEFAULT_AGG,
    };
    const baseline = makeBaseline({}, {
      'case-a': { passed: false, metrics: DEFAULT_METRICS },
    });

    const { newFailures, fixed } = checkCaseChanges(sr, baseline);
    expect(newFailures).toHaveLength(0);
    expect(fixed).toHaveLength(1);
    expect(fixed[0].caseId).toBe('case-a');
    expect(fixed[0].previouslyPassed).toBe(false);
  });

  it('ignores cases that were already failing', () => {
    const sr: ScenarioResult = {
      scenarioId: 'test-scenario',
      scenarioName: 'Test',
      cases: [makeCaseResult('case-a', false)],
      aggregate: DEFAULT_AGG,
    };
    const baseline = makeBaseline({}, {
      'case-a': { passed: false, metrics: DEFAULT_METRICS },
    });

    const { newFailures, fixed } = checkCaseChanges(sr, baseline);
    expect(newFailures).toHaveLength(0);
    expect(fixed).toHaveLength(0);
  });

  it('ignores new cases not in baseline', () => {
    const sr: ScenarioResult = {
      scenarioId: 'test-scenario',
      scenarioName: 'Test',
      cases: [makeCaseResult('new-case', false)],
      aggregate: DEFAULT_AGG,
    };
    const baseline = makeBaseline({}, {});

    const { newFailures, fixed } = checkCaseChanges(sr, baseline);
    expect(newFailures).toHaveLength(0);
    expect(fixed).toHaveLength(0);
  });

  it('returns empty when all still passing', () => {
    const sr: ScenarioResult = {
      scenarioId: 'test-scenario',
      scenarioName: 'Test',
      cases: [makeCaseResult('case-a', true), makeCaseResult('case-b', true)],
      aggregate: DEFAULT_AGG,
    };
    const baseline = makeBaseline({}, {
      'case-a': { passed: true, metrics: DEFAULT_METRICS },
      'case-b': { passed: true, metrics: DEFAULT_METRICS },
    });

    const { newFailures, fixed } = checkCaseChanges(sr, baseline);
    expect(newFailures).toHaveLength(0);
    expect(fixed).toHaveLength(0);
  });
});
