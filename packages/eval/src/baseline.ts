import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type {
  Baseline,
  AggregateMetrics,
  RegressionThresholds,
  RegressionReport,
  ScenarioResult,
  CaseFailureReport,
} from './types.js';

export async function loadBaseline(dir: string, scenarioId: string): Promise<Baseline | null> {
  const path = resolve(dir, `${scenarioId}.baseline.json`);
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as Baseline;
  } catch {
    return null;
  }
}

export async function saveBaseline(dir: string, baseline: Baseline): Promise<void> {
  const path = resolve(dir, `${baseline.scenarioId}.baseline.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
}

export function buildBaseline(sr: ScenarioResult): Baseline {
  const cases: Baseline['cases'] = {};
  for (const c of sr.cases) {
    cases[c.caseId] = { passed: c.passed, metrics: c.metrics };
  }
  return {
    scenarioId: sr.scenarioId,
    timestamp: new Date().toISOString(),
    aggregate: sr.aggregate,
    cases,
  };
}

export function checkRegressions(
  current: AggregateMetrics,
  baseline: Baseline,
  thresholds: RegressionThresholds,
): RegressionReport[] {
  const reports: RegressionReport[] = [];
  const base = baseline.aggregate;

  // Token increase
  if (base.avgTokens > 0) {
    const change = (current.avgTokens - base.avgTokens) / base.avgTokens;
    reports.push({
      scenarioId: baseline.scenarioId,
      metric: 'avgTokens',
      baseline: base.avgTokens,
      current: current.avgTokens,
      changePercent: change * 100,
      regressed: change > thresholds.maxTokenIncrease,
    });
  }

  // Latency increase (p95)
  if (base.latencyP95 > 0) {
    const change = (current.latencyP95 - base.latencyP95) / base.latencyP95;
    reports.push({
      scenarioId: baseline.scenarioId,
      metric: 'latencyP95',
      baseline: base.latencyP95,
      current: current.latencyP95,
      changePercent: change * 100,
      regressed: change > thresholds.maxLatencyIncrease,
    });
  }

  // Pass rate decrease
  if (base.passRate > 0) {
    const change = (base.passRate - current.passRate) / base.passRate;
    reports.push({
      scenarioId: baseline.scenarioId,
      metric: 'passRate',
      baseline: base.passRate,
      current: current.passRate,
      changePercent: -change * 100,
      regressed: change > thresholds.maxPassRateDecrease,
    });
  }

  // Error rate increase (any increase is a regression)
  if (current.errorRate > (base.errorRate ?? 0)) {
    reports.push({
      scenarioId: baseline.scenarioId,
      metric: 'errorRate',
      baseline: base.errorRate ?? 0,
      current: current.errorRate,
      changePercent: current.errorRate * 100,
      regressed: true,
    });
  }

  // Timeout rate (any > 0 is a regression)
  if (current.timeoutRate > (base.timeoutRate ?? 0)) {
    reports.push({
      scenarioId: baseline.scenarioId,
      metric: 'timeoutRate',
      baseline: base.timeoutRate ?? 0,
      current: current.timeoutRate,
      changePercent: current.timeoutRate * 100,
      regressed: true,
    });
  }

  // Tool error rate increase
  if (current.toolErrorRate > (base.toolErrorRate ?? 0) + 0.05) {
    reports.push({
      scenarioId: baseline.scenarioId,
      metric: 'toolErrorRate',
      baseline: base.toolErrorRate ?? 0,
      current: current.toolErrorRate,
      changePercent: ((current.toolErrorRate - (base.toolErrorRate ?? 0)) * 100),
      regressed: true,
    });
  }

  // Avg tool duration increase (>50% regression)
  if ((base.avgToolDurationMs ?? 0) > 0) {
    const baseDuration = base.avgToolDurationMs ?? 0;
    const change = (current.avgToolDurationMs - baseDuration) / baseDuration;
    if (change > 0.5) {
      reports.push({
        scenarioId: baseline.scenarioId,
        metric: 'avgToolDurationMs',
        baseline: baseDuration,
        current: current.avgToolDurationMs,
        changePercent: change * 100,
        regressed: true,
      });
    }
  }

  return reports;
}

export interface CaseChanges {
  newFailures: CaseFailureReport[];
  fixed: CaseFailureReport[];
}

export function checkCaseChanges(
  sr: ScenarioResult,
  baseline: Baseline,
): CaseChanges {
  const newFailures: CaseFailureReport[] = [];
  const fixed: CaseFailureReport[] = [];

  for (const c of sr.cases) {
    const baseCase = baseline.cases[c.caseId];
    if (!baseCase) continue; // new case, skip

    if (baseCase.passed && !c.passed) {
      newFailures.push({
        scenarioId: sr.scenarioId,
        caseId: c.caseId,
        caseName: c.caseName,
        previouslyPassed: true,
        error: c.error,
      });
    } else if (!baseCase.passed && c.passed) {
      fixed.push({
        scenarioId: sr.scenarioId,
        caseId: c.caseId,
        caseName: c.caseName,
        previouslyPassed: false,
      });
    }
  }

  return { newFailures, fixed };
}
