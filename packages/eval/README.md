# @nexora-kit/eval

Eval framework for NexoraKit instances. Runs scenarios against a live server (HTTP + WebSocket), collects rich metrics, validates responses, and detects regressions against saved baselines.

## Quick Start

### 1. Create an eval config

Create `eval.yaml` in your instance directory:

```yaml
target:
  type: config
  configPath: ./nexora.yaml

scenarios:
  - ./evals/smoke.yaml

repeat: 1
concurrency: 1
baselineDir: ./eval-baselines

regression:
  maxTokenIncrease: 0.15
  maxLatencyIncrease: 0.25
  maxPassRateDecrease: 0.05
```

### 2. Write a scenario

The simplest way is a YAML scenario. Create `evals/smoke.yaml`:

```yaml
id: smoke
name: Basic Smoke Test
tags: [smoke, ci]
cases:
  - id: greeting
    name: Responds to hello
    messages:
      - text: Hello, how are you?
    validate:
      - type: contains
        value: hello
      - type: max_turns
        limit: 3
      - type: max_latency_ms
        limit: 10000
```

### 3. Run it

```bash
npx nexora-eval --config eval.yaml
```

That's it. The framework boots your NexoraKit instance from `nexora.yaml`, runs the scenario, and prints results.

## Writing Scenarios

### YAML Scenarios (declarative)

Best for simple smoke tests and regression checks. Supports all built-in validators but no setup/teardown or custom validators.

```yaml
id: faq-accuracy
name: FAQ Bot Accuracy
tags: [faq, regression]
cases:
  - id: returns-policy
    name: Returns policy question
    messages:
      - text: What is your returns policy?
    validate:
      - type: contains
        value: "30 days"
      - type: not_contains
        value: "I don't know"
      - type: max_tokens
        limit: 2000

  - id: multi-turn
    name: Follow-up question
    messages:
      - text: What products do you sell?
      - text: Which ones are on sale?
    validate:
      - type: regex
        pattern: "\\$\\d+"
        flags: g
```

### TypeScript Scenarios (full control)

Use TypeScript when you need setup/teardown, custom validators, or dynamic test generation.

```typescript
// evals/onboarding.ts
import type { Scenario, CaseResult, ValidationResult } from '@nexora-kit/eval';

export const scenario: Scenario = {
  id: 'onboarding-flow',
  name: 'Onboarding Bot E2E',
  tags: ['onboarding', 'e2e'],

  async setup(client) {
    // Create a bot with specific config
    await client.createBot({
      name: 'Onboarding Bot',
      slug: 'onboarding',
      systemPrompt: 'You are an onboarding assistant. Guide new users through setup.',
      model: 'claude-haiku-4-5',
    });

    await client.createAgent({
      name: 'Onboarding Agent',
      slug: 'onboard',
    });
  },

  cases: [
    {
      id: 'welcome',
      name: 'Welcome message',
      messages: [{ role: 'user', text: 'Hi, I just signed up' }],
      validate: [
        { type: 'contains', value: 'welcome' },
        { type: 'max_turns', limit: 2 },
        {
          type: 'custom',
          name: 'asks-a-question',
          fn: (result: CaseResult): ValidationResult => ({
            passed: result.responseText.includes('?'),
            message: result.responseText.includes('?')
              ? 'Bot asked a follow-up question'
              : 'Bot did not ask a follow-up question',
          }),
        },
      ],
    },
  ],

  async teardown(_client) {
    // Cleanup is automatic with ephemeral :memory: SQLite in boot mode
  },
};

export default scenario;
```

Reference the TS scenario in your config:

```yaml
scenarios:
  - ./evals/onboarding.ts
```

### Module Export Formats

TypeScript scenarios can export in any of these forms:

```typescript
// Single scenario (default export)
export default scenario;

// Single scenario (named)
export const scenario: Scenario = { ... };

// Multiple scenarios (named array)
export const scenarios: Scenario[] = [scenarioA, scenarioB];

// Multiple scenarios (default array)
export default [scenarioA, scenarioB];
```

## Built-in Validators

| Validator | Config | Description |
|-----------|--------|-------------|
| `contains` | `value`, `caseSensitive?` | Substring check on response text |
| `not_contains` | `value` | Absence check |
| `regex` | `pattern`, `flags?` | Regex match on response text |
| `json_valid` | — | Response text parses as valid JSON |
| `max_tokens` | `limit` | Total tokens (input + output) under threshold |
| `max_turns` | `limit` | Agent turn count under threshold |
| `max_latency_ms` | `limit` | Wall-clock time under threshold |
| `custom` | `name`, `fn` | Arbitrary function (TS scenarios only) |

## CLI Reference

```
nexora-eval [options]

Options:
  --config, -c <path>    Eval config YAML (default: eval.yaml)
  --scenario, -s <path>  Single scenario file (overrides config)
  --tags, -t <tags>      Comma-separated tag filter
  --target <url>         Connect to running server instead of booting one
  --api-key <key>        API key for external server
  --repeat, -r <n>       Repetitions per case (default: 1)
  --update-baseline      Save results as new baseline
  --ci                   Exit code 1 on regression or failure
  --output, -o <mode>    console | json | both (default: console)
  --help                 Show help
```

### Examples

```bash
# Run all scenarios
npx nexora-eval

# Run a single scenario file
npx nexora-eval -s ./evals/smoke.yaml

# Filter by tags
npx nexora-eval -t smoke,ci

# Run against a live server
npx nexora-eval --target http://localhost:3000 --api-key my-key

# Repeat each case 5 times for statistical confidence
npx nexora-eval -r 5

# Save baseline + JSON report
npx nexora-eval --update-baseline -o both

# CI mode (exits 1 on failure or regression)
npx nexora-eval --ci
```

## Baseline Workflow

Baselines let you detect regressions in token usage, latency, and pass rate across runs.

### 1. Establish a baseline

```bash
npx nexora-eval --update-baseline
```

This saves `<baselineDir>/<scenarioId>.baseline.json` for each scenario. Commit these files to git.

### 2. Run against baseline in CI

```bash
npx nexora-eval --ci
```

The framework compares current metrics against the saved baseline and flags regressions that exceed your configured thresholds:

| Metric | Default Threshold | Meaning |
|--------|-------------------|---------|
| `maxTokenIncrease` | 15% | Average token usage increased |
| `maxLatencyIncrease` | 25% | p95 latency increased |
| `maxPassRateDecrease` | 5% | Pass rate dropped |

### 3. Update baseline after intentional changes

When you make changes that intentionally affect metrics (new system prompt, different model), update the baseline:

```bash
npx nexora-eval --update-baseline
git add eval-baselines/
git commit -m "eval: update baselines after model change"
```

## A/B Comparison

Compare two approaches (e.g., tools vs sandbox) within a single eval run.

### Using the built-in sandbox A/B scenario

```yaml
scenarios:
  - node_modules/@nexora-kit/eval/dist/scenarios/sandbox-ab.js
```

This creates two bots — one using individual tools, one using code execution — and runs the same question through both.

### Writing your own A/B scenario

Tag cases with `metadata.variant` to identify which group they belong to:

```typescript
export const scenario: Scenario = {
  id: 'prompt-ab',
  name: 'System Prompt A/B',
  tags: ['ab'],

  async setup(client) {
    await client.createBot({
      name: 'Bot A - Concise',
      slug: 'concise',
      systemPrompt: 'Be concise. Answer in 1-2 sentences.',
    });
    await client.createBot({
      name: 'Bot B - Detailed',
      slug: 'detailed',
      systemPrompt: 'Give thorough, detailed answers with examples.',
    });
  },

  cases: [
    {
      id: 'concise-greeting',
      name: 'Concise bot greeting',
      messages: [{ role: 'user', text: 'Explain recursion' }],
      metadata: { variant: 'concise' },
      validate: [
        { type: 'max_tokens', limit: 500 },
        { type: 'contains', value: 'recursion' },
      ],
    },
    {
      id: 'detailed-greeting',
      name: 'Detailed bot greeting',
      messages: [{ role: 'user', text: 'Explain recursion' }],
      metadata: { variant: 'detailed' },
      validate: [
        { type: 'contains', value: 'example' },
        { type: 'contains', value: 'recursion' },
      ],
    },
  ],
};
```

**A/B workflow:**

1. Run the "control" variant first and save as baseline:
   ```bash
   npx nexora-eval -s evals/prompt-ab.ts -t concise --update-baseline
   ```

2. Run the "candidate" variant and compare:
   ```bash
   npx nexora-eval -s evals/prompt-ab.ts --ci
   ```

Or run both variants in a single eval and compare the results in the JSON report.

## Server Modes

### Boot mode (default)

The eval framework boots a full NexoraKit instance from your `nexora.yaml`:

- Uses `:memory:` SQLite (ephemeral, no cleanup needed)
- Assigns a random port (OS-selected)
- Hardcodes eval API keys internally
- Discovers and loads plugins from your plugins directory
- Uses your configured LLM provider

```yaml
target:
  type: config
  configPath: ./nexora.yaml
```

### Connect mode

Point at a running server instead:

```yaml
target:
  type: url
  url: http://localhost:3000
  apiKey: ${NEXORA_API_KEY}
  adminApiKey: ${NEXORA_ADMIN_KEY}
```

Or via CLI:

```bash
npx nexora-eval --target http://localhost:3000 --api-key my-key
```

Environment variables are interpolated with `${VAR}` syntax in the config file.

## Metrics Collected

Every case collects these metrics via WebSocket event streaming:

| Metric | Source |
|--------|--------|
| `latencyMs` | Wall-clock time |
| `timeToFirstTokenMs` | First `text` event |
| `inputTokens` | Sum of `usage` events |
| `outputTokens` | Sum of `usage` events |
| `totalTokens` | input + output |
| `turns` | Count of `turn_start` events |
| `toolCalls` | Count of `tool_call` events |
| `toolCallDetails` | Name + duration per tool call |

Aggregate metrics per scenario: pass rate, latency p50/p95/p99, averages for tokens/turns/tool calls.

## Programmatic API

Use the eval framework from your own scripts:

```typescript
import { runEval, loadEvalConfig } from '@nexora-kit/eval';

const config = await loadEvalConfig('eval.yaml', {});
const run = await runEval(config);

console.log(`Pass rate: ${run.scenarios[0].aggregate.passRate}`);
console.log(`Regressions: ${run.regressions.filter(r => r.regressed).length}`);
```

Or use individual components:

```typescript
import { startEvalServer, createEvalClient, extractMetrics, runValidators } from '@nexora-kit/eval';

// Boot server
const server = await startEvalServer({ type: 'config', configPath: 'nexora.yaml' });
const client = createEvalClient(server);

// Run a conversation
const conv = await client.createConversation();
const stream = await client.sendMessage(conv.id, 'Hello');
const metrics = extractMetrics(stream.events, stream.wallClockMs);

console.log(`Tokens: ${metrics.totalTokens}, Turns: ${metrics.turns}`);

client.close();
await server.stop();
```
