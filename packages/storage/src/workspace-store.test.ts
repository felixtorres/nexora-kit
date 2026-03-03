import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteWorkspaceStore } from './workspace-store.js';

describe('SqliteWorkspaceStore', () => {
  let db: Database.Database;
  let store: SqliteWorkspaceStore;

  const teamId = 'team-1';

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteWorkspaceStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create()', () => {
    it('creates a workspace with defaults', () => {
      const ws = store.create({ teamId, name: 'My Workspace' });

      expect(ws.id).toMatch(/^[0-9a-f]{8}-/);
      expect(ws.teamId).toBe(teamId);
      expect(ws.name).toBe('My Workspace');
      expect(ws.description).toBeNull();
      expect(ws.systemPrompt).toBeNull();
      expect(ws.metadata).toEqual({});
      expect(ws.createdAt).toBeTruthy();
    });

    it('creates a workspace with all fields', () => {
      const ws = store.create({
        teamId,
        name: 'Full Workspace',
        description: 'A workspace with everything',
        systemPrompt: 'You are a helpful assistant',
        metadata: { env: 'production' },
      });

      expect(ws.name).toBe('Full Workspace');
      expect(ws.description).toBe('A workspace with everything');
      expect(ws.systemPrompt).toBe('You are a helpful assistant');
      expect(ws.metadata).toEqual({ env: 'production' });
    });
  });

  describe('get()', () => {
    it('returns undefined for non-existent workspace', () => {
      expect(store.get('nonexistent', teamId)).toBeUndefined();
    });

    it('returns undefined for wrong team', () => {
      const ws = store.create({ teamId, name: 'WS' });
      expect(store.get(ws.id, 'other-team')).toBeUndefined();
    });

    it('returns the workspace for correct team', () => {
      const ws = store.create({ teamId, name: 'WS' });
      const found = store.get(ws.id, teamId);
      expect(found).toBeDefined();
      expect(found!.id).toBe(ws.id);
    });
  });

  describe('list()', () => {
    it('returns empty array for no workspaces', () => {
      expect(store.list(teamId)).toEqual([]);
    });

    it('lists workspaces for a team sorted by name', () => {
      store.create({ teamId, name: 'Zeta' });
      store.create({ teamId, name: 'Alpha' });
      store.create({ teamId: 'other', name: 'Other' });

      const list = store.list(teamId);
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('Alpha');
      expect(list[1].name).toBe('Zeta');
    });
  });

  describe('update()', () => {
    it('returns undefined for non-existent workspace', () => {
      expect(store.update('nonexistent', teamId, { name: 'X' })).toBeUndefined();
    });

    it('updates individual fields', () => {
      const ws = store.create({ teamId, name: 'Original' });

      const updated = store.update(ws.id, teamId, { name: 'Updated' });
      expect(updated!.name).toBe('Updated');
      expect(updated!.description).toBeNull();
    });

    it('updates system prompt', () => {
      const ws = store.create({ teamId, name: 'WS' });

      const updated = store.update(ws.id, teamId, { systemPrompt: 'New prompt' });
      expect(updated!.systemPrompt).toBe('New prompt');
    });

    it('returns existing record when no fields provided', () => {
      const ws = store.create({ teamId, name: 'WS' });
      const same = store.update(ws.id, teamId, {});
      expect(same!.name).toBe('WS');
    });
  });

  describe('delete()', () => {
    it('returns false for non-existent workspace', () => {
      expect(store.delete('nonexistent', teamId)).toBe(false);
    });

    it('deletes an existing workspace', () => {
      const ws = store.create({ teamId, name: 'WS' });
      expect(store.delete(ws.id, teamId)).toBe(true);
      expect(store.get(ws.id, teamId)).toBeUndefined();
    });
  });
});
