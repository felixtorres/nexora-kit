import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationToolMemory } from './conversation-tool-memory.js';

describe('ConversationToolMemory', () => {
  it('stores and retrieves loaded tools', () => {
    const mem = new ConversationToolMemory();
    mem.load('conv-1', ['tool-a', 'tool-b']);
    expect(mem.getLoaded('conv-1')).toEqual(['tool-a', 'tool-b']);
  });

  it('returns empty array for unknown conversation', () => {
    const mem = new ConversationToolMemory();
    expect(mem.getLoaded('unknown')).toEqual([]);
  });

  it('accumulates tools across multiple load calls', () => {
    const mem = new ConversationToolMemory();
    mem.load('conv-1', ['tool-a']);
    mem.load('conv-1', ['tool-b', 'tool-c']);
    expect(mem.getLoaded('conv-1')).toEqual(['tool-a', 'tool-b', 'tool-c']);
  });

  it('deduplicates tool names', () => {
    const mem = new ConversationToolMemory();
    mem.load('conv-1', ['tool-a', 'tool-b']);
    mem.load('conv-1', ['tool-a', 'tool-c']);
    expect(mem.getLoaded('conv-1')).toEqual(['tool-a', 'tool-b', 'tool-c']);
  });

  it('enforces max tools limit', () => {
    const mem = new ConversationToolMemory({ maxTools: 3 });
    mem.load('conv-1', ['t1', 't2', 't3', 't4', 't5']);
    expect(mem.getLoaded('conv-1')).toHaveLength(3);
  });

  it('clears conversation memory', () => {
    const mem = new ConversationToolMemory();
    mem.load('conv-1', ['tool-a']);
    mem.clear('conv-1');
    expect(mem.getLoaded('conv-1')).toEqual([]);
  });

  it('isolates conversations', () => {
    const mem = new ConversationToolMemory();
    mem.load('conv-1', ['tool-a']);
    mem.load('conv-2', ['tool-b']);
    expect(mem.getLoaded('conv-1')).toEqual(['tool-a']);
    expect(mem.getLoaded('conv-2')).toEqual(['tool-b']);
  });

  describe('TTL eviction', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('evicts entries after TTL expires', () => {
      const mem = new ConversationToolMemory({ ttlMs: 1000 });
      mem.load('conv-1', ['tool-a']);
      vi.advanceTimersByTime(1500);
      expect(mem.getLoaded('conv-1')).toEqual([]);
    });

    it('keeps entries within TTL', () => {
      const mem = new ConversationToolMemory({ ttlMs: 5000 });
      mem.load('conv-1', ['tool-a']);
      vi.advanceTimersByTime(3000);
      expect(mem.getLoaded('conv-1')).toEqual(['tool-a']);
    });
  });
});
