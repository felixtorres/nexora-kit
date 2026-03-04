import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { statusCommand } from './cmd-status.js';

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

describe('status command', () => {
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

  it('displays health and metrics', async () => {
    mockClient.get
      .mockResolvedValueOnce({
        status: 'healthy',
        plugins: { total: 3, enabled: 2, errored: 0 },
        uptime: 3661,
      })
      .mockResolvedValueOnce({
        requests_total: 150,
        active_connections: 5,
        avg_latency_ms: 42,
        p95_latency_ms: 120,
        requests_by_status: { '200': 140, '404': 10 },
        requests_by_method: { GET: 100, POST: 50 },
      });

    await statusCommand.run({
      positionals: [],
      flags: { config: 'test.yaml' },
    });

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('healthy');
    expect(output).toContain('1h');
    expect(output).toContain('2 enabled / 3 total');
    expect(output).toContain('150');
    expect(output).toContain('42ms');
  });

  it('displays health without metrics', async () => {
    mockClient.get
      .mockResolvedValueOnce({
        status: 'degraded',
        plugins: { total: 2, enabled: 1, errored: 1 },
        uptime: 60,
      })
      .mockRejectedValueOnce(new Error('forbidden'));

    await statusCommand.run({
      positionals: [],
      flags: { config: 'test.yaml' },
    });

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('degraded');
    expect(output).toContain('1 errored');
    expect(output).not.toContain('Requests');
  });

  it('handles server not running', async () => {
    mockClient.get.mockRejectedValue(new TypeError('fetch failed'));

    await statusCommand.run({
      positionals: [],
      flags: { config: 'test.yaml' },
    });

    expect(process.exitCode).toBe(1);
  });
});
