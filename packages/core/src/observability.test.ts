import { describe, it, expect } from 'vitest';
import { NoopObservability } from './observability.js';
import { LangfuseObservability } from './langfuse.js';

describe('NoopObservability', () => {
  it('implements all hooks without error', () => {
    const noop = new NoopObservability();
    noop.onTraceStart('trace-1', { sessionId: 's1', message: 'hello' });
    noop.onGeneration({ model: 'test', input: [], durationMs: 100 });
    noop.onToolCall({ name: 'tool', input: {}, isError: false, durationMs: 50 });
    noop.onToolSelection({ query: 'q', selected: 5, dropped: 2, tokensUsed: 1000, timeMs: 1 });
    noop.onTraceEnd('trace-1', { totalTokens: 500, turns: 3, durationMs: 2000 });
  });

  it('flush resolves', async () => {
    const noop = new NoopObservability();
    await expect(noop.flush()).resolves.toBeUndefined();
  });
});

describe('LangfuseObservability', () => {
  const config = { publicKey: 'pk-test', secretKey: 'sk-test' };

  it('creates a trace on traceStart', () => {
    const obs = new LangfuseObservability(config);
    obs.onTraceStart('t1', { sessionId: 's1', message: 'hello' });

    const trace = obs.getTrace('t1');
    expect(trace).toBeDefined();
    expect(trace!.sessionId).toBe('s1');
  });

  it('records generations', () => {
    const obs = new LangfuseObservability(config);
    obs.onTraceStart('t1', { sessionId: 's1', message: 'hi' });
    obs.onGeneration({
      model: 'claude-3',
      input: [{ role: 'user', content: 'hello' }],
      output: 'world',
      usage: { input: 10, output: 5 },
      durationMs: 200,
    });

    const trace = obs.getTrace('t1');
    expect(trace!.generations).toHaveLength(1);
    expect(trace!.generations[0].model).toBe('claude-3');
    expect(trace!.generations[0].usage).toEqual({ input: 10, output: 5 });
  });

  it('records tool calls as spans', () => {
    const obs = new LangfuseObservability(config);
    obs.onTraceStart('t1', { sessionId: 's1', message: 'hi' });
    obs.onToolCall({ name: 'search', input: { query: 'test' }, isError: false, durationMs: 50 });

    const trace = obs.getTrace('t1');
    expect(trace!.spans).toHaveLength(1);
    expect(trace!.spans[0].name).toBe('tool:search');
  });

  it('records tool selection as spans', () => {
    const obs = new LangfuseObservability(config);
    obs.onTraceStart('t1', { sessionId: 's1', message: 'hi' });
    obs.onToolSelection({ query: 'search', selected: 5, dropped: 3, tokensUsed: 1000, timeMs: 2 });

    const trace = obs.getTrace('t1');
    expect(trace!.spans).toHaveLength(1);
    expect(trace!.spans[0].name).toBe('tool-selection');
  });

  it('buffers all events', () => {
    const obs = new LangfuseObservability(config);
    obs.onTraceStart('t1', { sessionId: 's1', message: 'hi' });
    obs.onGeneration({ model: 'm', input: [], durationMs: 1 });
    obs.onToolCall({ name: 't', input: {}, isError: false, durationMs: 1 });
    obs.onToolSelection({ query: 'q', selected: 1, dropped: 0, tokensUsed: 100, timeMs: 1 });
    obs.onTraceEnd('t1', { totalTokens: 100, turns: 1, durationMs: 500 });

    expect(obs.getBuffer()).toHaveLength(5);
  });

  it('flush clears buffer and traces', async () => {
    const obs = new LangfuseObservability(config);
    obs.onTraceStart('t1', { sessionId: 's1', message: 'hi' });
    obs.onGeneration({ model: 'm', input: [], durationMs: 1 });
    await obs.flush();

    expect(obs.getBuffer()).toHaveLength(0);
    expect(obs.getTrace('t1')).toBeUndefined();
  });

  it('handles events without active trace', () => {
    const obs = new LangfuseObservability(config);
    // No trace started — should not throw
    obs.onGeneration({ model: 'm', input: [], durationMs: 1 });
    obs.onToolCall({ name: 't', input: {}, isError: false, durationMs: 1 });
    expect(obs.getBuffer()).toHaveLength(2);
  });

  it('selects most recent trace as active', () => {
    const obs = new LangfuseObservability(config);
    obs.onTraceStart('t1', { sessionId: 's1', message: 'first' });
    obs.onTraceStart('t2', { sessionId: 's2', message: 'second' });
    obs.onGeneration({ model: 'm', input: [], durationMs: 1 });

    expect(obs.getTrace('t1')!.generations).toHaveLength(0);
    expect(obs.getTrace('t2')!.generations).toHaveLength(1);
  });

  it('records error tool calls', () => {
    const obs = new LangfuseObservability(config);
    obs.onTraceStart('t1', { sessionId: 's1', message: 'hi' });
    obs.onToolCall({ name: 'fail', input: {}, output: 'Error!', isError: true, durationMs: 10 });

    const span = obs.getTrace('t1')!.spans[0];
    expect(span.data.isError).toBe(true);
  });
});
