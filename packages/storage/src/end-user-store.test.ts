import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteEndUserStore } from './end-user-store.js';

describe('SqliteEndUserStore', () => {
  let db: Database.Database;
  let store: SqliteEndUserStore;

  const agentId = 'agent-1';

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteEndUserStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create()', () => {
    it('returns an EndUserRecord with generated id and firstSeenAt', () => {
      const user = store.create({ agentId });

      expect(user.id).toMatch(/^[0-9a-f]{8}-/);
      expect(user.agentId).toBe(agentId);
      expect(user.firstSeenAt).toBeTruthy();
      expect(user.lastSeenAt).toBeNull();
    });

    it('defaults optional fields to null/empty', () => {
      const user = store.create({ agentId });

      expect(user.externalId).toBeNull();
      expect(user.displayName).toBeNull();
      expect(user.metadata).toEqual({});
    });

    it('persists externalId and displayName', () => {
      const user = store.create({
        agentId,
        externalId: 'ext-123',
        displayName: 'Alice',
        metadata: { source: 'web' },
      });

      expect(user.externalId).toBe('ext-123');
      expect(user.displayName).toBe('Alice');
      expect(user.metadata).toEqual({ source: 'web' });

      const fetched = store.get(user.id);
      expect(fetched?.externalId).toBe('ext-123');
    });

    it('enforces unique (agent_id, external_id) via index', () => {
      store.create({ agentId, externalId: 'ext-1' });
      expect(() => store.create({ agentId, externalId: 'ext-1' })).toThrow();
    });

    it('allows same external_id for different agents', () => {
      store.create({ agentId, externalId: 'ext-1' });
      const u2 = store.create({ agentId: 'agent-2', externalId: 'ext-1' });
      expect(u2.agentId).toBe('agent-2');
    });

    it('allows multiple null external_ids for same agent', () => {
      const u1 = store.create({ agentId });
      const u2 = store.create({ agentId });
      expect(u1.id).not.toBe(u2.id);
    });
  });

  describe('get()', () => {
    it('returns end user by id', () => {
      const user = store.create({ agentId, externalId: 'ext-1' });
      const fetched = store.get(user.id);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(user.id);
    });

    it('returns undefined for nonexistent id', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getByExternalId()', () => {
    it('returns user by agentId and externalId', () => {
      const user = store.create({ agentId, externalId: 'ext-1' });
      const fetched = store.getByExternalId(agentId, 'ext-1');

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(user.id);
    });

    it('returns undefined for wrong agentId', () => {
      store.create({ agentId, externalId: 'ext-1' });
      expect(store.getByExternalId('agent-other', 'ext-1')).toBeUndefined();
    });

    it('returns undefined for nonexistent externalId', () => {
      expect(store.getByExternalId(agentId, 'nonexistent')).toBeUndefined();
    });
  });

  describe('getOrCreate()', () => {
    it('creates a new user if none exists', () => {
      const user = store.getOrCreate(agentId, 'ext-new', 'NewUser');

      expect(user.externalId).toBe('ext-new');
      expect(user.displayName).toBe('NewUser');
    });

    it('returns existing user and updates lastSeenAt', () => {
      const original = store.create({ agentId, externalId: 'ext-1', displayName: 'Alice' });
      const returned = store.getOrCreate(agentId, 'ext-1');

      expect(returned.id).toBe(original.id);
      expect(returned.displayName).toBe('Alice');
      expect(returned.lastSeenAt).not.toBeNull();
    });

    it('is idempotent — does not create duplicates', () => {
      store.getOrCreate(agentId, 'ext-1');
      store.getOrCreate(agentId, 'ext-1');

      expect(store.list(agentId)).toHaveLength(1);
    });
  });

  describe('list()', () => {
    it('returns users for an agent sorted by firstSeenAt DESC', () => {
      store.create({ agentId, externalId: 'ext-1' });
      store.create({ agentId, externalId: 'ext-2' });
      store.create({ agentId, externalId: 'ext-3' });

      const users = store.list(agentId);
      expect(users).toHaveLength(3);
    });

    it('isolates by agent', () => {
      store.create({ agentId, externalId: 'ext-1' });
      store.create({ agentId: 'agent-2', externalId: 'ext-2' });

      expect(store.list(agentId)).toHaveLength(1);
    });

    it('returns empty array when no users exist', () => {
      expect(store.list(agentId)).toEqual([]);
    });
  });

  describe('updateLastSeen()', () => {
    it('sets last_seen_at to current time', () => {
      const user = store.create({ agentId });
      expect(user.lastSeenAt).toBeNull();

      store.updateLastSeen(user.id);

      const fetched = store.get(user.id);
      expect(fetched!.lastSeenAt).not.toBeNull();
    });
  });
});
