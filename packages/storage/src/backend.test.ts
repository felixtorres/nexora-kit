import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createStorageBackend, type StorageBackend } from './backend.js';

describe('createStorageBackend', () => {
  let backend: StorageBackend | undefined;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nxk-backend-test-'));
  });

  afterEach(async () => {
    await backend?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates SQLite backend', async () => {
    backend = await createStorageBackend({
      type: 'sqlite',
      path: join(tmpDir, 'test.db'),
    });

    expect(backend.memoryStore).toBeDefined();
    expect(backend.configStore).toBeDefined();
    expect(backend.pluginStateStore).toBeDefined();
    expect(backend.tokenUsageStore).toBeDefined();
    expect(backend.usageEventStore).toBeDefined();
    expect(backend.auditEventStore).toBeDefined();
  });

  it('SQLite backend stores and retrieves messages', async () => {
    backend = await createStorageBackend({
      type: 'sqlite',
      path: join(tmpDir, 'test2.db'),
    });

    await backend.memoryStore.append('sess-1', [
      { role: 'user', content: 'Hello' },
    ]);
    const msgs = await backend.memoryStore.get('sess-1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });

  it('throws for postgres when pg is not installed', async () => {
    await expect(
      createStorageBackend({
        type: 'postgres',
        connectionString: 'postgresql://localhost/test',
      }),
    ).rejects.toThrow(/pg/);
  });

  it('throws for unknown backend type', async () => {
    await expect(
      createStorageBackend({ type: 'unknown' } as any),
    ).rejects.toThrow(/Unknown/);
  });
});
