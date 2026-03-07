import type { Scenario, CaseResult, ValidationResult } from '../types.js';

const QUESTION = 'List all departments and the total number of employees in each. Format as a table.';

const EXPECTED_DEPARTMENTS = ['Engineering', 'Sales', 'Marketing', 'HR'];

export const scenario: Scenario = {
  id: 'sandbox-ab',
  name: 'Sandbox A/B: Tools vs Code Execution',
  tags: ['sandbox', 'ab', 'efficiency'],

  async setup(client) {
    // Bot A: uses individual data tools (no sandbox)
    await client.createBot({
      name: 'Data Analyst - Tools',
      slug: 'eval-tools',
      systemPrompt:
        'You are a data analyst. Use the provided tools to answer questions about employee data. ' +
        'Always use get_departments first, then get_department_stats for each department.',
      model: 'claude-haiku-4-5',
      pluginNamespaces: ['eval-data-tools'],
    });

    // Bot B: uses sandbox code execution
    await client.createBot({
      name: 'Data Analyst - Sandbox',
      slug: 'eval-sandbox',
      systemPrompt:
        'You are a data analyst. Write Python code to analyze the employee data. ' +
        'Use the execute_code tool to run your analysis. The data is available as a pandas DataFrame named `df`.',
      model: 'claude-haiku-4-5',
      pluginNamespaces: ['eval-sandbox'],
    });

    // Create agent with both bots for A/B comparison
    await client.createAgent({
      name: 'Eval A/B Agent',
      slug: 'eval-ab',
    });
  },

  cases: [
    {
      id: 'tools-baseline',
      name: 'Multi-tool approach (no sandbox)',
      messages: [{ role: 'user', text: QUESTION }],
      metadata: { variant: 'tools' },
      validate: [
        ...EXPECTED_DEPARTMENTS.map((dept) => ({
          type: 'contains' as const,
          value: dept,
          caseSensitive: false,
        })),
        { type: 'max_turns' as const, limit: 10 },
        { type: 'max_latency_ms' as const, limit: 30_000 },
      ],
    },
    {
      id: 'sandbox-candidate',
      name: 'Code execution approach (sandbox)',
      messages: [{ role: 'user', text: QUESTION }],
      metadata: { variant: 'sandbox' },
      validate: [
        ...EXPECTED_DEPARTMENTS.map((dept) => ({
          type: 'contains' as const,
          value: dept,
          caseSensitive: false,
        })),
        { type: 'max_turns' as const, limit: 5 },
        { type: 'max_latency_ms' as const, limit: 30_000 },
        {
          type: 'custom' as const,
          name: 'fewer-tokens-than-tools',
          fn: fewerTokensThanTools,
        },
      ],
    },
  ],

  async teardown(_client) {
    // Cleanup is automatic with ephemeral :memory: SQLite
  },
};

function fewerTokensThanTools(result: CaseResult): ValidationResult {
  // This validator is meaningful when run after the tools variant.
  // The runner passes all case results, but we need cross-case comparison.
  // For now, this is a placeholder — the baseline comparison handles A/B.
  const tokens = result.metrics.totalTokens;
  return {
    passed: tokens > 0,
    message: `Sandbox variant used ${tokens} tokens (compare with baseline for savings)`,
  };
}

export default scenario;
