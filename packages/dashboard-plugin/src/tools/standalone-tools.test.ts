import { describe, it, expect, beforeEach } from 'vitest';
import { createPromoteDashboardHandler } from './promote-dashboard.js';
import { createShareDashboardHandler } from './share-dashboard.js';
import { createListDashboardsHandler } from './list-dashboards.js';
import { InMemoryDashboardStore } from '../store/dashboard-store.js';
import { serializeDashboard, createDashboardDefinition } from '../widgets/dashboard-model.js';
import type { KpiWidget } from '../widgets/types.js';

function makeDef() {
  const kpi: KpiWidget = {
    id: 'k1', type: 'kpi', title: 'Revenue',
    query: { dataSourceId: 'ds1', sql: 'SELECT 1 AS value' },
    valueField: 'value',
    size: { col: 1, row: 1, width: 3, height: 1 },
  };
  return createDashboardDefinition('Sales Dashboard', [kpi], ['ds1']);
}

describe('dashboard_promote', () => {
  let store: InMemoryDashboardStore;

  beforeEach(() => {
    store = new InMemoryDashboardStore();
  });

  it('promotes a dashboard to standalone', async () => {
    const handler = createPromoteDashboardHandler(store);
    const def = makeDef();
    const result = await handler(
      { definition: serializeDashboard(def) },
      { conversationId: 'c1', userId: 'user1', teamId: 'team1' },
    );

    expect(typeof result).toBe('object');
    const resp = result as any;
    expect(resp.content).toContain('promoted');
    expect(resp.blocks).toHaveLength(1);

    const dashboards = await store.list('team1');
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0].title).toBe('Sales Dashboard');
  });

  it('accepts title override', async () => {
    const handler = createPromoteDashboardHandler(store);
    const def = makeDef();
    await handler(
      { definition: serializeDashboard(def), title: 'Custom Title' },
      { conversationId: 'c1', userId: 'u1', teamId: 't1' },
    );

    const dashboards = await store.list('t1');
    expect(dashboards[0].title).toBe('Custom Title');
  });

  it('returns error for missing definition', async () => {
    const handler = createPromoteDashboardHandler(store);
    const result = await handler({});
    expect(typeof result).toBe('string');
    expect(result as string).toContain('required');
  });
});

describe('dashboard_share', () => {
  let store: InMemoryDashboardStore;

  beforeEach(() => {
    store = new InMemoryDashboardStore();
  });

  it('creates a share link', async () => {
    const d = await store.create({
      title: 'Sales', ownerId: 'u1', teamId: 't1',
      definition: serializeDashboard(makeDef()),
    });

    const handler = createShareDashboardHandler(store);
    const result = await handler({ dashboardId: d.id });

    expect(typeof result).toBe('object');
    const resp = result as any;
    expect(resp.content).toContain('Share link');
    expect(resp.blocks[0].data.token).toBeTruthy();
  });

  it('creates share with expiration', async () => {
    const d = await store.create({
      title: 'Sales', ownerId: 'u1', teamId: 't1',
      definition: serializeDashboard(makeDef()),
    });

    const handler = createShareDashboardHandler(store);
    const result = await handler({ dashboardId: d.id, expiresInHours: 24 });

    const resp = result as any;
    expect(resp.content).toContain('Expires');
  });

  it('returns error for non-existent dashboard', async () => {
    const handler = createShareDashboardHandler(store);
    const result = await handler({ dashboardId: 'bad-id' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('not found');
  });

  it('returns error for missing dashboardId', async () => {
    const handler = createShareDashboardHandler(store);
    const result = await handler({});
    expect(typeof result).toBe('string');
    expect(result as string).toContain('required');
  });
});

describe('dashboard_list_standalone', () => {
  let store: InMemoryDashboardStore;

  beforeEach(() => {
    store = new InMemoryDashboardStore();
  });

  it('lists dashboards for the team', async () => {
    await store.create({ title: 'A', ownerId: 'u1', teamId: 't1', definition: '{}' });
    await store.create({ title: 'B', ownerId: 'u1', teamId: 't1', definition: '{}' });

    const handler = createListDashboardsHandler(store);
    const result = await handler({}, { conversationId: 'c1', teamId: 't1' });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('A');
    expect(result as string).toContain('B');
  });

  it('returns message when no dashboards exist', async () => {
    const handler = createListDashboardsHandler(store);
    const result = await handler({}, { conversationId: 'c1', teamId: 't1' });
    expect(result as string).toContain('No standalone');
  });
});
