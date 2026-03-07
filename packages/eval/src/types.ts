import type { ChatEvent } from '@nexora-kit/core';

// ---------------------------------------------------------------------------
// Timestamped events (for accurate duration tracking)
// ---------------------------------------------------------------------------

export interface TimestampedEvent {
  event: ChatEvent;
  receivedAt: number; // Date.now() when the WS frame was received
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export interface ContainsValidator {
  type: 'contains';
  value: string;
  caseSensitive?: boolean;
}

export interface NotContainsValidator {
  type: 'not_contains';
  value: string;
}

export interface RegexValidator {
  type: 'regex';
  pattern: string;
  flags?: string;
}

export interface JsonValidValidator {
  type: 'json_valid';
}

export interface MaxTokensValidator {
  type: 'max_tokens';
  limit: number;
}

export interface MaxTurnsValidator {
  type: 'max_turns';
  limit: number;
}

export interface MaxLatencyMsValidator {
  type: 'max_latency_ms';
  limit: number;
}

export interface CustomValidator {
  type: 'custom';
  name: string;
  fn: (result: CaseResult) => ValidationResult;
}

export type Validator =
  | ContainsValidator
  | NotContainsValidator
  | RegexValidator
  | JsonValidValidator
  | MaxTokensValidator
  | MaxTurnsValidator
  | MaxLatencyMsValidator
  | CustomValidator;

export interface ValidationResult {
  passed: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Eval Cases & Scenarios
// ---------------------------------------------------------------------------

export interface EvalMessage {
  role: 'user';
  text: string;
}

export interface EvalCase {
  id: string;
  name: string;
  messages: EvalMessage[];
  validate: Validator[];
  botId?: string;
  agentSlug?: string;
  metadata?: Record<string, unknown>;
}

export interface EvalClient {
  baseUrl: string;
  adminApiKey: string;
  userApiKey: string;

  // Admin REST
  createBot(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  createAgent(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  replaceBindings(agentId: string, botIds: string[]): Promise<void>;
  enablePlugin(namespace: string): Promise<void>;
  disablePlugin(namespace: string): Promise<void>;

  // Conversation REST
  createConversation(body?: Record<string, unknown>): Promise<{ id: string }>;
  getMessages(conversationId: string): Promise<Array<{ role: string; content: unknown }>>;

  // WebSocket messaging
  sendMessage(conversationId: string, text: string, timeoutMs?: number): Promise<WsEventStream>;

  // Cleanup
  close(): void;
}

export interface WsEventStream {
  events: ChatEvent[];
  timestampedEvents: TimestampedEvent[];
  responseText: string;
  wallClockMs: number;
}

export interface Scenario {
  id: string;
  name: string;
  tags: string[];
  setup?: (client: EvalClient) => Promise<void>;
  cases: EvalCase[];
  teardown?: (client: EvalClient) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface ToolCallDetail {
  name: string;
  durationMs?: number;
}

export interface CaseMetrics {
  latencyMs: number;
  timeToFirstTokenMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  toolCallDetails: ToolCallDetail[];
  tokensPerTurn: number;
  firstTurnResolved: boolean;
}

export interface AggregateMetrics {
  passRate: number;
  errorRate: number;
  timeoutRate: number;
  toolErrorRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  avgTokens: number;
  avgTurns: number;
  avgToolCalls: number;
  avgToolDurationMs: number;
  avgTokensPerTurn: number;
  firstTurnResolutionRate: number;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface CaseValidation {
  validator: string;
  passed: boolean;
  message: string;
}

export interface CaseResult {
  caseId: string;
  caseName: string;
  responseText: string;
  wsEvents: ChatEvent[];
  metrics: CaseMetrics;
  validations: CaseValidation[];
  passed: boolean;
  error?: string;
  timedOut?: boolean;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  cases: CaseResult[];
  aggregate: AggregateMetrics;
}

// ---------------------------------------------------------------------------
// Baselines & Regressions
// ---------------------------------------------------------------------------

export interface BaselineCaseEntry {
  passed: boolean;
  metrics: CaseMetrics;
}

export interface Baseline {
  scenarioId: string;
  timestamp: string;
  aggregate: AggregateMetrics;
  cases: Record<string, BaselineCaseEntry>;
}

export interface CaseFailureReport {
  scenarioId: string;
  caseId: string;
  caseName: string;
  previouslyPassed: boolean;
  error?: string;
}

export interface RegressionThresholds {
  maxTokenIncrease: number;
  maxLatencyIncrease: number;
  maxPassRateDecrease: number;
}

export interface RegressionReport {
  scenarioId: string;
  metric: string;
  baseline: number;
  current: number;
  changePercent: number;
  regressed: boolean;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface EvalTargetConfig {
  type: 'config';
  configPath: string;
}

export interface EvalTargetUrl {
  type: 'url';
  url: string;
  apiKey: string;
  adminApiKey?: string;
}

export type EvalTarget = EvalTargetConfig | EvalTargetUrl;

export interface EvalConfig {
  target: EvalTarget;
  scenarios: string[];
  tags?: string[];
  repeat: number;
  concurrency: number;
  baselineDir: string;
  regression: RegressionThresholds;
  output: 'console' | 'json' | 'both';
  updateBaseline: boolean;
  ci: boolean;
}

// ---------------------------------------------------------------------------
// Eval Run
// ---------------------------------------------------------------------------

export interface EvalRun {
  runId: string;
  timestamp: string;
  scenarios: ScenarioResult[];
  regressions: RegressionReport[];
  newFailures: CaseFailureReport[];
  fixed: CaseFailureReport[];
}

// ---------------------------------------------------------------------------
// Server handle
// ---------------------------------------------------------------------------

export interface EvalServer {
  baseUrl: string;
  adminApiKey: string;
  userApiKey: string;
  stop(): Promise<void>;
}
