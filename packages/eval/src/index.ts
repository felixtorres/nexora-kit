// Core types
export type {
  Scenario,
  EvalCase,
  EvalMessage,
  Validator,
  ValidationResult,
  EvalConfig,
  EvalTarget,
  EvalTargetConfig,
  EvalTargetUrl,
  EvalClient,
  WsEventStream,
  CaseResult,
  CaseMetrics,
  CaseValidation,
  ScenarioResult,
  AggregateMetrics,
  EvalRun,
  Baseline,
  RegressionThresholds,
  RegressionReport,
  EvalServer,
  ToolCallDetail,
  TimestampedEvent,
  BaselineCaseEntry,
  CaseFailureReport,
} from './types.js';

// Runner
export { runEval } from './runner.js';

// Client
export { createEvalClient } from './client.js';

// Server
export { startEvalServer } from './server.js';

// Config
export { loadEvalConfig } from './config.js';

// Metrics
export { extractMetrics, aggregateMetrics } from './metrics.js';

// Validators
export { runValidators } from './validators.js';

// Baseline
export { loadBaseline, saveBaseline, buildBaseline, checkRegressions, checkCaseChanges } from './baseline.js';

// Report
export { printReport, writeJsonReport } from './report.js';
