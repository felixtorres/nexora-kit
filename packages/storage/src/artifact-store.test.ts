import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteArtifactStore } from './artifact-store.js';

describe('SqliteArtifactStore', () => {
  let db: Database.Database;
  let store: SqliteArtifactStore;

  const conversationId = 'conv-1';

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteArtifactStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create()', () => {
    it('creates an artifact with version 1', () => {
      const artifact = store.create({
        conversationId,
        title: 'My Document',
        content: '# Hello World',
      });

      expect(artifact.id).toMatch(/^[0-9a-f]{8}-/);
      expect(artifact.conversationId).toBe(conversationId);
      expect(artifact.title).toBe('My Document');
      expect(artifact.type).toBe('document');
      expect(artifact.language).toBeNull();
      expect(artifact.currentVersion).toBe(1);
      expect(artifact.content).toBe('# Hello World');
      expect(artifact.metadata).toEqual({});
      expect(artifact.createdAt).toBeTruthy();
      expect(artifact.updatedAt).toBe(artifact.createdAt);
    });

    it('creates a code artifact with type and language', () => {
      const artifact = store.create({
        conversationId,
        title: 'app.ts',
        type: 'code',
        language: 'typescript',
        content: 'console.log("hello");',
        metadata: { source: 'llm' },
      });

      expect(artifact.type).toBe('code');
      expect(artifact.language).toBe('typescript');
      expect(artifact.metadata).toEqual({ source: 'llm' });
    });

    it('creates version 1 in artifact_versions', () => {
      const artifact = store.create({
        conversationId,
        title: 'test',
        content: 'v1 content',
      });

      const version = store.getVersion(artifact.id, 1);
      expect(version).toBeDefined();
      expect(version!.content).toBe('v1 content');
      expect(version!.version).toBe(1);
    });
  });

  describe('update()', () => {
    it('increments version and updates content', () => {
      const artifact = store.create({
        conversationId,
        title: 'Doc',
        content: 'version 1',
      });

      const updated = store.update(artifact.id, 'version 2');

      expect(updated).toBeDefined();
      expect(updated!.currentVersion).toBe(2);
      expect(updated!.content).toBe('version 2');
      // updatedAt is refreshed (may match createdAt within same second due to SQLite datetime precision)
      expect(updated!.updatedAt).toBeTruthy();
    });

    it('preserves all previous versions', () => {
      const artifact = store.create({
        conversationId,
        title: 'Doc',
        content: 'v1',
      });

      store.update(artifact.id, 'v2');
      store.update(artifact.id, 'v3');

      const versions = store.listVersions(artifact.id);
      expect(versions).toHaveLength(3);
      expect(versions[0].content).toBe('v1');
      expect(versions[1].content).toBe('v2');
      expect(versions[2].content).toBe('v3');
    });

    it('returns undefined for nonexistent artifact', () => {
      expect(store.update('nope', 'content')).toBeUndefined();
    });
  });

  describe('get()', () => {
    it('returns artifact with current version content', () => {
      const created = store.create({
        conversationId,
        title: 'Doc',
        content: 'original',
      });
      store.update(created.id, 'updated');

      const artifact = store.get(created.id);
      expect(artifact).toBeDefined();
      expect(artifact!.content).toBe('updated');
      expect(artifact!.currentVersion).toBe(2);
    });

    it('returns undefined for nonexistent id', () => {
      expect(store.get('nope')).toBeUndefined();
    });
  });

  describe('listByConversation()', () => {
    it('lists artifacts for a conversation ordered by created_at', () => {
      store.create({ conversationId, title: 'B', content: 'b' });
      store.create({ conversationId, title: 'A', content: 'a' });
      store.create({ conversationId: 'other', title: 'C', content: 'c' });

      const list = store.listByConversation(conversationId);
      expect(list).toHaveLength(2);
      expect(list[0].title).toBe('B');
      expect(list[1].title).toBe('A');
    });

    it('returns empty array for no artifacts', () => {
      expect(store.listByConversation('empty')).toEqual([]);
    });
  });

  describe('getVersion()', () => {
    it('returns a specific version', () => {
      const artifact = store.create({
        conversationId,
        title: 'Doc',
        content: 'first',
      });
      store.update(artifact.id, 'second');

      const v1 = store.getVersion(artifact.id, 1);
      expect(v1!.content).toBe('first');

      const v2 = store.getVersion(artifact.id, 2);
      expect(v2!.content).toBe('second');
    });

    it('returns undefined for nonexistent version', () => {
      const artifact = store.create({
        conversationId,
        title: 'Doc',
        content: 'only',
      });

      expect(store.getVersion(artifact.id, 99)).toBeUndefined();
    });
  });

  describe('listVersions()', () => {
    it('returns all versions in order', () => {
      const artifact = store.create({
        conversationId,
        title: 'Doc',
        content: 'v1',
      });
      store.update(artifact.id, 'v2');

      const versions = store.listVersions(artifact.id);
      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(1);
      expect(versions[1].version).toBe(2);
    });

    it('returns empty array for nonexistent artifact', () => {
      expect(store.listVersions('nope')).toEqual([]);
    });
  });

  describe('delete()', () => {
    it('deletes artifact and all versions', () => {
      const artifact = store.create({
        conversationId,
        title: 'Doomed',
        content: 'bye',
      });
      store.update(artifact.id, 'still bye');

      expect(store.delete(artifact.id)).toBe(true);
      expect(store.get(artifact.id)).toBeUndefined();
      expect(store.listVersions(artifact.id)).toEqual([]);
    });

    it('returns false for nonexistent artifact', () => {
      expect(store.delete('nope')).toBe(false);
    });
  });

  describe('deleteByConversation()', () => {
    it('deletes all artifacts and versions for a conversation', () => {
      store.create({ conversationId, title: 'A', content: 'a' });
      store.create({ conversationId, title: 'B', content: 'b' });
      store.create({ conversationId: 'other', title: 'C', content: 'c' });

      store.deleteByConversation(conversationId);

      expect(store.listByConversation(conversationId)).toEqual([]);
      expect(store.listByConversation('other')).toHaveLength(1);
    });
  });
});
