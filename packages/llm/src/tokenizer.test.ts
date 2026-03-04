import { describe, it, expect } from 'vitest';
import { HeuristicTokenizer } from './tokenizer.js';

describe('HeuristicTokenizer', () => {
  const tokenizer = new HeuristicTokenizer();

  describe('countTokens', () => {
    it('counts tokens using char/4 heuristic', () => {
      expect(tokenizer.countTokens('abcdefgh')).toBe(2);
      expect(tokenizer.countTokens('abc')).toBe(1); // ceil(3/4)
      expect(tokenizer.countTokens('')).toBe(0);
    });

    it('handles long strings', () => {
      const text = 'x'.repeat(1000);
      expect(tokenizer.countTokens(text)).toBe(250);
    });
  });

  describe('countMessageTokens', () => {
    it('counts tokens for string messages with overhead', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];
      const tokens = tokenizer.countMessageTokens(messages);

      // Each message: 4 overhead + ceil(content.length / 4)
      // "Hello" = ceil(5/4) = 2 + 4 = 6
      // "Hi there!" = ceil(9/4) = 3 + 4 = 7
      expect(tokens).toBe(13);
    });

    it('handles array content by JSON stringifying', () => {
      const messages = [
        { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
      ];
      const tokens = tokenizer.countMessageTokens(messages);
      expect(tokens).toBeGreaterThan(4); // at least the overhead
    });
  });

  describe('countToolTokens', () => {
    it('counts tokens for tool definitions', () => {
      const tools = [
        {
          name: 'search',
          description: 'Search for things',
          parameters: { type: 'object' as const, properties: {} },
        },
      ];
      const tokens = tokenizer.countToolTokens(tools);
      expect(tokens).toBeGreaterThan(0);
    });

    it('returns 0 for empty array', () => {
      expect(tokenizer.countToolTokens([])).toBe(0);
    });
  });
});
