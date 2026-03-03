import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteContextDocumentStore } from './context-document-store.js';

describe('SqliteContextDocumentStore', () => {
  let db: Database.Database;
  let store: SqliteContextDocumentStore;

  const workspaceId = 'ws-1';

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    // Insert a workspace row so FK constraint is satisfied
    db.prepare('INSERT INTO workspaces (id, team_id, name, metadata) VALUES (?, ?, ?, ?)').run(
      workspaceId, 'team-1', 'Test Workspace', '{}',
    );
    store = new SqliteContextDocumentStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create()', () => {
    it('creates a document with defaults', () => {
      const doc = store.create({
        workspaceId,
        title: 'Getting Started',
        content: 'Welcome to our platform.',
      });

      expect(doc.id).toMatch(/^[0-9a-f]{8}-/);
      expect(doc.workspaceId).toBe(workspaceId);
      expect(doc.title).toBe('Getting Started');
      expect(doc.content).toBe('Welcome to our platform.');
      expect(doc.priority).toBe(0);
      expect(doc.tokenCount).toBeGreaterThan(0);
      expect(doc.metadata).toEqual({});
    });

    it('creates a document with custom priority and metadata', () => {
      const doc = store.create({
        workspaceId,
        title: 'Important',
        content: 'Critical info',
        priority: 10,
        metadata: { source: 'manual' },
      });

      expect(doc.priority).toBe(10);
      expect(doc.metadata).toEqual({ source: 'manual' });
    });

    it('estimates token count from content length', () => {
      const content = 'a'.repeat(400); // ~100 tokens at 4 chars/token
      const doc = store.create({ workspaceId, title: 'Long', content });
      expect(doc.tokenCount).toBe(100);
    });
  });

  describe('get()', () => {
    it('returns undefined for non-existent document', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });

    it('returns the document', () => {
      const doc = store.create({ workspaceId, title: 'Doc', content: 'text' });
      const found = store.get(doc.id);
      expect(found!.id).toBe(doc.id);
      expect(found!.title).toBe('Doc');
    });
  });

  describe('listByWorkspace()', () => {
    it('returns empty for no documents', () => {
      expect(store.listByWorkspace(workspaceId)).toEqual([]);
    });

    it('lists documents ordered by priority DESC then title ASC', () => {
      store.create({ workspaceId, title: 'Bravo', content: 'b', priority: 5 });
      store.create({ workspaceId, title: 'Alpha', content: 'a', priority: 10 });
      store.create({ workspaceId, title: 'Charlie', content: 'c', priority: 5 });

      const docs = store.listByWorkspace(workspaceId);
      expect(docs).toHaveLength(3);
      expect(docs[0].title).toBe('Alpha');    // priority 10 (highest first)
      expect(docs[1].title).toBe('Bravo');    // priority 5, alphabetical
      expect(docs[2].title).toBe('Charlie');  // priority 5, alphabetical
    });

    it('does not return documents from other workspaces', () => {
      db.prepare('INSERT INTO workspaces (id, team_id, name, metadata) VALUES (?, ?, ?, ?)').run(
        'ws-2', 'team-1', 'Other Workspace', '{}',
      );
      store.create({ workspaceId, title: 'Doc A', content: 'a' });
      store.create({ workspaceId: 'ws-2', title: 'Doc B', content: 'b' });

      const docs = store.listByWorkspace(workspaceId);
      expect(docs).toHaveLength(1);
      expect(docs[0].title).toBe('Doc A');
    });
  });

  describe('update()', () => {
    it('returns undefined for non-existent document', () => {
      expect(store.update('nonexistent', { title: 'X' })).toBeUndefined();
    });

    it('updates title', () => {
      const doc = store.create({ workspaceId, title: 'Old', content: 'text' });
      const updated = store.update(doc.id, { title: 'New' });
      expect(updated!.title).toBe('New');
    });

    it('updates content and recalculates token count', () => {
      const doc = store.create({ workspaceId, title: 'Doc', content: 'short' });
      const originalTokens = doc.tokenCount;

      const longContent = 'x'.repeat(800);
      const updated = store.update(doc.id, { content: longContent });
      expect(updated!.content).toBe(longContent);
      expect(updated!.tokenCount).toBeGreaterThan(originalTokens);
    });

    it('updates priority', () => {
      const doc = store.create({ workspaceId, title: 'Doc', content: 'text', priority: 0 });
      const updated = store.update(doc.id, { priority: 50 });
      expect(updated!.priority).toBe(50);
    });

    it('returns existing record when no fields provided', () => {
      const doc = store.create({ workspaceId, title: 'Doc', content: 'text' });
      const same = store.update(doc.id, {});
      expect(same!.title).toBe('Doc');
    });
  });

  describe('delete()', () => {
    it('returns false for non-existent document', () => {
      expect(store.delete('nonexistent')).toBe(false);
    });

    it('deletes an existing document', () => {
      const doc = store.create({ workspaceId, title: 'Doc', content: 'text' });
      expect(store.delete(doc.id)).toBe(true);
      expect(store.get(doc.id)).toBeUndefined();
    });
  });

  describe('deleteByWorkspace()', () => {
    it('deletes all documents for a workspace', () => {
      store.create({ workspaceId, title: 'Doc 1', content: 'a' });
      store.create({ workspaceId, title: 'Doc 2', content: 'b' });

      store.deleteByWorkspace(workspaceId);
      expect(store.listByWorkspace(workspaceId)).toEqual([]);
    });
  });
});
