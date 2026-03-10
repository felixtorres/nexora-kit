import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteOptimizedPromptStore } from './optimized-prompt-store.js';

describe('SqliteOptimizedPromptStore', () => {
  let db: Database.Database;
  let store: SqliteOptimizedPromptStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteOptimizedPromptStore(db);
  });

  const basePrompt = {
    componentType: 'skill' as const,
    componentName: 'weather-lookup',
    originalPrompt: 'Get the weather for the given city.',
    optimizedPrompt: 'Get current weather conditions including temperature, humidity, and forecast for the specified city. Include units in Celsius.',
    score: 0.85,
    scoreImprovement: 0.15,
    reflectionLog: 'Original prompt was too vague, missing units and specific data points.',
    optimizedForModel: 'anthropic/claude-sonnet-4-5',
  };

  it('inserts and retrieves an optimized prompt', () => {
    const id = store.insert(basePrompt);
    const record = store.get(id);

    expect(record).toBeDefined();
    expect(record!.componentType).toBe('skill');
    expect(record!.componentName).toBe('weather-lookup');
    expect(record!.score).toBe(0.85);
    expect(record!.status).toBe('candidate');
    expect(record!.botId).toBeNull();
    expect(record!.parentId).toBeNull();
  });

  it('stores with bot ID for per-bot optimization', () => {
    const id = store.insert({ ...basePrompt, botId: 'bot-1' });
    const record = store.get(id);

    expect(record!.botId).toBe('bot-1');
  });

  it('queries by component type and name', () => {
    store.insert(basePrompt);
    store.insert({ ...basePrompt, componentType: 'tool_description', componentName: 'search' });

    const skills = store.query({ componentType: 'skill' });
    expect(skills).toHaveLength(1);
    expect(skills[0].componentName).toBe('weather-lookup');
  });

  it('queries by status', () => {
    const id1 = store.insert(basePrompt);
    store.insert(basePrompt);

    store.updateStatus(id1, 'approved', 'admin');

    const candidates = store.query({ status: 'candidate' });
    expect(candidates).toHaveLength(1);

    const approved = store.query({ status: 'approved' });
    expect(approved).toHaveLength(1);
    expect(approved[0].approvedBy).toBe('admin');
    expect(approved[0].approvedAt).toBeTruthy();
  });

  it('updates status through full lifecycle', () => {
    const id = store.insert(basePrompt);

    // candidate → approved
    store.updateStatus(id, 'approved', 'admin');
    expect(store.get(id)!.status).toBe('approved');

    // approved → active
    store.updateStatus(id, 'active', 'admin');
    expect(store.get(id)!.status).toBe('active');

    // active → rolled_back
    store.updateStatus(id, 'rolled_back');
    expect(store.get(id)!.status).toBe('rolled_back');
  });

  it('marks as unvalidated on provider change', () => {
    const id = store.insert(basePrompt);
    store.updateStatus(id, 'active', 'admin');

    // Simulate provider change
    store.updateStatus(id, 'unvalidated');
    expect(store.get(id)!.status).toBe('unvalidated');
  });

  it('updates rolling score', () => {
    const id = store.insert(basePrompt);
    store.updateRollingScore(id, 0.78);

    expect(store.get(id)!.rollingScore).toBe(0.78);
  });

  it('gets active prompt for component', () => {
    const id = store.insert(basePrompt);
    store.updateStatus(id, 'active', 'admin');

    const active = store.getActive('skill', 'weather-lookup');
    expect(active).toBeDefined();
    expect(active!.id).toBe(id);
  });

  it('gets active prompt scoped by bot', () => {
    const id1 = store.insert({ ...basePrompt, botId: 'bot-1' });
    const id2 = store.insert({ ...basePrompt, botId: 'bot-2' });
    store.updateStatus(id1, 'active', 'admin');
    store.updateStatus(id2, 'active', 'admin');

    const active = store.getActive('skill', 'weather-lookup', 'bot-1');
    expect(active).toBeDefined();
    expect(active!.botId).toBe('bot-1');
  });

  it('returns undefined when no active prompt', () => {
    store.insert(basePrompt); // still candidate
    expect(store.getActive('skill', 'weather-lookup')).toBeUndefined();
  });

  it('deletes old non-active prompts', () => {
    const id1 = store.insert(basePrompt);
    store.insert(basePrompt);
    store.updateStatus(id1, 'active', 'admin');

    const deleted = store.deleteOlderThan(0);
    expect(deleted).toBe(1); // only the candidate, not the active one
    expect(store.get(id1)).toBeDefined(); // active one preserved
  });

  it('queries with limit', () => {
    store.insert(basePrompt);
    store.insert(basePrompt);
    store.insert(basePrompt);

    const results = store.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('queries by optimizedForModel', () => {
    store.insert(basePrompt);
    store.insert({ ...basePrompt, optimizedForModel: 'openai/gpt-4' });

    const results = store.query({ optimizedForModel: 'anthropic/claude-sonnet-4-5' });
    expect(results).toHaveLength(1);
  });

  it('stores evolution chain via parentId', () => {
    const parentId = store.insert(basePrompt);
    const childId = store.insert({
      ...basePrompt,
      parentId,
      evolutionDepth: 1,
      score: 0.90,
      scoreImprovement: 0.20,
    });

    const child = store.get(childId);
    expect(child!.parentId).toBe(parentId);
    expect(child!.evolutionDepth).toBe(1);
  });
});
