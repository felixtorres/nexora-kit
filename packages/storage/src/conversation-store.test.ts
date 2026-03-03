import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteConversationStore } from './conversation-store.js';

describe('SqliteConversationStore', () => {
  let db: Database.Database;
  let store: SqliteConversationStore;

  const teamId = 'team-1';
  const userId = 'user-1';

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteConversationStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create()', () => {
    it('returns a ConversationRecord with generated id and timestamps', () => {
      const conv = store.create({ teamId, userId });

      expect(conv.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(conv.teamId).toBe(teamId);
      expect(conv.userId).toBe(userId);
      expect(conv.createdAt).toBeTruthy();
      expect(conv.updatedAt).toBe(conv.createdAt);
    });

    it('defaults to null title, empty pluginNamespaces, empty metadata', () => {
      const conv = store.create({ teamId, userId });

      expect(conv.title).toBeNull();
      expect(conv.pluginNamespaces).toEqual([]);
      expect(conv.metadata).toEqual({});
    });

    it('defaults messageCount to 0, lastMessageAt and deletedAt to null', () => {
      const conv = store.create({ teamId, userId });

      expect(conv.messageCount).toBe(0);
      expect(conv.lastMessageAt).toBeNull();
      expect(conv.deletedAt).toBeNull();
    });

    it('persists optional fields when provided', () => {
      const conv = store.create({
        teamId,
        userId,
        title: 'My Chat',
        systemPrompt: 'You are helpful.',
        templateId: 'tmpl-1',
        workspaceId: 'ws-1',
        model: 'gpt-4',
        agentId: 'agent-1',
        pluginNamespaces: ['ns-a', 'ns-b'],
        metadata: { source: 'web' },
      });

      expect(conv.title).toBe('My Chat');
      expect(conv.systemPrompt).toBe('You are helpful.');
      expect(conv.templateId).toBe('tmpl-1');
      expect(conv.workspaceId).toBe('ws-1');
      expect(conv.model).toBe('gpt-4');
      expect(conv.agentId).toBe('agent-1');
      expect(conv.pluginNamespaces).toEqual(['ns-a', 'ns-b']);
      expect(conv.metadata).toEqual({ source: 'web' });

      // Verify persisted in DB
      const fetched = store.get(conv.id, userId);
      expect(fetched?.title).toBe('My Chat');
      expect(fetched?.pluginNamespaces).toEqual(['ns-a', 'ns-b']);
    });
  });

  describe('get()', () => {
    it('returns conversation by id and userId', () => {
      const conv = store.create({ teamId, userId });
      const fetched = store.get(conv.id, userId);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(conv.id);
      expect(fetched!.teamId).toBe(teamId);
    });

    it('returns undefined for wrong userId', () => {
      const conv = store.create({ teamId, userId });
      expect(store.get(conv.id, 'user-other')).toBeUndefined();
    });

    it('returns undefined for nonexistent id', () => {
      expect(store.get('nonexistent-id', userId)).toBeUndefined();
    });

    it('returns undefined for soft-deleted conversation', () => {
      const conv = store.create({ teamId, userId });
      store.softDelete(conv.id, userId);

      expect(store.get(conv.id, userId)).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('returns conversations for a user sorted by updatedAt DESC', () => {
      const c1 = store.create({ teamId, userId, title: 'First' });
      const c2 = store.create({ teamId, userId, title: 'Second' });
      const c3 = store.create({ teamId, userId, title: 'Third' });

      // Manually set distinct timestamps to guarantee ordering
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run('2099-01-01T00:00:00.000Z', c1.id);
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run('2098-01-01T00:00:00.000Z', c3.id);
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run('2097-01-01T00:00:00.000Z', c2.id);

      const result = store.list(userId);
      expect(result.items).toHaveLength(3);
      expect(result.items[0].id).toBe(c1.id);
      expect(result.items[1].id).toBe(c3.id);
      expect(result.items[2].id).toBe(c2.id);
    });

    it('respects limit', () => {
      store.create({ teamId, userId, title: 'A' });
      store.create({ teamId, userId, title: 'B' });
      store.create({ teamId, userId, title: 'C' });

      const result = store.list(userId, { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });

    it('ignores soft-deleted conversations', () => {
      const c1 = store.create({ teamId, userId, title: 'Keep' });
      const c2 = store.create({ teamId, userId, title: 'Delete' });

      store.softDelete(c2.id, userId);

      const result = store.list(userId);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(c1.id);
    });

    it('supports cursor-based pagination across all items', () => {
      // Create 5 conversations with distinct updated_at values
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const conv = store.create({ teamId, userId, title: `Conv ${i}` });
        // Touch each to get a distinct updated_at (later ones are more recent)
        store.update(conv.id, userId, { title: `Conv ${i} updated` });
        ids.push(conv.id);
      }

      const allItems: string[] = [];

      // Page 1
      const page1 = store.list(userId, { limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      allItems.push(...page1.items.map((c) => c.id));

      // Page 2
      const page2 = store.list(userId, { limit: 2, cursor: page1.nextCursor! });
      expect(page2.items).toHaveLength(2);
      expect(page2.nextCursor).not.toBeNull();
      allItems.push(...page2.items.map((c) => c.id));

      // Page 3 (final)
      const page3 = store.list(userId, { limit: 2, cursor: page2.nextCursor! });
      expect(page3.items).toHaveLength(1);
      expect(page3.nextCursor).toBeNull();
      allItems.push(...page3.items.map((c) => c.id));

      // All 5 conversations returned with no duplicates
      expect(allItems).toHaveLength(5);
      expect(new Set(allItems).size).toBe(5);
    });

    it('returns empty list for user with no conversations', () => {
      const result = store.list('user-nobody');
      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('update()', () => {
    it('updates title', () => {
      const conv = store.create({ teamId, userId, title: 'Old' });
      const updated = store.update(conv.id, userId, { title: 'New' });

      expect(updated).toBeDefined();
      expect(updated!.title).toBe('New');
    });

    it('updates metadata', () => {
      const conv = store.create({ teamId, userId });
      const updated = store.update(conv.id, userId, {
        metadata: { theme: 'dark' },
      });

      expect(updated).toBeDefined();
      expect(updated!.metadata).toEqual({ theme: 'dark' });
    });

    it('returns undefined for wrong userId', () => {
      const conv = store.create({ teamId, userId });
      expect(store.update(conv.id, 'user-other', { title: 'Hack' })).toBeUndefined();
    });

    it('sets updated_at to a newer timestamp', () => {
      const conv = store.create({ teamId, userId });
      const updated = store.update(conv.id, userId, { title: 'Changed' });

      expect(updated).toBeDefined();
      expect(updated!.updatedAt >= conv.updatedAt).toBe(true);
    });
  });

  describe('softDelete()', () => {
    it('sets deleted_at and returns true on success', () => {
      const conv = store.create({ teamId, userId });
      const result = store.softDelete(conv.id, userId);

      expect(result).toBe(true);

      // Verify it's gone from get/list
      expect(store.get(conv.id, userId)).toBeUndefined();
      expect(store.list(userId).items).toHaveLength(0);
    });

    it('returns false for wrong userId', () => {
      const conv = store.create({ teamId, userId });
      expect(store.softDelete(conv.id, 'user-other')).toBe(false);
    });

    it('returns false for already-deleted conversation', () => {
      const conv = store.create({ teamId, userId });
      store.softDelete(conv.id, userId);

      // Second delete should return false (deleted_at IS NULL check fails)
      expect(store.softDelete(conv.id, userId)).toBe(false);
    });

    it('returns false for nonexistent id', () => {
      expect(store.softDelete('nonexistent', userId)).toBe(false);
    });
  });

  describe('updateMessageStats()', () => {
    it('updates message_count and last_message_at', () => {
      const conv = store.create({ teamId, userId });
      const lastMsg = new Date().toISOString();

      store.updateMessageStats(conv.id, 5, lastMsg);

      const fetched = store.get(conv.id, userId);
      expect(fetched).toBeDefined();
      expect(fetched!.messageCount).toBe(5);
      expect(fetched!.lastMessageAt).toBe(lastMsg);
    });

    it('updates updated_at as a side effect', () => {
      const conv = store.create({ teamId, userId });
      const lastMsg = new Date().toISOString();

      store.updateMessageStats(conv.id, 1, lastMsg);

      const fetched = store.get(conv.id, userId);
      expect(fetched!.updatedAt >= conv.updatedAt).toBe(true);
    });
  });

  describe('user isolation', () => {
    it('user A cannot see user B conversations via get', () => {
      const convA = store.create({ teamId, userId: 'user-A' });
      const convB = store.create({ teamId, userId: 'user-B' });

      expect(store.get(convA.id, 'user-B')).toBeUndefined();
      expect(store.get(convB.id, 'user-A')).toBeUndefined();

      // Each user can see their own
      expect(store.get(convA.id, 'user-A')).toBeDefined();
      expect(store.get(convB.id, 'user-B')).toBeDefined();
    });

    it('user A cannot see user B conversations via list', () => {
      store.create({ teamId, userId: 'user-A', title: 'A chat' });
      store.create({ teamId, userId: 'user-B', title: 'B chat' });

      const listA = store.list('user-A');
      const listB = store.list('user-B');

      expect(listA.items).toHaveLength(1);
      expect(listA.items[0].title).toBe('A chat');

      expect(listB.items).toHaveLength(1);
      expect(listB.items[0].title).toBe('B chat');
    });
  });
});
