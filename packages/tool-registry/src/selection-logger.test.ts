import { describe, it, expect } from 'vitest';
import { SelectionLogger } from './selection-logger.js';

const entry = () => ({
  timestamp: Date.now(),
  query: 'test query',
  selectedCount: 5,
  droppedCount: 2,
  tokensUsed: 1000,
  timeMs: 1.5,
  topTools: ['tool-a', 'tool-b'],
});

describe('SelectionLogger', () => {
  it('logs entries', () => {
    const logger = new SelectionLogger();
    logger.log(entry());
    expect(logger.size()).toBe(1);
  });

  it('caps at max entries', () => {
    const logger = new SelectionLogger(3);
    for (let i = 0; i < 5; i++) logger.log(entry());
    expect(logger.size()).toBe(3);
  });

  it('getRecent returns last N entries', () => {
    const logger = new SelectionLogger();
    for (let i = 0; i < 10; i++) logger.log({ ...entry(), selectedCount: i });
    const recent = logger.getRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].selectedCount).toBe(7);
  });

  it('clears all entries', () => {
    const logger = new SelectionLogger();
    logger.log(entry());
    logger.clear();
    expect(logger.size()).toBe(0);
  });

  it('getAll returns copy', () => {
    const logger = new SelectionLogger();
    logger.log(entry());
    const all = logger.getAll();
    expect(all).toHaveLength(1);
    all.pop();
    expect(logger.size()).toBe(1);
  });
});
