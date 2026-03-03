import { describe, it, expect } from 'vitest';
import { InMemoryMessageStore } from './memory.js';

describe('InMemoryMessageStore', () => {
  it('returns empty array for unknown conversation', async () => {
    const store = new InMemoryMessageStore();
    expect(await store.get('unknown')).toEqual([]);
  });

  it('appends and retrieves messages', async () => {
    const store = new InMemoryMessageStore();
    await store.append('c1', [{ role: 'user', content: 'Hello' }]);
    await store.append('c1', [{ role: 'assistant', content: 'Hi!' }]);

    const messages = await store.get('c1');
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].content).toBe('Hi!');
  });

  it('isolates conversations', async () => {
    const store = new InMemoryMessageStore();
    await store.append('c1', [{ role: 'user', content: 'Conversation 1' }]);
    await store.append('c2', [{ role: 'user', content: 'Conversation 2' }]);

    expect(await store.get('c1')).toHaveLength(1);
    expect(await store.get('c2')).toHaveLength(1);
  });

  it('clears a conversation', async () => {
    const store = new InMemoryMessageStore();
    await store.append('c1', [{ role: 'user', content: 'Hello' }]);
    await store.clear('c1');
    expect(await store.get('c1')).toEqual([]);
  });

  it('returns a copy, not a reference', async () => {
    const store = new InMemoryMessageStore();
    await store.append('c1', [{ role: 'user', content: 'Hello' }]);
    const messages = await store.get('c1');
    messages.push({ role: 'assistant', content: 'Injected' });
    expect(await store.get('c1')).toHaveLength(1);
  });

  it('truncates messages from a given sequence number', async () => {
    const store = new InMemoryMessageStore();
    await store.append('c1', [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Second' },
      { role: 'user', content: 'Third' },
    ]);
    await store.truncateFrom('c1', 1);
    const messages = await store.get('c1');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('First');
  });

  it('truncateFrom does nothing for non-existent conversation', async () => {
    const store = new InMemoryMessageStore();
    await store.truncateFrom('nonexistent', 0);
    expect(await store.get('nonexistent')).toEqual([]);
  });
});
