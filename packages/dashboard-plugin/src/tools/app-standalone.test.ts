import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolHandlerResponse, ToolExecutionContext } from '@nexora-kit/core';
import { InMemoryDashboardStore } from '../store/dashboard-store.js';
import { createAppPromoteHandler } from './app-promote.js';
import { createAppShareHandler } from './app-share.js';

const SAMPLE_HTML = '<!DOCTYPE html><html><body>Dashboard</body></html>';

const CONTEXT: ToolExecutionContext = {
  conversationId: 'conv-1',
  userId: 'user-1',
  teamId: 'team-1',
};

describe('dashboard:app_promote handler', () => {
  let store: InMemoryDashboardStore;
  let handler: ReturnType<typeof createAppPromoteHandler>;

  beforeEach(() => {
    store = new InMemoryDashboardStore();
    handler = createAppPromoteHandler(store);
  });

  it('promotes an app to standalone', async () => {
    const result = await handler({ html: SAMPLE_HTML, title: 'My Dashboard' }, CONTEXT);
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('My Dashboard');
    expect(response.content).toContain('promoted');
    expect(response.blocks![0].type).toBe('custom:app/preview');
  });

  it('stores the HTML in DashboardStore', async () => {
    await handler({ html: SAMPLE_HTML, title: 'Stored App' }, CONTEXT);
    const dashboards = await store.list('team-1');
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0].title).toBe('Stored App');
    expect(dashboards[0].definition).toBe(SAMPLE_HTML);
  });

  it('returns error for missing html', async () => {
    const result = await handler({ title: 'X' });
    expect(result).toBe('Error: html (generated app content) is required');
  });

  it('returns error for missing title', async () => {
    const result = await handler({ html: SAMPLE_HTML });
    expect(result).toBe('Error: title is required');
  });

  it('sets ownerId and teamId from context', async () => {
    await handler({ html: SAMPLE_HTML, title: 'Ctx Test' }, CONTEXT);
    const dashboards = await store.list('team-1');
    expect(dashboards[0].ownerId).toBe('user-1');
    expect(dashboards[0].teamId).toBe('team-1');
  });
});

describe('dashboard:app_share handler', () => {
  let store: InMemoryDashboardStore;
  let handler: ReturnType<typeof createAppShareHandler>;
  let dashboardId: string;

  beforeEach(async () => {
    store = new InMemoryDashboardStore();
    handler = createAppShareHandler(store);
    const db = await store.create({
      title: 'Test Dashboard',
      ownerId: 'user-1',
      teamId: 'team-1',
      definition: SAMPLE_HTML,
    });
    dashboardId = db.id;
  });

  it('creates a share link', async () => {
    const result = await handler({ dashboardId });
    expect(typeof result).toBe('object');
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('/shared/dashboards/');
    expect(response.content).toContain('Test Dashboard');
    expect(response.content).toContain('No expiration');
  });

  it('creates a share with expiration', async () => {
    const result = await handler({ dashboardId, expiresInHours: 24 });
    const response = result as ToolHandlerResponse;
    expect(response.content).toContain('Expires:');
  });

  it('returns error for missing dashboardId', async () => {
    const result = await handler({});
    expect(result).toBe('Error: dashboardId is required');
  });

  it('returns error for non-existent dashboard', async () => {
    const result = await handler({ dashboardId: 'does-not-exist' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('not found');
  });

  it('share token can retrieve the dashboard', async () => {
    await handler({ dashboardId });
    const shares = await store.listShares(dashboardId);
    expect(shares).toHaveLength(1);
    const retrieved = await store.getByToken(shares[0].token);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.dashboard.definition).toBe(SAMPLE_HTML);
  });
});
