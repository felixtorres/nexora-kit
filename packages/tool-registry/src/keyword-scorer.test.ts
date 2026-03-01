import { describe, it, expect } from 'vitest';
import { tokenize, keywordScore } from './keyword-scorer.js';

describe('tokenize', () => {
  it('lowercases and splits on whitespace', () => {
    expect(tokenize('Search Database')).toEqual(['search', 'database']);
  });

  it('removes stop words', () => {
    expect(tokenize('find the user in the database')).toEqual(['find', 'user', 'database']);
  });

  it('removes punctuation', () => {
    expect(tokenize('hello, world!')).toEqual(['hello', 'world']);
  });

  it('filters single-char tokens', () => {
    expect(tokenize('a b cd ef')).toEqual(['cd', 'ef']);
  });

  it('handles empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('preserves hyphens and underscores', () => {
    expect(tokenize('my-tool get_data')).toEqual(['my-tool', 'get_data']);
  });

  it('handles numbers in tokens', () => {
    expect(tokenize('query v2 tool')).toEqual(['query', 'v2', 'tool']);
  });
});

describe('keywordScore', () => {
  it('returns 1.0 for perfect match', () => {
    expect(keywordScore(['search', 'users'], ['search', 'users', 'data'])).toBe(1.0);
  });

  it('returns 0 for no match', () => {
    expect(keywordScore(['search'], ['create', 'delete'])).toBe(0);
  });

  it('returns partial score for partial match', () => {
    const score = keywordScore(['search', 'users', 'admin'], ['search', 'users']);
    expect(score).toBeCloseTo(2 / 3);
  });

  it('handles partial substring matches at 0.5', () => {
    const score = keywordScore(['search'], ['searching']);
    expect(score).toBe(0.5);
  });

  it('returns 0 for empty query', () => {
    expect(keywordScore([], ['search'])).toBe(0);
  });

  it('returns 0 for empty target', () => {
    expect(keywordScore(['search'], [])).toBe(0);
  });

  it('handles exact match on single token', () => {
    expect(keywordScore(['search'], ['search'])).toBe(1.0);
  });

  it('scores reverse substring match', () => {
    const score = keywordScore(['searching'], ['search']);
    expect(score).toBe(0.5);
  });
});
