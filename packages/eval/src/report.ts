import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EvalRun, ScenarioResult, CaseResult, RegressionReport, CaseFailureReport } from './types.js';

export function printReport(run: EvalRun): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  Eval Run: ${run.runId}`);
  console.log(`  Time:     ${run.timestamp}`);
  console.log(`${'='.repeat(80)}\n`);

  for (const scenario of run.scenarios) {
    printScenarioSummary(scenario);
  }

  if (run.fixed.length > 0) {
    printFixed(run.fixed);
  }

  if (run.newFailures.length > 0) {
    printNewFailures(run.newFailures);
  }

  if (run.regressions.length > 0) {
    printRegressions(run.regressions);
  }

  // Final summary
  const totalCases = run.scenarios.reduce((s, sc) => s + sc.cases.length, 0);
  const passedCases = run.scenarios.reduce((s, sc) => s + sc.cases.filter((c) => c.passed).length, 0);
  const hasRegressions = run.regressions.some((r) => r.regressed);
  const hasNewFailures = run.newFailures.length > 0;

  console.log(`${'-'.repeat(80)}`);
  console.log(`  Total: ${totalCases} cases, ${passedCases} passed, ${totalCases - passedCases} failed`);
  if (run.fixed.length > 0) {
    console.log(`  FIXED: ${run.fixed.length} case(s) that previously failed are now passing`);
  }
  if (hasNewFailures) {
    console.log(`  NEW FAILURES: ${run.newFailures.length} case(s) that previously passed are now failing`);
  }
  if (hasRegressions) {
    console.log('  REGRESSIONS DETECTED');
  }
  console.log('');
}

function printScenarioSummary(scenario: ScenarioResult): void {
  const agg = scenario.aggregate;
  const status = agg.passRate === 1 ? 'PASS' : agg.passRate === 0 ? 'FAIL' : 'PARTIAL';

  console.log(`  [${status}] ${scenario.scenarioName} (${scenario.scenarioId})`);
  console.log('');

  // Summary table
  console.log(
    '    ' +
    pad('Metric', 24) +
    pad('Value', 15),
  );
  console.log('    ' + '-'.repeat(39));
  console.log('    ' + pad('Pass Rate', 24) + pad(`${(agg.passRate * 100).toFixed(1)}%`, 15));

  if (agg.errorRate > 0) {
    console.log('    ' + pad('Error Rate', 24) + pad(`${(agg.errorRate * 100).toFixed(1)}%`, 15));
  }
  if (agg.timeoutRate > 0) {
    console.log('    ' + pad('Timeout Rate', 24) + pad(`${(agg.timeoutRate * 100).toFixed(1)}%`, 15));
  }
  if (agg.toolErrorRate > 0) {
    console.log('    ' + pad('Tool Error Rate', 24) + pad(`${(agg.toolErrorRate * 100).toFixed(1)}%`, 15));
  }

  console.log('    ' + pad('Latency p50', 24) + pad(`${agg.latencyP50.toFixed(0)}ms`, 15));
  console.log('    ' + pad('Latency p95', 24) + pad(`${agg.latencyP95.toFixed(0)}ms`, 15));
  console.log('    ' + pad('Latency p99', 24) + pad(`${agg.latencyP99.toFixed(0)}ms`, 15));
  console.log('    ' + pad('Avg Tokens', 24) + pad(agg.avgTokens.toFixed(0), 15));
  console.log('    ' + pad('Avg Tokens/Turn', 24) + pad(agg.avgTokensPerTurn.toFixed(0), 15));
  console.log('    ' + pad('Avg Turns', 24) + pad(agg.avgTurns.toFixed(1), 15));
  console.log('    ' + pad('Avg Tool Calls', 24) + pad(agg.avgToolCalls.toFixed(1), 15));

  if (agg.avgToolDurationMs > 0) {
    console.log('    ' + pad('Avg Tool Duration', 24) + pad(`${agg.avgToolDurationMs.toFixed(0)}ms`, 15));
  }

  console.log('    ' + pad('1st Turn Resolution', 24) + pad(`${(agg.firstTurnResolutionRate * 100).toFixed(1)}%`, 15));
  console.log('');

  // Per-case details for failures
  const failures = scenario.cases.filter((c) => !c.passed);
  if (failures.length > 0) {
    console.log('    Failed cases:');
    for (const c of failures) {
      printCaseFailure(c);
    }
    console.log('');
  }
}

function printCaseFailure(c: CaseResult): void {
  const tags: string[] = [];
  if (c.timedOut) tags.push('TIMEOUT');
  if (c.error && !c.timedOut) tags.push('ERROR');
  const suffix = tags.length > 0 ? ` [${tags.join(', ')}]` : '';

  console.log(`      - ${c.caseName} (${c.caseId})${suffix}`);
  if (c.error) {
    console.log(`        Error: ${c.error}`);
  }
  for (const v of c.validations) {
    if (!v.passed) {
      console.log(`        FAIL: ${v.validator} — ${v.message}`);
    }
  }
}

function printFixed(fixed: CaseFailureReport[]): void {
  console.log('  Fixed (previously failing, now passing):');
  for (const f of fixed) {
    console.log(`    + ${f.caseName} (${f.scenarioId}/${f.caseId})`);
  }
  console.log('');
}

function printNewFailures(failures: CaseFailureReport[]): void {
  console.log('  New Failures (previously passing, now failing):');
  console.log(
    '    ' +
    pad('Scenario', 25) +
    pad('Case', 30) +
    pad('Error', 25),
  );
  console.log('    ' + '-'.repeat(80));

  for (const f of failures) {
    console.log(
      '    ' +
      pad(f.scenarioId, 25) +
      pad(f.caseName, 30) +
      pad(f.error ?? '(validation)', 25),
    );
  }
  console.log('');
}

function printRegressions(regressions: RegressionReport[]): void {
  const flagged = regressions.filter((r) => r.regressed);
  if (flagged.length === 0) return;

  console.log('  Metric Regressions:');
  console.log(
    '    ' +
    pad('Scenario', 25) +
    pad('Metric', 20) +
    pad('Baseline', 12) +
    pad('Current', 12) +
    pad('Change', 10),
  );
  console.log('    ' + '-'.repeat(79));

  for (const r of flagged) {
    const sign = r.changePercent >= 0 ? '+' : '';
    console.log(
      '    ' +
      pad(r.scenarioId, 25) +
      pad(r.metric, 20) +
      pad(r.baseline.toFixed(1), 12) +
      pad(r.current.toFixed(1), 12) +
      pad(`${sign}${r.changePercent.toFixed(1)}%`, 10),
    );
  }
  console.log('');
}

export async function writeJsonReport(run: EvalRun, path?: string): Promise<void> {
  const outPath = path ?? `eval-report-${run.runId}.json`;
  await mkdir(dirname(outPath), { recursive: true }).catch(() => {});
  await writeFile(outPath, JSON.stringify(run, null, 2) + '\n', 'utf-8');
  console.log(`  JSON report written to: ${outPath}`);
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}
