import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteFeedbackStore } from './feedback-store.js';

describe('SqliteFeedbackStore', () => {
  let db: Database.Database;
  let store: SqliteFeedbackStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteFeedbackStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('submits and retrieves feedback', () => {
    const feedback = store.submit({
      conversationId: 'conv-1',
      messageSeq: 2,
      userId: 'user-1',
      rating: 'positive',
      comment: 'Great answer!',
      tags: ['helpful'],
      pluginNamespace: 'faq',
      model: 'claude-3',
    });

    expect(feedback.id).toBeDefined();
    expect(feedback.conversationId).toBe('conv-1');
    expect(feedback.messageSeq).toBe(2);
    expect(feedback.userId).toBe('user-1');
    expect(feedback.rating).toBe('positive');
    expect(feedback.comment).toBe('Great answer!');
    expect(feedback.tags).toEqual(['helpful']);
    expect(feedback.pluginNamespace).toBe('faq');
    expect(feedback.model).toBe('claude-3');
    expect(feedback.createdAt).toBeDefined();

    const retrieved = store.get('conv-1', 2, 'user-1');
    expect(retrieved).toEqual(feedback);
  });

  it('returns undefined for nonexistent feedback', () => {
    const result = store.get('conv-1', 0, 'user-1');
    expect(result).toBeUndefined();
  });

  it('upserts on duplicate (conversation, messageSeq, user)', () => {
    store.submit({
      conversationId: 'conv-1',
      messageSeq: 2,
      userId: 'user-1',
      rating: 'positive',
    });

    const updated = store.submit({
      conversationId: 'conv-1',
      messageSeq: 2,
      userId: 'user-1',
      rating: 'negative',
      comment: 'Changed my mind',
    });

    expect(updated.rating).toBe('negative');
    expect(updated.comment).toBe('Changed my mind');

    // Only one record
    const all = store.query();
    expect(all.items).toHaveLength(1);
  });

  it('stores feedback without optional fields', () => {
    const feedback = store.submit({
      conversationId: 'conv-1',
      messageSeq: 0,
      userId: 'user-1',
      rating: 'negative',
    });

    expect(feedback.comment).toBeNull();
    expect(feedback.tags).toEqual([]);
    expect(feedback.pluginNamespace).toBeNull();
    expect(feedback.model).toBeNull();
  });

  it('queries with no filters', () => {
    store.submit({ conversationId: 'conv-1', messageSeq: 0, userId: 'u1', rating: 'positive' });
    store.submit({ conversationId: 'conv-1', messageSeq: 1, userId: 'u1', rating: 'negative' });
    store.submit({ conversationId: 'conv-2', messageSeq: 0, userId: 'u2', rating: 'positive' });

    const result = store.query();
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  it('queries filtered by rating', () => {
    store.submit({ conversationId: 'c1', messageSeq: 0, userId: 'u1', rating: 'positive' });
    store.submit({ conversationId: 'c1', messageSeq: 1, userId: 'u1', rating: 'negative' });

    const positives = store.query({ rating: 'positive' });
    expect(positives.items).toHaveLength(1);
    expect(positives.items[0].rating).toBe('positive');
  });

  it('queries filtered by pluginNamespace', () => {
    store.submit({ conversationId: 'c1', messageSeq: 0, userId: 'u1', rating: 'positive', pluginNamespace: 'faq' });
    store.submit({ conversationId: 'c1', messageSeq: 1, userId: 'u1', rating: 'positive', pluginNamespace: 'support' });

    const result = store.query({ pluginNamespace: 'faq' });
    expect(result.items).toHaveLength(1);
  });

  it('paginates with limit and cursor', () => {
    for (let i = 0; i < 5; i++) {
      store.submit({ conversationId: 'c1', messageSeq: i, userId: 'u1', rating: 'positive' });
    }

    const page1 = store.query({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = store.query({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = store.query({ limit: 2, cursor: page2.nextCursor! });
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
  });

  it('computes summary with counts and rates', () => {
    store.submit({ conversationId: 'c1', messageSeq: 0, userId: 'u1', rating: 'positive', pluginNamespace: 'faq', model: 'claude-3' });
    store.submit({ conversationId: 'c1', messageSeq: 1, userId: 'u1', rating: 'negative', pluginNamespace: 'faq', model: 'claude-3' });
    store.submit({ conversationId: 'c2', messageSeq: 0, userId: 'u2', rating: 'positive', pluginNamespace: 'support', model: 'gpt-4' });

    const summary = store.summary();
    expect(summary.totalCount).toBe(3);
    expect(summary.positiveCount).toBe(2);
    expect(summary.negativeCount).toBe(1);
    expect(summary.positiveRate).toBeCloseTo(2 / 3);
    expect(summary.byPlugin).toHaveLength(2);
    expect(summary.byModel).toHaveLength(2);
  });

  it('computes summary filtered by plugin', () => {
    store.submit({ conversationId: 'c1', messageSeq: 0, userId: 'u1', rating: 'positive', pluginNamespace: 'faq' });
    store.submit({ conversationId: 'c1', messageSeq: 1, userId: 'u1', rating: 'negative', pluginNamespace: 'support' });

    const summary = store.summary({ pluginNamespace: 'faq' });
    expect(summary.totalCount).toBe(1);
    expect(summary.positiveCount).toBe(1);
  });

  it('computes top tags in summary', () => {
    store.submit({ conversationId: 'c1', messageSeq: 0, userId: 'u1', rating: 'positive', tags: ['helpful', 'fast'] });
    store.submit({ conversationId: 'c1', messageSeq: 1, userId: 'u1', rating: 'negative', tags: ['wrong', 'helpful'] });
    store.submit({ conversationId: 'c2', messageSeq: 0, userId: 'u2', rating: 'negative', tags: ['wrong'] });

    const summary = store.summary();
    expect(summary.topTags[0]).toEqual({ tag: 'helpful', count: 2 });
    expect(summary.topTags[1]).toEqual({ tag: 'wrong', count: 2 });
    expect(summary.topTags[2]).toEqual({ tag: 'fast', count: 1 });
  });

  it('returns empty summary when no feedback exists', () => {
    const summary = store.summary();
    expect(summary.totalCount).toBe(0);
    expect(summary.positiveCount).toBe(0);
    expect(summary.negativeCount).toBe(0);
    expect(summary.positiveRate).toBe(0);
    expect(summary.byPlugin).toEqual([]);
    expect(summary.byModel).toEqual([]);
    expect(summary.topTags).toEqual([]);
  });

  it('deleteByConversation removes all feedback for a conversation', () => {
    store.submit({ conversationId: 'c1', messageSeq: 0, userId: 'u1', rating: 'positive' });
    store.submit({ conversationId: 'c1', messageSeq: 1, userId: 'u1', rating: 'negative' });
    store.submit({ conversationId: 'c2', messageSeq: 0, userId: 'u2', rating: 'positive' });

    store.deleteByConversation('c1');

    const result = store.query();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].conversationId).toBe('c2');
  });

  it('deleteFromSeq removes feedback at and after given seq', () => {
    store.submit({ conversationId: 'c1', messageSeq: 1, userId: 'u1', rating: 'positive' });
    store.submit({ conversationId: 'c1', messageSeq: 2, userId: 'u1', rating: 'negative' });
    store.submit({ conversationId: 'c1', messageSeq: 3, userId: 'u1', rating: 'positive' });
    store.submit({ conversationId: 'c1', messageSeq: 4, userId: 'u1', rating: 'negative' });

    store.deleteFromSeq('c1', 3);

    const result = store.query();
    expect(result.items).toHaveLength(2);
    expect(result.items.every((f) => f.messageSeq < 3)).toBe(true);
  });

  it('deleteFromSeq does not affect other conversations', () => {
    store.submit({ conversationId: 'c1', messageSeq: 1, userId: 'u1', rating: 'positive' });
    store.submit({ conversationId: 'c1', messageSeq: 2, userId: 'u1', rating: 'negative' });
    store.submit({ conversationId: 'c2', messageSeq: 2, userId: 'u1', rating: 'positive' });

    store.deleteFromSeq('c1', 2);

    const result = store.query();
    expect(result.items).toHaveLength(2); // c1 seq 1 + c2 seq 2
  });

  it('allows different users to rate same message', () => {
    store.submit({ conversationId: 'c1', messageSeq: 0, userId: 'u1', rating: 'positive' });
    store.submit({ conversationId: 'c1', messageSeq: 0, userId: 'u2', rating: 'negative' });

    const all = store.query();
    expect(all.items).toHaveLength(2);

    const u1 = store.get('c1', 0, 'u1');
    expect(u1?.rating).toBe('positive');

    const u2 = store.get('c1', 0, 'u2');
    expect(u2?.rating).toBe('negative');
  });
});
