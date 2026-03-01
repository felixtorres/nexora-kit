import { describe, it, expect } from 'vitest';
import { InMemoryStore } from './memory.js';

describe('InMemoryStore', () => {
  it('returns empty array for unknown session', async () => {
    const store = new InMemoryStore();
    expect(await store.get('unknown')).toEqual([]);
  });

  it('appends and retrieves messages', async () => {
    const store = new InMemoryStore();
    await store.append('s1', [{ role: 'user', content: 'Hello' }]);
    await store.append('s1', [{ role: 'assistant', content: 'Hi!' }]);

    const messages = await store.get('s1');
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].content).toBe('Hi!');
  });

  it('isolates sessions', async () => {
    const store = new InMemoryStore();
    await store.append('s1', [{ role: 'user', content: 'Session 1' }]);
    await store.append('s2', [{ role: 'user', content: 'Session 2' }]);

    expect(await store.get('s1')).toHaveLength(1);
    expect(await store.get('s2')).toHaveLength(1);
  });

  it('clears a session', async () => {
    const store = new InMemoryStore();
    await store.append('s1', [{ role: 'user', content: 'Hello' }]);
    await store.clear('s1');
    expect(await store.get('s1')).toEqual([]);
  });

  it('returns a copy, not a reference', async () => {
    const store = new InMemoryStore();
    await store.append('s1', [{ role: 'user', content: 'Hello' }]);
    const messages = await store.get('s1');
    messages.push({ role: 'assistant', content: 'Injected' });
    expect(await store.get('s1')).toHaveLength(1);
  });
});
