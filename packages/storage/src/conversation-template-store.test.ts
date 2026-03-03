import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteConversationTemplateStore } from './conversation-template-store.js';

describe('SqliteConversationTemplateStore', () => {
  let db: Database.Database;
  let store: SqliteConversationTemplateStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteConversationTemplateStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates and retrieves a template', () => {
    const template = store.create({
      teamId: 'team-1',
      name: 'code-reviewer',
      description: 'Reviews code changes',
      systemPrompt: 'You are a code reviewer.',
      model: 'claude-3',
      pluginNamespaces: ['code-tools'],
      temperature: 0.3,
      maxTurns: 5,
    });

    expect(template.id).toBeDefined();
    expect(template.teamId).toBe('team-1');
    expect(template.name).toBe('code-reviewer');
    expect(template.description).toBe('Reviews code changes');
    expect(template.systemPrompt).toBe('You are a code reviewer.');
    expect(template.model).toBe('claude-3');
    expect(template.pluginNamespaces).toEqual(['code-tools']);
    expect(template.temperature).toBe(0.3);
    expect(template.maxTurns).toBe(5);

    const retrieved = store.get(template.id, 'team-1');
    expect(retrieved).toEqual(template);
  });

  it('creates template with minimal fields', () => {
    const template = store.create({ teamId: 'team-1', name: 'minimal' });

    expect(template.description).toBe('');
    expect(template.systemPrompt).toBeNull();
    expect(template.model).toBeNull();
    expect(template.pluginNamespaces).toEqual([]);
    expect(template.temperature).toBeNull();
    expect(template.maxTurns).toBeNull();
    expect(template.metadata).toEqual({});
  });

  it('returns undefined for nonexistent template', () => {
    expect(store.get('nope', 'team-1')).toBeUndefined();
  });

  it('enforces unique name per team', () => {
    store.create({ teamId: 'team-1', name: 'my-template' });
    expect(() => store.create({ teamId: 'team-1', name: 'my-template' })).toThrow();
  });

  it('allows same name in different teams', () => {
    store.create({ teamId: 'team-1', name: 'shared-name' });
    const t2 = store.create({ teamId: 'team-2', name: 'shared-name' });
    expect(t2.teamId).toBe('team-2');
  });

  it('lists templates for a team', () => {
    store.create({ teamId: 'team-1', name: 'b-template' });
    store.create({ teamId: 'team-1', name: 'a-template' });
    store.create({ teamId: 'team-2', name: 'other' });

    const list = store.list('team-1');
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('a-template'); // sorted ASC
    expect(list[1].name).toBe('b-template');
  });

  it('isolates templates by team on get', () => {
    const template = store.create({ teamId: 'team-1', name: 'secret' });
    expect(store.get(template.id, 'team-2')).toBeUndefined();
  });

  it('updates template fields', () => {
    const template = store.create({
      teamId: 'team-1',
      name: 'original',
      systemPrompt: 'Old prompt',
    });

    const updated = store.update(template.id, 'team-1', {
      name: 'renamed',
      systemPrompt: 'New prompt',
      model: 'gpt-4',
      temperature: 0.7,
    });

    expect(updated!.name).toBe('renamed');
    expect(updated!.systemPrompt).toBe('New prompt');
    expect(updated!.model).toBe('gpt-4');
    expect(updated!.temperature).toBe(0.7);
  });

  it('clears nullable fields with null', () => {
    const template = store.create({
      teamId: 'team-1',
      name: 'test',
      systemPrompt: 'has prompt',
      model: 'claude-3',
    });

    const updated = store.update(template.id, 'team-1', {
      systemPrompt: null,
      model: null,
    });

    expect(updated!.systemPrompt).toBeNull();
    expect(updated!.model).toBeNull();
  });

  it('returns undefined when updating nonexistent template', () => {
    expect(store.update('nope', 'team-1', { name: 'x' })).toBeUndefined();
  });

  it('deletes a template', () => {
    const template = store.create({ teamId: 'team-1', name: 'deletable' });

    expect(store.delete(template.id, 'team-1')).toBe(true);
    expect(store.get(template.id, 'team-1')).toBeUndefined();
  });

  it('returns false when deleting nonexistent template', () => {
    expect(store.delete('nope', 'team-1')).toBe(false);
  });

  it('does not delete template from another team', () => {
    const template = store.create({ teamId: 'team-1', name: 'mine' });
    expect(store.delete(template.id, 'team-2')).toBe(false);
    expect(store.get(template.id, 'team-1')).toBeDefined();
  });
});
