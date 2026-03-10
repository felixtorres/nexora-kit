/**
 * Prompt Optimization — End-to-End Integration Test
 *
 * Demonstrates the full lifecycle:
 *
 *   1. Agent runs → TraceCapture records execution traces
 *   2. Traces scored with built-in metrics (ScoreWithFeedback)
 *   3. Readiness check: enough traces + negative signals?
 *   4. PromptOptimizer calls LLM → produces an improved candidate
 *   5. Admin approves candidate → prompt goes active
 *   6. Admin rolls back if needed
 *
 * Uses real in-memory SQLite storage — no mocks for the data path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '@nexora-kit/storage';
import { SqliteExecutionTraceStore } from '@nexora-kit/storage';
import { SqliteOptimizedPromptStore } from '@nexora-kit/storage';
import { TraceCapture, type CapturedTrace } from './trace-capture.js';
import {
  MetricRegistry,
  answerCorrectness,
  userSatisfaction,
} from './metrics.js';
import { PromptOptimizer } from './prompt-optimizer.js';
import type { LlmProvider } from '@nexora-kit/llm';

function mockLlm(improvedPrompt: string, reflection: string): LlmProvider {
  return {
    name: 'mock',
    models: [{ id: 'mock-model', name: 'Mock', provider: 'mock', contextWindow: 8000, maxOutputTokens: 2000 }],
    async *chat() {
      yield { type: 'text' as const, content: `<reflection>\n${reflection}\n</reflection>\n\n<improved_prompt>\n${improvedPrompt}\n</improved_prompt>` };
      yield { type: 'done' as const };
    },
    async countTokens() { return 100; },
  };
}

describe('Prompt Optimization — Full Lifecycle', () => {
  let db: Database.Database;
  let traceStore: SqliteExecutionTraceStore;
  let promptStore: SqliteOptimizedPromptStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    traceStore = new SqliteExecutionTraceStore(db);
    promptStore = new SqliteOptimizedPromptStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Step 1: TraceCapture records execution traces ──────────────────

  it('Step 1: TraceCapture captures agent runs into the trace store', async () => {
    const capture = new TraceCapture(async (trace) => {
      await traceStore.insert({
        conversationId: trace.conversationId,
        traceId: trace.traceId,
        model: trace.model ?? undefined,
        prompt: trace.prompt,
        toolCalls: trace.toolCalls,
        agentReasoning: trace.agentReasoning ?? undefined,
        finalAnswer: trace.finalAnswer,
        inputTokens: trace.inputTokens,
        outputTokens: trace.outputTokens,
        durationMs: trace.durationMs,
      });
    });

    // Simulate 3 agent runs
    for (let i = 1; i <= 3; i++) {
      capture.onTraceStart(`trace-${i}`, { conversationId: `conv-${i}`, message: `What is ${i}+${i}?` });
      capture.onGeneration({
        model: 'claude-sonnet-4-5',
        input: [],
        output: `${i + i}`,
        usage: { input: 100, output: 20 },
        durationMs: 200,
      });
      capture.onToolCall({
        name: 'calculator',
        input: { a: i, b: i },
        output: String(i + i),
        isError: false,
        durationMs: 10,
      });
      capture.onTraceEnd(`trace-${i}`, { totalTokens: 120, turns: 1, durationMs: 250 });
    }

    await new Promise((r) => setTimeout(r, 50));

    const traces = traceStore.query();
    expect(traces).toHaveLength(3);
    expect(traces[0].model).toBe('claude-sonnet-4-5');
    expect(traces[0].toolCalls).toHaveLength(1);
  });

  // ── Step 2: Score traces with built-in metrics ─────────────────────

  it('Step 2: Built-in metrics produce ScoreWithFeedback for each trace', () => {
    const registry = new MetricRegistry();

    const good = registry.evaluate(
      'answer_correctness',
      { prompt: 'Capital of France?', finalAnswer: 'The capital of France is Paris.', toolCalls: [], inputTokens: 50, outputTokens: 20, durationMs: 100 },
      { expectedAnswer: 'The capital of France is Paris.' },
    );
    expect(good.score).toBeGreaterThan(0.8);

    const bad = registry.evaluate(
      'tool_selection',
      { prompt: 'Search TypeScript docs', finalAnswer: 'results', toolCalls: [{ name: 'delete_document', input: {}, isError: false }, { name: 'send_email', input: {}, isError: true }], inputTokens: 80, outputTokens: 30, durationMs: 300 },
      { expectedTools: ['search_documents', 'format_results'] },
    );
    expect(bad.score).toBeLessThan(0.3);
    expect(bad.feedback).toContain('Missing tools');
  });

  // ── Step 3: Check readiness ────────────────────────────────────────

  it('Step 3: Readiness check — enough traces + negative signals', () => {
    for (let i = 0; i < 25; i++) {
      const id = traceStore.insert({
        conversationId: `conv-${i}`,
        traceId: `trace-${i}`,
        skillName: 'greeting',
        prompt: 'Say hello',
        finalAnswer: i < 5 ? 'wrong answer' : 'Hello! How can I help?',
      });
      const score = i < 5 ? 0.2 + Math.random() * 0.2 : 0.7 + Math.random() * 0.3;
      traceStore.updateScore(id, score, score < 0.5 ? 'Bad answer' : 'Good answer');
    }

    const totalScored = traceStore.count({ skillName: 'greeting', hasScore: true });
    const negativeCount = traceStore.count({ skillName: 'greeting', hasNegativeScore: true });
    expect(totalScored).toBe(25);
    expect(negativeCount).toBe(5);
    expect(totalScored >= 20 && negativeCount >= 3).toBe(true);
  });

  // ── Step 4: PromptOptimizer calls LLM → produces candidate ────────

  it('Step 4: PromptOptimizer reflects on failures and rewrites the prompt', async () => {
    const llm = mockLlm(
      'You are a warm, professional assistant. Greet the user by name when available. If they seem frustrated, acknowledge their concern first.',
      'Failures show generic greetings that ignore user context. Fixed by adding name personalization and frustration detection.',
    );

    const optimizer = new PromptOptimizer({ llm });
    const result = await optimizer.optimize({
      currentPrompt: 'You are a helpful assistant. Greet the user.',
      componentType: 'skill',
      componentName: 'greeting',
      traces: [
        { prompt: 'hi', finalAnswer: 'Hello.', score: 0.3, scoreFeedback: 'Too generic, no personalization' },
        { prompt: 'I am frustrated', finalAnswer: 'Hello!', score: 0.2, scoreFeedback: 'Ignored user frustration' },
        { prompt: 'hi Alice', finalAnswer: 'Hello Alice! How can I help?', score: 0.9, scoreFeedback: 'Personalized and helpful' },
      ],
    });

    expect(result.optimizedPrompt).toContain('frustrat');
    expect(result.reflectionLog).toContain('generic greetings');
    expect(result.tracesAnalyzed).toBe(3);
  });

  // ── Step 5: Store candidate, approve, deploy ───────────────────────

  it('Step 5: Approve candidate → deactivates old, activates new', () => {
    const oldId = promptStore.insert({
      componentType: 'skill',
      componentName: 'greeting',
      originalPrompt: 'original v1',
      optimizedPrompt: 'optimized v1',
      score: 0.7,
      scoreImprovement: 0.05,
      reflectionLog: 'First optimization',
      optimizedForModel: 'default',
    });
    promptStore.updateStatus(oldId, 'active', 'admin-1');

    const newId = promptStore.insert({
      componentType: 'skill',
      componentName: 'greeting',
      originalPrompt: 'original v1',
      optimizedPrompt: 'optimized v2 — much better',
      score: 0.85,
      scoreImprovement: 0.15,
      reflectionLog: 'Second optimization',
      optimizedForModel: 'default',
    });

    // Deactivate old, activate new
    promptStore.updateStatus(oldId, 'rolled_back');
    promptStore.updateStatus(newId, 'active', 'admin-2');

    const active = promptStore.getActive('skill', 'greeting');
    expect(active!.id).toBe(newId);
    expect(active!.approvedBy).toBe('admin-2');

    const old = promptStore.get(oldId);
    expect(old!.status).toBe('rolled_back');
  });

  // ── Step 6: Rollback ───────────────────────────────────────────────

  it('Step 6: Admin rolls back a deployed prompt', () => {
    const id = promptStore.insert({
      componentType: 'skill',
      componentName: 'greeting',
      originalPrompt: 'original',
      optimizedPrompt: 'optimized',
      score: 0.85,
      scoreImprovement: 0.15,
      reflectionLog: 'reflection',
      optimizedForModel: 'default',
    });
    promptStore.updateStatus(id, 'active', 'admin');

    // Roll back
    promptStore.updateStatus(id, 'rolled_back');

    expect(promptStore.get(id)!.status).toBe('rolled_back');
    expect(promptStore.getActive('skill', 'greeting')).toBeUndefined();
  });

  // ── Full flow ──────────────────────────────────────────────────────

  it('Full lifecycle: capture → score → optimize → approve', async () => {
    // 1. Capture traces
    const capture = new TraceCapture((trace) => {
      traceStore.insert({
        conversationId: trace.conversationId,
        traceId: trace.traceId,
        skillName: 'email-draft',
        model: trace.model ?? undefined,
        prompt: trace.prompt,
        toolCalls: trace.toolCalls,
        finalAnswer: trace.finalAnswer,
        inputTokens: trace.inputTokens,
        outputTokens: trace.outputTokens,
        durationMs: trace.durationMs,
      });
    });

    const scenarios = [
      { input: 'Draft formal email', expected: 'Dear Sir', rating: true },
      { input: 'Write casual email', expected: 'Hey!', rating: false, correction: 'Too formal' },
      { input: 'Reply to complaint', expected: 'We apologize', rating: false, correction: 'Not empathetic' },
    ];

    for (let i = 0; i < 21; i++) {
      const s = scenarios[i % scenarios.length];
      const tid = `trace-${i}`;
      capture.onTraceStart(tid, { conversationId: `conv-${i}`, message: s.input });
      capture.onGeneration({ model: 'claude-sonnet-4-5', input: [], output: s.rating ? s.expected : 'Generic', usage: { input: 80, output: 40 }, durationMs: 200 });
      capture.onTraceEnd(tid, { totalTokens: 120, turns: 1, durationMs: 220 });
    }

    await new Promise((r) => setTimeout(r, 50));

    // 2. Score traces
    const stored = traceStore.query({ skillName: 'email-draft' });
    for (let i = 0; i < stored.length; i++) {
      const s = scenarios[i % scenarios.length];
      const satisfaction = userSatisfaction(
        { prompt: stored[i].prompt, finalAnswer: stored[i].finalAnswer, toolCalls: [], inputTokens: 0, outputTokens: 0, durationMs: 0 },
        { userRating: s.rating, userCorrection: s.correction },
      );
      traceStore.updateScore(stored[i].id, satisfaction.score, satisfaction.feedback);
    }

    // 3. Check readiness
    const scored = traceStore.count({ skillName: 'email-draft', hasScore: true });
    const negative = traceStore.count({ skillName: 'email-draft', hasNegativeScore: true });
    expect(scored).toBe(21);
    expect(negative).toBeGreaterThanOrEqual(3);

    // 4. Run optimization
    const llm = mockLlm(
      'Draft an email matching the requested tone. For complaints, lead with acknowledgment.',
      'Casual requests got formal tone, complaints lacked empathy. Fix: tone matching.',
    );
    const optimizer = new PromptOptimizer({ llm });
    const scoredTraces = traceStore.query({ skillName: 'email-draft', hasScore: true }).filter((t) => t.score !== null);
    const result = await optimizer.optimize({
      currentPrompt: 'Draft an email based on the user request.',
      componentType: 'skill',
      componentName: 'email-draft',
      traces: scoredTraces.map((t) => ({
        prompt: t.prompt,
        finalAnswer: t.finalAnswer,
        score: t.score!,
        scoreFeedback: t.scoreFeedback ?? '',
      })),
    });

    // 5. Store + approve
    const candidateId = promptStore.insert({
      componentType: 'skill',
      componentName: 'email-draft',
      originalPrompt: 'Draft an email based on the user request.',
      optimizedPrompt: result.optimizedPrompt,
      score: result.estimatedScore,
      scoreImprovement: result.scoreImprovement,
      reflectionLog: result.reflectionLog,
      optimizedForModel: 'default',
    });
    promptStore.updateStatus(candidateId, 'active', 'felix');

    const active = promptStore.getActive('skill', 'email-draft');
    expect(active).toBeDefined();
    expect(active!.optimizedPrompt).toContain('tone');
    expect(active!.approvedBy).toBe('felix');
  });
});
