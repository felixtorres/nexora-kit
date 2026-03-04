import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { adminAuditCommand, adminFeedbackCommand, adminCleanupCommand } from './cmd-admin.js';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./api-client.js', () => ({
  ApiClient: vi.fn(),
  ApiError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
  createClientFromConfig: vi.fn().mockResolvedValue(mockClient),
  handleApiError: vi.fn(() => { process.exitCode = 1; }),
}));

describe('admin audit command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('displays audit events in a table', async () => {
    mockClient.get.mockResolvedValue({
      events: [
        { id: 1, actor: 'admin-1', action: 'plugin.enable', target: 'faq', result: 'success', createdAt: '2026-03-04T10:00:00Z', details: {} },
        { id: 2, actor: 'admin-1', action: 'plugin.disable', target: 'old', result: 'failure', createdAt: '2026-03-04T09:00:00Z', details: {} },
      ],
      count: 2,
    });

    await adminAuditCommand.run({
      positionals: [],
      flags: { config: 'test.yaml' },
    });

    expect(mockClient.get).toHaveBeenCalledWith('/admin/audit-log', {});
    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('2 events');
    expect(output).toContain('plugin.enable');
  });

  it('passes filter flags as query params', async () => {
    mockClient.get.mockResolvedValue({ events: [], count: 0 });

    await adminAuditCommand.run({
      positionals: [],
      flags: { actor: 'admin-1', action: 'plugin.enable', since: '2026-03-01', limit: '10', config: 'test.yaml' },
    });

    expect(mockClient.get).toHaveBeenCalledWith('/admin/audit-log', {
      actor: 'admin-1',
      action: 'plugin.enable',
      since: '2026-03-01',
      limit: '10',
    });
  });

  it('shows info when no events', async () => {
    mockClient.get.mockResolvedValue({ events: [], count: 0 });

    await adminAuditCommand.run({
      positionals: [],
      flags: { config: 'test.yaml' },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No audit events'));
  });
});

describe('admin feedback command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('displays feedback summary', async () => {
    mockClient.get.mockResolvedValue({
      totalCount: 50,
      positiveCount: 40,
      negativeCount: 10,
      positiveRate: 0.8,
      byPlugin: [
        { pluginNamespace: 'faq', positive: 30, negative: 5 },
        { pluginNamespace: 'kyvos', positive: 10, negative: 5 },
      ],
      byModel: [{ model: 'claude-sonnet-4-6', positive: 40, negative: 10 }],
      topTags: [{ tag: 'helpful', count: 25 }, { tag: 'accurate', count: 15 }],
    });

    await adminFeedbackCommand.run({
      positionals: [],
      flags: { config: 'test.yaml' },
    });

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('50');
    expect(output).toContain('80.0%');
    expect(output).toContain('faq');
    expect(output).toContain('helpful');
  });

  it('shows info when no feedback', async () => {
    mockClient.get.mockResolvedValue({
      totalCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      positiveRate: 0,
      byPlugin: [],
      byModel: [],
      topTags: [],
    });

    await adminFeedbackCommand.run({
      positionals: [],
      flags: { config: 'test.yaml' },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No feedback'));
  });

  it('passes filter flags', async () => {
    mockClient.get.mockResolvedValue({
      totalCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      positiveRate: 0,
      byPlugin: [],
      byModel: [],
      topTags: [],
    });

    await adminFeedbackCommand.run({
      positionals: [],
      flags: { since: '2026-03-01', model: 'claude-sonnet-4-6', plugin: 'faq', config: 'test.yaml' },
    });

    expect(mockClient.get).toHaveBeenCalledWith('/admin/feedback/summary', {
      from: '2026-03-01',
      model: 'claude-sonnet-4-6',
      pluginNamespace: 'faq',
    });
  });
});

describe('admin cleanup command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('purges audit log', async () => {
    mockClient.post.mockResolvedValue({});

    await adminCleanupCommand.run({
      positionals: [],
      flags: { config: 'test.yaml' },
    });

    expect(mockClient.post).toHaveBeenCalledWith('/admin/audit-log/purge');
  });

  it('supports dry-run mode', async () => {
    mockClient.get.mockResolvedValue({ events: [], count: 42 });

    await adminCleanupCommand.run({
      positionals: [],
      flags: { 'dry-run': true, 'older-than': '30', config: 'test.yaml' },
    });

    expect(mockClient.post).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('42'));
  });

  it('rejects invalid older-than value', async () => {
    await adminCleanupCommand.run({
      positionals: [],
      flags: { 'older-than': 'abc', config: 'test.yaml' },
    });

    expect(process.exitCode).toBe(1);
  });
});
