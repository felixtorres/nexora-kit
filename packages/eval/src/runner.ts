import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import type {
  EvalConfig,
  EvalRun,
  Scenario,
  ScenarioResult,
  CaseResult,
  EvalClient,
} from './types.js';
import { startEvalServer } from './server.js';
import { createEvalClient } from './client.js';
import { extractMetrics, aggregateMetrics } from './metrics.js';
import { runValidators } from './validators.js';
import {
  loadBaseline,
  saveBaseline,
  buildBaseline,
  checkRegressions,
  checkCaseChanges,
} from './baseline.js';
import { printReport, writeJsonReport } from './report.js';

export async function runEval(config: EvalConfig): Promise<EvalRun> {
  // 1. Start server
  console.log('  Starting eval server...');
  const server = await startEvalServer(config.target);
  console.log(`  Server ready at ${server.baseUrl}`);
  const client = createEvalClient({
    baseUrl: server.baseUrl,
    adminApiKey: server.adminApiKey,
    userApiKey: server.userApiKey,
  });

  try {
    // 2. Load scenarios
    const scenarios = await loadScenarios(config.scenarios);

    // 3. Filter by tags
    const filtered = config.tags
      ? scenarios.filter((s) => s.tags.some((t) => config.tags!.includes(t)))
      : scenarios;

    if (filtered.length === 0) {
      console.log('No scenarios matched the given tags.');
      return {
        runId: randomUUID(),
        timestamp: new Date().toISOString(),
        scenarios: [],
        regressions: [],
        newFailures: [],
        fixed: [],
      };
    }

    // 4. Run scenarios
    const scenarioResults: ScenarioResult[] = [];
    for (const scenario of filtered) {
      console.log(`  Running scenario: ${scenario.name} (${scenario.cases.length} cases)`);
      const result = await runScenario(scenario, client, config);
      const passed = result.cases.filter((c) => c.passed).length;
      console.log(`  Done: ${passed}/${result.cases.length} passed`);
      scenarioResults.push(result);
    }

    // 5. Baseline comparison
    const allRegressions: import('./types.js').RegressionReport[] = [];
    const allNewFailures: import('./types.js').CaseFailureReport[] = [];
    const allFixed: import('./types.js').CaseFailureReport[] = [];
    for (const sr of scenarioResults) {
      const baseline = await loadBaseline(config.baselineDir, sr.scenarioId);
      if (baseline) {
        const regressions = checkRegressions(sr.aggregate, baseline, config.regression);
        allRegressions.push(...regressions);
        const changes = checkCaseChanges(sr, baseline);
        allNewFailures.push(...changes.newFailures);
        allFixed.push(...changes.fixed);
      }

      if (config.updateBaseline) {
        await saveBaseline(config.baselineDir, buildBaseline(sr));
      }
    }

    const run: EvalRun = {
      runId: randomUUID(),
      timestamp: new Date().toISOString(),
      scenarios: scenarioResults,
      regressions: allRegressions,
      newFailures: allNewFailures,
      fixed: allFixed,
    };

    // 6. Output
    if (config.output === 'console' || config.output === 'both') {
      printReport(run);
    }
    if (config.output === 'json' || config.output === 'both') {
      await writeJsonReport(run);
    }

    return run;
  } finally {
    client.close();
    await server.stop();
  }
}

async function runScenario(
  scenario: Scenario,
  client: EvalClient,
  config: EvalConfig,
): Promise<ScenarioResult> {
  // Setup
  if (scenario.setup) {
    await scenario.setup(client);
  }

  const caseResults: CaseResult[] = [];

  try {
    for (const evalCase of scenario.cases) {
      for (let rep = 0; rep < config.repeat; rep++) {
        const repLabel = config.repeat > 1 ? ` (rep ${rep + 1}/${config.repeat})` : '';
        console.log(`    Case: ${evalCase.name}${repLabel}...`);
        const result = await runCase(evalCase, client);
        const status = result.passed ? 'PASS' : `FAIL${result.error ? ': ' + result.error : ''}`;
        console.log(
          `    -> ${status} (${result.metrics.latencyMs}ms, ${result.metrics.totalTokens} tokens)`,
        );
        caseResults.push(result);
      }
    }
  } finally {
    // Teardown
    if (scenario.teardown) {
      try {
        await scenario.teardown(client);
      } catch {
        // best-effort cleanup
      }
    }
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    cases: caseResults,
    aggregate: aggregateMetrics(caseResults),
  };
}

async function runCase(
  evalCase: import('./types.js').EvalCase,
  client: EvalClient,
): Promise<CaseResult> {
  const CASE_TIMEOUT_MS = 180_000; // 3 minutes per case max

  const TIMEOUT_MSG = `Case "${evalCase.name}" timed out after ${CASE_TIMEOUT_MS / 1000}s`;
  try {
    const casePromise = runCaseInner(evalCase, client);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(TIMEOUT_MSG)), CASE_TIMEOUT_MS),
    );
    return await Promise.race([casePromise, timeoutPromise]);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errorMsg === TIMEOUT_MSG;
    return {
      caseId: evalCase.id,
      caseName: evalCase.name,
      responseText: '',
      wsEvents: [],
      metrics: {
        latencyMs: 0,
        timeToFirstTokenMs: null,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        turns: 0,
        toolCalls: 0,
        toolErrors: 0,
        toolCallDetails: [],
        tokensPerTurn: 0,
        firstTurnResolved: false,
      },
      validations: [],
      passed: false,
      error: errorMsg,
      timedOut: isTimeout,
    };
  }
}

async function runCaseInner(
  evalCase: import('./types.js').EvalCase,
  client: EvalClient,
): Promise<CaseResult> {
  const conv = await client.createConversation(
    evalCase.agentSlug ? { agentSlug: evalCase.agentSlug } : undefined,
  );

  let lastStream: import('./types.js').WsEventStream | undefined;
  const allEvents: import('@nexora-kit/core').ChatEvent[] = [];
  const allTimestamped: import('./types.js').TimestampedEvent[] = [];
  const caseStart = Date.now();

  for (const msg of evalCase.messages) {
    lastStream = await client.sendMessage(conv.id, msg.text);
    allEvents.push(...lastStream.events);
    allTimestamped.push(...lastStream.timestampedEvents);
  }

  const responseText = lastStream?.responseText ?? '';
  const wallClockMs = lastStream?.wallClockMs ?? 0;
  const metrics = extractMetrics(allTimestamped, wallClockMs, caseStart);

  const partialResult: CaseResult = {
    caseId: evalCase.id,
    caseName: evalCase.name,
    responseText,
    wsEvents: allEvents,
    metrics,
    validations: [],
    passed: true,
  };

  const validations = runValidators(evalCase.validate, partialResult);
  const errorEvents = allEvents.filter((event) => event.type === 'error');
  const errorMessage =
    errorEvents.length > 0
      ? errorEvents
          .map((event) => ('message' in event ? event.message : 'Unknown error'))
          .join('; ')
      : undefined;
  const passed = validations.every((v) => v.passed) && errorMessage === undefined;

  return {
    ...partialResult,
    validations,
    passed,
    error: errorMessage,
  };
}

async function loadScenarios(paths: string[]): Promise<Scenario[]> {
  const scenarios: Scenario[] = [];

  for (const scenarioPath of paths) {
    const absPath = resolve(scenarioPath);

    if (absPath.endsWith('.yaml') || absPath.endsWith('.yml')) {
      scenarios.push(...(await loadYamlScenario(absPath)));
    } else {
      // TypeScript/JavaScript module
      const mod = (await import(pathToFileURL(absPath).href)) as Record<string, unknown>;

      // Module can export a single scenario or an array
      if (Array.isArray(mod.default)) {
        scenarios.push(...(mod.default as Scenario[]));
      } else if (mod.default && typeof mod.default === 'object') {
        scenarios.push(mod.default as Scenario);
      } else if (mod.scenario) {
        scenarios.push(mod.scenario as Scenario);
      } else if (mod.scenarios && Array.isArray(mod.scenarios)) {
        scenarios.push(...(mod.scenarios as Scenario[]));
      }
    }
  }

  return scenarios;
}

async function loadYamlScenario(path: string): Promise<Scenario[]> {
  const { readFile } = await import('node:fs/promises');
  const { parse } = await import('yaml');

  const content = await readFile(path, 'utf-8');
  const raw = parse(content) as {
    id: string;
    name: string;
    tags?: string[];
    cases: Array<{
      id: string;
      name: string;
      messages: Array<{ text?: string; content?: string; role?: string }>;
      validate?: Array<RawYamlValidator>;
      validators?: RawYamlValidatorMap;
      botId?: string;
      agentSlug?: string;
      metadata?: Record<string, unknown>;
    }>;
  };

  const cases = raw.cases.map((c) => ({
    id: c.id,
    name: c.name,
    messages: c.messages.map((m) => ({ role: 'user' as const, text: m.text ?? m.content ?? '' })),
    validate: normalizeYamlValidators(c.validate, c.validators),
    botId: c.botId,
    agentSlug: c.agentSlug,
    metadata: c.metadata,
  }));

  return [
    {
      id: raw.id,
      name: raw.name,
      tags: raw.tags ?? [],
      cases,
    },
  ];
}

type RawYamlValidator = {
  type: string;
  value?: string;
  pattern?: string;
  flags?: string;
  limit?: number;
  caseSensitive?: boolean;
};

type RawYamlValidatorMap = {
  contains?: string[];
  not_contains?: string[];
  regex?: string[];
  max_tokens?: number;
  max_turns?: number;
  max_latency_ms?: number;
  json_valid?: boolean;
};

function normalizeYamlValidators(
  validate?: RawYamlValidator[],
  validators?: RawYamlValidatorMap,
): import('./types.js').Validator[] {
  const normalized: RawYamlValidator[] = [...(validate ?? [])];

  if (validators?.contains) {
    normalized.push(...validators.contains.map((value) => ({ type: 'contains', value })));
  }

  if (validators?.not_contains) {
    normalized.push(...validators.not_contains.map((value) => ({ type: 'not_contains', value })));
  }

  if (validators?.regex) {
    normalized.push(...validators.regex.map((pattern) => ({ type: 'regex', pattern })));
  }

  if (typeof validators?.max_tokens === 'number') {
    normalized.push({ type: 'max_tokens', limit: validators.max_tokens });
  }

  if (typeof validators?.max_turns === 'number') {
    normalized.push({ type: 'max_turns', limit: validators.max_turns });
  }

  if (typeof validators?.max_latency_ms === 'number') {
    normalized.push({ type: 'max_latency_ms', limit: validators.max_latency_ms });
  }

  if (validators?.json_valid) {
    normalized.push({ type: 'json_valid' });
  }

  return normalized.map((v) => {
    switch (v.type) {
      case 'contains':
        return { type: 'contains' as const, value: v.value!, caseSensitive: v.caseSensitive };
      case 'not_contains':
        return { type: 'not_contains' as const, value: v.value! };
      case 'regex':
        return normalizeRegexValidator(v.pattern!, v.flags);
      case 'json_valid':
        return { type: 'json_valid' as const };
      case 'max_tokens':
        return { type: 'max_tokens' as const, limit: v.limit! };
      case 'max_turns':
        return { type: 'max_turns' as const, limit: v.limit! };
      case 'max_latency_ms':
        return { type: 'max_latency_ms' as const, limit: v.limit! };
      default:
        throw new Error(`Unknown validator type in YAML: ${v.type}`);
    }
  });
}

function normalizeRegexValidator(pattern: string, flags?: string): import('./types.js').Validator {
  let normalizedPattern = pattern;
  let normalizedFlags = flags ?? '';

  const inlineFlagMatch = normalizedPattern.match(/^\(\?([a-z]+)\)(.*)$/i);
  if (inlineFlagMatch) {
    normalizedFlags = `${normalizedFlags}${inlineFlagMatch[1]}`;
    normalizedPattern = inlineFlagMatch[2];
  }

  normalizedFlags = Array.from(new Set(normalizedFlags.split(''))).join('');

  return {
    type: 'regex' as const,
    pattern: normalizedPattern,
    flags: normalizedFlags || undefined,
  };
}
