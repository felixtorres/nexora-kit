import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAdminPluginEnableHandler,
  createAdminPluginDisableHandler,
  createAdminPluginUninstallHandler,
  createAdminAuditLogHandler,
  createAdminUsageHandler,
  createAdminAuditPurgeHandler,
} from './admin-handlers.js';
import type { ApiRequest, AuthIdentity } from './types.js';

function makeAuth(role: 'admin' | 'user' = 'admin'): AuthIdentity {
  return { userId: 'admin-1', teamId: 'team1', role };
}

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'POST',
    url: '/test',
    headers: {},
    params: {},
    query: {},
    auth: makeAuth(),
    ...overrides,
  };
}

function makeMockAdmin() {
  return {
    enablePlugin: vi.fn(),
    disablePlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    installPlugin: vi.fn(),
    getUsageSummary: vi.fn().mockReturnValue([]),
    auditLogger: {
      purge: vi.fn().mockReturnValue(5),
      query: vi.fn().mockReturnValue([
        {
          id: 1,
          actor: 'admin',
          action: 'plugin.install',
          target: 'plugin:test',
          details: {},
          result: 'success',
          createdAt: '2026-03-01',
        },
      ]),
    },
    usageAnalytics: {
      summarizeByPlugin: vi.fn().mockReturnValue([
        {
          pluginName: 'test',
          totalInputTokens: 100,
          totalOutputTokens: 50,
          totalTokens: 150,
          requestCount: 3,
          avgLatencyMs: 200,
        },
      ]),
      dailyBreakdown: vi.fn().mockReturnValue([
        {
          date: '2026-03-01',
          pluginName: 'test',
          inputTokens: 100,
          outputTokens: 50,
          requestCount: 3,
        },
      ]),
    },
  } as any;
}

describe('Admin Plugin Enable Handler', () => {
  it('enables a plugin', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminPluginEnableHandler(admin);

    const res = await handler(makeReq({ params: { name: 'test-plugin' } }));
    expect(res.status).toBe(200);
    expect((res.body as any).status).toBe('enabled');
    expect(admin.enablePlugin).toHaveBeenCalledWith('admin-1', 'test-plugin');
  });

  it('rejects non-admin users', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminPluginEnableHandler(admin);

    await expect(handler(makeReq({ auth: makeAuth('user') }))).rejects.toThrow(
      'Admin access required',
    );
  });

  it('rejects unauthenticated requests', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminPluginEnableHandler(admin);

    await expect(handler(makeReq({ auth: undefined }))).rejects.toThrow('Authentication required');
  });

  it('returns error for failed enable', async () => {
    const admin = makeMockAdmin();
    admin.enablePlugin.mockImplementation(() => {
      throw new Error('Plugin not found');
    });
    const handler = createAdminPluginEnableHandler(admin);

    await expect(handler(makeReq({ params: { name: 'nope' } }))).rejects.toThrow(
      'Plugin not found',
    );
  });
});

describe('Admin Plugin Disable Handler', () => {
  it('disables a plugin', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminPluginDisableHandler(admin);

    const res = await handler(makeReq({ params: { name: 'test-plugin' } }));
    expect(res.status).toBe(200);
    expect((res.body as any).status).toBe('disabled');
  });

  it('rejects non-admin users', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminPluginDisableHandler(admin);

    await expect(handler(makeReq({ auth: makeAuth('user') }))).rejects.toThrow(
      'Admin access required',
    );
  });
});

describe('Admin Plugin Uninstall Handler', () => {
  it('uninstalls a plugin', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminPluginUninstallHandler(admin);

    const res = await handler(makeReq({ params: { name: 'test-plugin' } }));
    expect(res.status).toBe(200);
    expect((res.body as any).status).toBe('uninstalled');
  });
});

describe('Admin Audit Log Handler', () => {
  it('returns audit events', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminAuditLogHandler(admin);

    const res = await handler(makeReq({ query: {} }));
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.events).toHaveLength(1);
    expect(body.count).toBe(1);
  });

  it('passes query filters', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminAuditLogHandler(admin);

    await handler(makeReq({ query: { action: 'plugin.install', limit: '10' } }));
    expect(admin.auditLogger.query).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'plugin.install', limit: 10 }),
    );
  });

  it('rejects non-admin', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminAuditLogHandler(admin);

    await expect(handler(makeReq({ auth: makeAuth('user') }))).rejects.toThrow(
      'Admin access required',
    );
  });
});

describe('Admin Usage Handler', () => {
  it('returns plugin breakdown by default', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminUsageHandler(admin);

    const res = await handler(makeReq({ query: {} }));
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.breakdown).toBe('plugin');
    expect(body.data).toHaveLength(1);
    expect(body.totalTokens).toBe(150);
  });

  it('returns daily breakdown', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminUsageHandler(admin);

    const res = await handler(makeReq({ query: { breakdown: 'daily' } }));
    const body = res.body as any;
    expect(body.breakdown).toBe('daily');
    expect(body.data).toHaveLength(1);
  });

  it('passes filter parameters', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminUsageHandler(admin);

    await handler(makeReq({ query: { pluginName: 'test', since: '2026-03-01' } }));
    expect(admin.usageAnalytics.summarizeByPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ pluginName: 'test', since: '2026-03-01' }),
    );
  });
});

describe('Admin Audit Purge Handler', () => {
  it('purges old audit events', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminAuditPurgeHandler(admin);

    const res = await handler(makeReq());
    expect(res.status).toBe(200);
    expect((res.body as any).deleted).toBe(5);
    expect(admin.auditLogger.purge).toHaveBeenCalledWith(0);
  });

  it('passes olderThanDays when provided', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminAuditPurgeHandler(admin);

    await handler(makeReq({ body: { olderThanDays: 30 } }));
    expect(admin.auditLogger.purge).toHaveBeenCalledWith(30);
  });

  it('rejects non-admin', async () => {
    const admin = makeMockAdmin();
    const handler = createAdminAuditPurgeHandler(admin);

    await expect(handler(makeReq({ auth: makeAuth('user') }))).rejects.toThrow(
      'Admin access required',
    );
  });
});
