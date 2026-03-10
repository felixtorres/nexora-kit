/**
 * Pure-TypeScript prompt optimizer.
 *
 * Takes scored execution traces + the current prompt, asks an LLM to
 * reflect on failures and produce an improved prompt. No Python, no
 * subprocess, no Pareto frontier — just "here's what went wrong, fix it."
 */

import type { LlmProvider } from '@nexora-kit/llm';

export interface ScoredTrace {
  prompt: string;
  finalAnswer: string;
  score: number;
  scoreFeedback: string;
  toolCalls?: { name: string; isError: boolean }[];
}

export interface OptimizationResult {
  optimizedPrompt: string;
  reflectionLog: string;
  estimatedScore: number;
  scoreImprovement: number;
  tracesAnalyzed: number;
}

export interface PromptOptimizerConfig {
  llm: LlmProvider;
  /** Model to use for the reflection/rewrite call. Defaults to first available model. */
  model?: string;
  /** Max tokens for the LLM response. Default: 2048 */
  maxTokens?: number;
}

export class PromptOptimizer {
  private readonly llm: LlmProvider;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: PromptOptimizerConfig) {
    this.llm = config.llm;
    this.model = config.model ?? config.llm.models[0]?.id ?? 'default';
    this.maxTokens = config.maxTokens ?? 2048;
  }

  async optimize(input: {
    currentPrompt: string;
    componentType: string;
    componentName: string;
    traces: ScoredTrace[];
  }): Promise<OptimizationResult> {
    const { currentPrompt, componentType, componentName, traces } = input;

    // Partition traces
    const failures = traces.filter((t) => t.score < 0.5).sort((a, b) => a.score - b.score);
    const successes = traces.filter((t) => t.score >= 0.5).sort((a, b) => b.score - a.score);
    const avgScore = traces.reduce((sum, t) => sum + t.score, 0) / traces.length;

    // Build the reflection prompt
    const reflectionPrompt = buildReflectionPrompt({
      currentPrompt,
      componentType,
      componentName,
      failures: failures.slice(0, 5),
      successes: successes.slice(0, 3),
      avgScore,
    });

    // Call the LLM
    const response = await this.callLlm(reflectionPrompt);

    // Parse the response — extract the improved prompt and reflection
    const { improvedPrompt, reflection } = parseResponse(response, currentPrompt);

    const estimatedImprovement = Math.min(0.2, (1.0 - avgScore) * 0.3);

    return {
      optimizedPrompt: improvedPrompt,
      reflectionLog: reflection,
      estimatedScore: Math.min(1, avgScore + estimatedImprovement),
      scoreImprovement: estimatedImprovement,
      tracesAnalyzed: traces.length,
    };
  }

  private async callLlm(prompt: string): Promise<string> {
    const chunks: string[] = [];

    for await (const event of this.llm.chat({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: this.maxTokens,
      stream: true,
    })) {
      if (event.type === 'text') {
        chunks.push(event.content);
      }
    }

    return chunks.join('');
  }
}

function buildReflectionPrompt(input: {
  currentPrompt: string;
  componentType: string;
  componentName: string;
  failures: ScoredTrace[];
  successes: ScoredTrace[];
  avgScore: number;
}): string {
  const { currentPrompt, componentType, componentName, failures, successes, avgScore } = input;

  let prompt = `You are a prompt engineer. A ${componentType} called "${componentName}" is underperforming (average score: ${avgScore.toFixed(2)}/1.0). Your job is to rewrite its prompt to fix the identified problems.

## Current Prompt
${currentPrompt}

## Failure Analysis (${failures.length} worst traces)
`;

  for (const f of failures) {
    prompt += `\n### Score: ${f.score.toFixed(2)}`;
    prompt += `\nDiagnostic: ${f.scoreFeedback}`;
    prompt += `\nAgent answered: ${truncate(f.finalAnswer, 150)}`;
    if (f.toolCalls?.some((tc) => tc.isError)) {
      prompt += `\nTool errors: ${f.toolCalls.filter((tc) => tc.isError).map((tc) => tc.name).join(', ')}`;
    }
    prompt += '\n';
  }

  if (successes.length > 0) {
    prompt += `\n## What Works (${successes.length} best traces)\n`;
    for (const s of successes) {
      prompt += `\n- Score ${s.score.toFixed(2)}: ${truncate(s.finalAnswer, 100)}`;
    }
  }

  prompt += `

## Instructions
1. Diagnose WHY the failures happened based on the diagnostic feedback
2. Write an improved prompt that fixes those specific problems
3. Keep what already works — don't over-optimize for failure cases

Respond in this exact format:

<reflection>
[Your analysis of what went wrong and what to fix]
</reflection>

<improved_prompt>
[The complete rewritten prompt]
</improved_prompt>`;

  return prompt;
}

function parseResponse(
  response: string,
  fallbackPrompt: string,
): { improvedPrompt: string; reflection: string } {
  const promptMatch = response.match(/<improved_prompt>\s*([\s\S]*?)\s*<\/improved_prompt>/);
  const reflectionMatch = response.match(/<reflection>\s*([\s\S]*?)\s*<\/reflection>/);

  return {
    improvedPrompt: promptMatch?.[1]?.trim() || fallbackPrompt,
    reflection: reflectionMatch?.[1]?.trim() || response.slice(0, 500),
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
