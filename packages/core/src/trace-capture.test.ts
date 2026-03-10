import { describe, it, expect, vi } from 'vitest';
import { TraceCapture, type CapturedTrace } from './trace-capture.js';
import { NoopObservability } from './observability.js';

describe('TraceCapture', () => {
  it('captures a complete trace on traceEnd', async () => {
    const traces: CapturedTrace[] = [];
    const capture = new TraceCapture((trace) => { traces.push(trace); });

    capture.onTraceStart('t1', { conversationId: 'c1', message: 'Hello' });
    capture.onGeneration({
      model: 'claude-sonnet',
      input: [],
      output: 'Hi there!',
      usage: { input: 10, output: 5 },
      durationMs: 100,
    });
    capture.onTraceEnd('t1', { totalTokens: 15, turns: 1, durationMs: 150 });

    // Wait for fire-and-forget
    await new Promise((r) => setTimeout(r, 10));

    expect(traces).toHaveLength(1);
    expect(traces[0].traceId).toBe('t1');
    expect(traces[0].conversationId).toBe('c1');
    expect(traces[0].prompt).toBe('Hello');
    expect(traces[0].model).toBe('claude-sonnet');
    expect(traces[0].finalAnswer).toBe('Hi there!');
    expect(traces[0].inputTokens).toBe(10);
    expect(traces[0].outputTokens).toBe(5);
    expect(traces[0].durationMs).toBe(150);
  });

  it('accumulates tool calls', async () => {
    const traces: CapturedTrace[] = [];
    const capture = new TraceCapture((trace) => { traces.push(trace); });

    capture.onTraceStart('t1', { conversationId: 'c1', message: 'Search' });
    capture.onToolCall({ name: 'search', input: { q: 'test' }, output: 'results', isError: false, durationMs: 50 });
    capture.onToolCall({ name: 'format', input: { data: 'x' }, isError: false, durationMs: 10 });
    capture.onGeneration({ model: 'gpt-4', input: [], output: 'Here are results', durationMs: 80 });
    capture.onTraceEnd('t1', { totalTokens: 20, turns: 1, durationMs: 200 });

    await new Promise((r) => setTimeout(r, 10));

    expect(traces[0].toolCalls).toHaveLength(2);
    expect(traces[0].toolCalls[0].name).toBe('search');
    expect(traces[0].toolCalls[1].name).toBe('format');
  });

  it('accumulates tokens across multiple generations', async () => {
    const traces: CapturedTrace[] = [];
    const capture = new TraceCapture((trace) => { traces.push(trace); });

    capture.onTraceStart('t1', { conversationId: 'c1', message: 'Multi-turn' });
    capture.onGeneration({ model: 'claude', input: [], usage: { input: 100, output: 50 }, durationMs: 100 });
    capture.onGeneration({ model: 'claude', input: [], output: 'Final', usage: { input: 80, output: 30 }, durationMs: 80 });
    capture.onTraceEnd('t1', { totalTokens: 260, turns: 2, durationMs: 300 });

    await new Promise((r) => setTimeout(r, 10));

    expect(traces[0].inputTokens).toBe(180);
    expect(traces[0].outputTokens).toBe(80);
    expect(traces[0].finalAnswer).toBe('Final');
  });

  it('delegates to inner hooks', () => {
    const inner = new NoopObservability();
    const spyStart = vi.spyOn(inner, 'onTraceStart');
    const spyGen = vi.spyOn(inner, 'onGeneration');
    const spyTool = vi.spyOn(inner, 'onToolCall');
    const spyEnd = vi.spyOn(inner, 'onTraceEnd');

    const capture = new TraceCapture(() => {}, inner);

    capture.onTraceStart('t1', { conversationId: 'c1', message: 'test' });
    capture.onGeneration({ model: 'x', input: [], durationMs: 1 });
    capture.onToolCall({ name: 'y', input: {}, isError: false, durationMs: 1 });
    capture.onTraceEnd('t1', { totalTokens: 0, turns: 0, durationMs: 0 });

    expect(spyStart).toHaveBeenCalledOnce();
    expect(spyGen).toHaveBeenCalledOnce();
    expect(spyTool).toHaveBeenCalledOnce();
    expect(spyEnd).toHaveBeenCalledOnce();
  });

  it('ignores traceEnd for non-matching traceId', async () => {
    const traces: CapturedTrace[] = [];
    const capture = new TraceCapture((trace) => { traces.push(trace); });

    capture.onTraceStart('t1', { conversationId: 'c1', message: 'test' });
    capture.onTraceEnd('t-other', { totalTokens: 0, turns: 0, durationMs: 0 });

    await new Promise((r) => setTimeout(r, 10));
    expect(traces).toHaveLength(0);
  });

  it('handles callback errors gracefully', async () => {
    const capture = new TraceCapture(() => { throw new Error('boom'); });

    capture.onTraceStart('t1', { conversationId: 'c1', message: 'test' });
    capture.onGeneration({ model: 'x', input: [], output: 'ok', durationMs: 1 });

    // Should not throw
    expect(() => {
      capture.onTraceEnd('t1', { totalTokens: 0, turns: 0, durationMs: 0 });
    }).not.toThrow();
  });
});
