import { describe, it, expect } from 'vitest';
import { InMemoryWorkingMemory } from './working-memory.js';

describe('InMemoryWorkingMemory', () => {
  it('stores and retrieves notes per conversation', () => {
    const wm = new InMemoryWorkingMemory();
    wm.addNote('conv-1', 'first note');
    wm.addNote('conv-1', 'second note');
    wm.addNote('conv-2', 'different conv');

    expect(wm.getNotes('conv-1')).toEqual(['first note', 'second note']);
    expect(wm.getNotes('conv-2')).toEqual(['different conv']);
  });

  it('returns empty array for unknown conversation', () => {
    const wm = new InMemoryWorkingMemory();
    expect(wm.getNotes('unknown')).toEqual([]);
  });

  it('clears notes for a conversation', () => {
    const wm = new InMemoryWorkingMemory();
    wm.addNote('conv-1', 'note');
    wm.clear('conv-1');
    expect(wm.getNotes('conv-1')).toEqual([]);
  });
});
