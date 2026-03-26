import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDashboardStore } from './dashboard-store.js';

describe('InMemoryDashboardStore', () => {
  let store: InMemoryDashboardStore;

  beforeEach(() => {
    store = new InMemoryDashboardStore();
  });

  describe('CRUD', () => {
    it('creates and retrieves a dashboard', async () => {
      const d = await store.create({
        title: 'Sales', ownerId: 'u1', teamId: 't1', definition: '{}',
      });
      expect(d.id).toBeTruthy();
      expect(d.title).toBe('Sales');

      const got = await store.get(d.id);
      expect(got).toEqual(d);
    });

    it('lists dashboards by team', async () => {
      await store.create({ title: 'A', ownerId: 'u1', teamId: 't1', definition: '{}' });
      await store.create({ title: 'B', ownerId: 'u1', teamId: 't2', definition: '{}' });
      await store.create({ title: 'C', ownerId: 'u1', teamId: 't1', definition: '{}' });

      const t1 = await store.list('t1');
      expect(t1).toHaveLength(2);
      const t2 = await store.list('t2');
      expect(t2).toHaveLength(1);
    });

    it('updates a dashboard', async () => {
      const d = await store.create({ title: 'Old', ownerId: 'u1', teamId: 't1', definition: '{}' });
      // Wait 1ms to ensure updatedAt differs
      await new Promise((r) => setTimeout(r, 2));
      const updated = await store.update(d.id, { title: 'New' });
      expect(updated!.title).toBe('New');
      expect(updated!.updatedAt).not.toBe(d.createdAt);
    });

    it('returns null for non-existent update', async () => {
      const result = await store.update('nonexistent', { title: 'X' });
      expect(result).toBeNull();
    });

    it('deletes a dashboard and cascades shares', async () => {
      const d = await store.create({ title: 'Del', ownerId: 'u1', teamId: 't1', definition: '{}' });
      await store.createShare(d.id);
      expect(await store.listShares(d.id)).toHaveLength(1);

      const deleted = await store.delete(d.id);
      expect(deleted).toBe(true);
      expect(await store.get(d.id)).toBeNull();
      expect(await store.listShares(d.id)).toHaveLength(0);
    });

    it('returns null for non-existent get', async () => {
      expect(await store.get('nope')).toBeNull();
    });
  });

  describe('sharing', () => {
    it('creates and retrieves a share', async () => {
      const d = await store.create({ title: 'S', ownerId: 'u1', teamId: 't1', definition: '{}' });
      const share = await store.createShare(d.id);
      expect(share.token).toBeTruthy();
      expect(share.permissions).toBe('read-only');

      const got = await store.getShare(share.token);
      expect(got).toEqual(share);
    });

    it('getByToken returns dashboard + share', async () => {
      const d = await store.create({ title: 'Shared', ownerId: 'u1', teamId: 't1', definition: '{"version":1}' });
      const share = await store.createShare(d.id);

      const result = await store.getByToken(share.token);
      expect(result).not.toBeNull();
      expect(result!.dashboard.id).toBe(d.id);
      expect(result!.share.id).toBe(share.id);
    });

    it('getByToken returns null for expired token', async () => {
      const d = await store.create({ title: 'Exp', ownerId: 'u1', teamId: 't1', definition: '{}' });
      const share = await store.createShare(d.id, new Date(Date.now() - 1000).toISOString());

      const result = await store.getByToken(share.token);
      expect(result).toBeNull();
    });

    it('getByToken returns null for unknown token', async () => {
      expect(await store.getByToken('bad-token')).toBeNull();
    });

    it('deletes a share', async () => {
      const d = await store.create({ title: 'D', ownerId: 'u1', teamId: 't1', definition: '{}' });
      const share = await store.createShare(d.id);
      await store.deleteShare(share.id);
      expect(await store.getShare(share.token)).toBeNull();
    });

    it('throws when sharing non-existent dashboard', async () => {
      await expect(store.createShare('bad-id')).rejects.toThrow('not found');
    });
  });

  describe('refresh scheduling', () => {
    it('lists dashboards due for refresh', async () => {
      await store.create({ title: 'No Refresh', ownerId: 'u1', teamId: 't1', definition: '{}' });
      const d2 = await store.create({
        title: 'Due', ownerId: 'u1', teamId: 't1', definition: '{}', refreshInterval: 60,
      });
      // d2 has no lastRefreshedAt → always due

      const due = await store.listDueForRefresh();
      expect(due).toHaveLength(1);
      expect(due[0].id).toBe(d2.id);
    });

    it('skips recently refreshed dashboards', async () => {
      const d = await store.create({
        title: 'Recent', ownerId: 'u1', teamId: 't1', definition: '{}', refreshInterval: 3600,
      });
      await store.update(d.id, { lastRefreshedAt: new Date().toISOString() });

      const due = await store.listDueForRefresh();
      expect(due).toHaveLength(0);
    });
  });
});
