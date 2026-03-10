import { describe, it, expect } from 'vitest';
import { PromptOptimizer, type ScoredTrace } from './prompt-optimizer.js';
import type { LlmProvider } from '@nexora-kit/llm';

function mockLlm(response: string): LlmProvider {
  return {
    name: 'mock',
    models: [{ id: 'mock-model', name: 'Mock', provider: 'mock', contextWindow: 8000, maxOutputTokens: 2000 }],
    async *chat() {
      yield { type: 'text' as const, content: response };
      yield { type: 'done' as const };
    },
    async countTokens() { return 100; },
  };
}

function makeTraces(scores: number[]): ScoredTrace[] {
  return scores.map((score, i) => ({
    prompt: `test input ${i}`,
    finalAnswer: score >= 0.5 ? 'good answer' : 'bad answer',
    score,
    scoreFeedback: score < 0.5
      ? 'Answer was incorrect — missing key information'
      : 'Answer was appropriate and helpful',
  }));
}

describe('PromptOptimizer', () => {
  it('calls the LLM and parses a well-formatted response', async () => {
    const llm = mockLlm(`
<reflection>
The prompt fails because it doesn't specify the expected output format. Users get verbose answers when they need concise ones.
</reflection>

<improved_prompt>
You are a helpful assistant. Always respond concisely in 1-2 sentences. Focus on the most important information first.
</improved_prompt>
    `);

    const optimizer = new PromptOptimizer({ llm });
    const result = await optimizer.optimize({
      currentPrompt: 'You are a helpful assistant.',
      componentType: 'skill',
      componentName: 'greeting',
      traces: makeTraces([0.3, 0.4, 0.2, 0.8, 0.9, 0.7]),
    });

    expect(result.optimizedPrompt).toContain('concisely');
    expect(result.reflectionLog).toContain('output format');
    expect(result.tracesAnalyzed).toBe(6);
    expect(result.estimatedScore).toBeGreaterThan(0.5);
    expect(result.scoreImprovement).toBeGreaterThan(0);
  });

  it('falls back to original prompt when LLM response has no tags', async () => {
    const llm = mockLlm('Here is a better prompt: Be more specific.');

    const optimizer = new PromptOptimizer({ llm });
    const result = await optimizer.optimize({
      currentPrompt: 'Original prompt',
      componentType: 'skill',
      componentName: 'test',
      traces: makeTraces([0.3, 0.4]),
    });

    // Falls back to original since no <improved_prompt> tags
    expect(result.optimizedPrompt).toBe('Original prompt');
    // Reflection uses the raw response
    expect(result.reflectionLog).toContain('better prompt');
  });

  it('includes tool errors in the reflection prompt', async () => {
    let capturedPrompt = '';
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-model', name: 'Mock', provider: 'mock', contextWindow: 8000, maxOutputTokens: 2000 }],
      async *chat(req) {
        capturedPrompt = req.messages[0].content as string;
        yield { type: 'text' as const, content: '<reflection>ok</reflection>\n<improved_prompt>better</improved_prompt>' };
        yield { type: 'done' as const };
      },
      async countTokens() { return 100; },
    };

    const optimizer = new PromptOptimizer({ llm });
    await optimizer.optimize({
      currentPrompt: 'Search and summarize',
      componentType: 'tool_description',
      componentName: 'search',
      traces: [{
        prompt: 'find docs',
        finalAnswer: 'error',
        score: 0.1,
        scoreFeedback: 'Tool call failed',
        toolCalls: [
          { name: 'search_api', isError: true },
          { name: 'format', isError: false },
        ],
      }],
    });

    expect(capturedPrompt).toContain('Tool errors: search_api');
    expect(capturedPrompt).toContain('tool_description');
  });

  it('handles all-good traces gracefully', async () => {
    const llm = mockLlm('<reflection>Already good</reflection>\n<improved_prompt>Same prompt</improved_prompt>');

    const optimizer = new PromptOptimizer({ llm });
    const result = await optimizer.optimize({
      currentPrompt: 'Great prompt',
      componentType: 'skill',
      componentName: 'test',
      traces: makeTraces([0.9, 0.85, 0.95]),
    });

    // Very small improvement when already scoring high
    expect(result.scoreImprovement).toBeLessThan(0.1);
    expect(result.estimatedScore).toBeGreaterThan(0.85);
  });

  it('uses custom model when specified', async () => {
    let usedModel = '';
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'default-model', name: 'Default', provider: 'mock', contextWindow: 8000, maxOutputTokens: 2000 }],
      async *chat(req) {
        usedModel = req.model;
        yield { type: 'text' as const, content: '<reflection>ok</reflection>\n<improved_prompt>better</improved_prompt>' };
        yield { type: 'done' as const };
      },
      async countTokens() { return 100; },
    };

    const optimizer = new PromptOptimizer({ llm, model: 'claude-sonnet-4-5' });
    await optimizer.optimize({
      currentPrompt: 'test',
      componentType: 'skill',
      componentName: 'test',
      traces: makeTraces([0.3]),
    });

    expect(usedModel).toBe('claude-sonnet-4-5');
  });
});
