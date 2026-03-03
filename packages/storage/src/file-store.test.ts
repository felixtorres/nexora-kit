import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteFileStore } from './file-store.js';

describe('SqliteFileStore', () => {
  let db: Database.Database;
  let store: SqliteFileStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteFileStore(db);
  });

  it('creates and retrieves a file record', () => {
    const record = store.create({
      conversationId: 'conv-1',
      userId: 'user-1',
      filename: 'test.txt',
      mimeType: 'text/plain',
      sizeBytes: 100,
      storagePath: '/data/files/abc.txt',
    });

    expect(record.id).toBeDefined();
    expect(record.conversationId).toBe('conv-1');
    expect(record.filename).toBe('test.txt');
    expect(record.mimeType).toBe('text/plain');
    expect(record.sizeBytes).toBe(100);

    const fetched = store.get(record.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(record.id);
  });

  it('returns undefined for non-existent file', () => {
    expect(store.get('nope')).toBeUndefined();
  });

  it('lists files by conversation', () => {
    store.create({ conversationId: 'conv-1', userId: 'user-1', filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 10, storagePath: '/a' });
    store.create({ conversationId: 'conv-1', userId: 'user-1', filename: 'b.txt', mimeType: 'text/plain', sizeBytes: 20, storagePath: '/b' });
    store.create({ conversationId: 'conv-2', userId: 'user-1', filename: 'c.txt', mimeType: 'text/plain', sizeBytes: 30, storagePath: '/c' });

    const files = store.listByConversation('conv-1');
    expect(files).toHaveLength(2);
    expect(files[0].filename).toBe('a.txt');
    expect(files[1].filename).toBe('b.txt');
  });

  it('deletes a file record', () => {
    const record = store.create({ conversationId: 'conv-1', userId: 'user-1', filename: 'x.txt', mimeType: 'text/plain', sizeBytes: 5, storagePath: '/x' });

    expect(store.delete(record.id)).toBe(true);
    expect(store.get(record.id)).toBeUndefined();
  });

  it('returns false when deleting non-existent file', () => {
    expect(store.delete('nope')).toBe(false);
  });

  it('deleteByConversation removes all files for a conversation', () => {
    store.create({ conversationId: 'conv-1', userId: 'user-1', filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 10, storagePath: '/a' });
    store.create({ conversationId: 'conv-1', userId: 'user-1', filename: 'b.txt', mimeType: 'text/plain', sizeBytes: 20, storagePath: '/b' });
    store.create({ conversationId: 'conv-2', userId: 'user-1', filename: 'c.txt', mimeType: 'text/plain', sizeBytes: 30, storagePath: '/c' });

    store.deleteByConversation('conv-1');

    expect(store.listByConversation('conv-1')).toHaveLength(0);
    expect(store.listByConversation('conv-2')).toHaveLength(1);
  });

  it('stores and retrieves metadata', () => {
    const record = store.create({
      conversationId: 'conv-1',
      userId: 'user-1',
      filename: 'data.json',
      mimeType: 'application/json',
      sizeBytes: 50,
      storagePath: '/data.json',
      metadata: { source: 'upload', tags: ['important'] },
    });

    const fetched = store.get(record.id)!;
    expect(fetched.metadata).toEqual({ source: 'upload', tags: ['important'] });
  });
});
