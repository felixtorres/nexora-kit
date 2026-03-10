import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteExecutionTraceStore } from './execution-trace-store.js';

describe('SqliteExecutionTraceStore', () => {
  let db: Database.Database;
  let store: SqliteExecutionTraceStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteExecutionTraceStore(db);
  });

  const baseTrace = {
    conversationId: 'conv-1',
    traceId: 'trace-1',
    prompt: 'Tell me about the weather',
    finalAnswer: 'The weather is sunny.',
  };

  it('inserts and retrieves a trace', () => {
    const id = store.insert(baseTrace);
    const trace = store.get(id);

    expect(trace).toBeDefined();
    expect(trace!.conversationId).toBe('conv-1');
    expect(trace!.traceId).toBe('trace-1');
    expect(trace!.prompt).toBe('Tell me about the weather');
    expect(trace!.finalAnswer).toBe('The weather is sunny.');
    expect(trace!.toolCalls).toEqual([]);
    expect(trace!.retrievedDocs).toEqual([]);
    expect(trace!.score).toBeNull();
  });

  it('stores tool calls and retrieved docs as JSON', () => {
    const id = store.insert({
      ...baseTrace,
      toolCalls: [{ name: 'get_weather', input: { city: 'NYC' }, output: 'Sunny', isError: false }],
      retrievedDocs: ['doc-1', 'doc-2'],
    });

    const trace = store.get(id);
    expect(trace!.toolCalls).toEqual([{ name: 'get_weather', input: { city: 'NYC' }, output: 'Sunny', isError: false }]);
    expect(trace!.retrievedDocs).toEqual(['doc-1', 'doc-2']);
  });

  it('queries by conversation', () => {
    store.insert({ ...baseTrace, conversationId: 'conv-1' });
    store.insert({ ...baseTrace, conversationId: 'conv-2' });

    const results = store.query({ conversationId: 'conv-1' });
    expect(results).toHaveLength(1);
    expect(results[0].conversationId).toBe('conv-1');
  });

  it('queries by skill name', () => {
    store.insert({ ...baseTrace, skillName: 'weather' });
    store.insert({ ...baseTrace, skillName: 'calendar' });

    const results = store.query({ skillName: 'weather' });
    expect(results).toHaveLength(1);
  });

  it('queries by bot ID', () => {
    store.insert({ ...baseTrace, botId: 'bot-1' });
    store.insert({ ...baseTrace, botId: 'bot-2' });

    const results = store.query({ botId: 'bot-1' });
    expect(results).toHaveLength(1);
  });

  it('filters by hasScore', () => {
    store.insert(baseTrace);
    const id2 = store.insert({ ...baseTrace, score: 0.8 });

    const scored = store.query({ hasScore: true });
    expect(scored).toHaveLength(1);
    expect(scored[0].id).toBe(id2);
  });

  it('filters by hasNegativeScore', () => {
    store.insert({ ...baseTrace, score: 0.8 });
    const id2 = store.insert({ ...baseTrace, score: 0.3 });

    const negative = store.query({ hasNegativeScore: true });
    expect(negative).toHaveLength(1);
    expect(negative[0].id).toBe(id2);
  });

  it('counts traces with filters', () => {
    store.insert({ ...baseTrace, skillName: 'weather' });
    store.insert({ ...baseTrace, skillName: 'weather' });
    store.insert({ ...baseTrace, skillName: 'calendar' });

    expect(store.count({ skillName: 'weather' })).toBe(2);
    expect(store.count()).toBe(3);
  });

  it('updates score and feedback', () => {
    const id = store.insert(baseTrace);
    store.updateScore(id, 0.75, 'Good answer but missing details');

    const trace = store.get(id);
    expect(trace!.score).toBe(0.75);
    expect(trace!.scoreFeedback).toBe('Good answer but missing details');
  });

  it('deletes old traces', () => {
    store.insert(baseTrace);
    store.insert(baseTrace);

    const deleted = store.deleteOlderThan(0);
    expect(deleted).toBe(2);
    expect(store.count()).toBe(0);
  });

  it('returns undefined for missing trace', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('calculates average score for a component', () => {
    store.insert({ ...baseTrace, skillName: 'greeting', score: 0.8 });
    store.insert({ ...baseTrace, skillName: 'greeting', score: 0.6 });
    store.insert({ ...baseTrace, skillName: 'greeting', score: 0.4 });
    store.insert({ ...baseTrace, skillName: 'other', score: 0.1 });

    const avg = store.averageScore('greeting', null, 0);
    expect(avg).toBeCloseTo(0.6, 5);
  });

  it('returns null when no scored traces exist', () => {
    store.insert({ ...baseTrace, skillName: 'greeting' });
    const avg = store.averageScore('greeting', null, 0);
    expect(avg).toBeNull();
  });

  it('calculates average score scoped to bot', () => {
    store.insert({ ...baseTrace, skillName: 'greeting', botId: 'bot-a', score: 0.9 });
    store.insert({ ...baseTrace, skillName: 'greeting', botId: 'bot-b', score: 0.3 });

    const avg = store.averageScore('greeting', 'bot-a', 0);
    expect(avg).toBeCloseTo(0.9, 5);
  });

  it('respects limit in query', () => {
    store.insert(baseTrace);
    store.insert(baseTrace);
    store.insert(baseTrace);

    const results = store.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });
});
