import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthMonitor } from './health-monitor.js';
import type { McpServerHandle } from './server-handle.js';
import type { McpServerStatus, McpServerEvent } from './types.js';

function createMockHandle(name: string, namespace = 'test'): McpServerHandle & {
  ping: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  let status: McpServerStatus = 'healthy';
  return {
    config: { name, transport: 'stdio' as const, command: 'node' },
    namespace,
    ping: vi.fn().mockResolvedValue(true),
    start: vi.fn().mockImplementation(async () => { status = 'healthy'; }),
    stop: vi.fn().mockImplementation(async () => { status = 'stopped'; }),
    getStatus: () => status,
    getHealth: () => ({
      serverName: name,
      namespace,
      status,
      consecutiveFailures: 0,
      lastCheckAt: new Date(),
    }),
    listTools: () => [],
    callTool: vi.fn(),
    refreshTools: vi.fn(),
    isRunning: () => status !== 'stopped',
    getCapabilities: () => ({}),
    setStatus: (s: McpServerStatus) => { status = s; },
  } as any;
}

describe('HealthMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns health reports for all handles', () => {
    const monitor = new HealthMonitor();
    const h1 = createMockHandle('server-a');
    const h2 = createMockHandle('server-b');
    monitor.addHandle(h1);
    monitor.addHandle(h2);

    const reports = monitor.getReport();
    expect(reports).toHaveLength(2);
    expect(reports[0].serverName).toBe('server-a');
    expect(reports[1].serverName).toBe('server-b');
  });

  it('checks all handles on checkNow', async () => {
    const monitor = new HealthMonitor();
    const h = createMockHandle('server');
    monitor.addHandle(h);

    await monitor.checkNow();
    expect(h.ping).toHaveBeenCalledOnce();
  });

  it('runs periodic checks', async () => {
    const monitor = new HealthMonitor({ intervalMs: 1000 });
    const h = createMockHandle('server');
    monitor.addHandle(h);
    monitor.start();

    await vi.advanceTimersByTimeAsync(3000);

    expect(h.ping.mock.calls.length).toBe(3);
    monitor.stop();
  });

  it('stops periodic checks', async () => {
    const monitor = new HealthMonitor({ intervalMs: 1000 });
    const h = createMockHandle('server');
    monitor.addHandle(h);
    monitor.start();

    await vi.advanceTimersByTimeAsync(1000);
    monitor.stop();
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.ping.mock.calls.length).toBe(1);
  });

  it('emits events on status change', async () => {
    const monitor = new HealthMonitor({ maxRestartAttempts: 0 }); // disable restarts for this test
    const h = createMockHandle('server');
    monitor.addHandle(h);

    const events: McpServerEvent[] = [];
    monitor.onEvent((e) => events.push(e));

    // First check — healthy, no status change (was healthy)
    await monitor.checkNow();
    expect(events).toHaveLength(0);

    // Simulate ping failure that changes status
    h.ping.mockImplementation(async () => {
      (h as any).setStatus('unhealthy');
      (h as any).getHealth = () => ({
        serverName: 'server',
        namespace: 'test',
        status: 'unhealthy',
        consecutiveFailures: 1,
        lastCheckAt: new Date(),
      });
      return false;
    });

    await monitor.checkNow();
    // Status change emits server:unhealthy, then tryRestart emits server:restarting + server:healthy
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('server:unhealthy');
  });

  it('tries to restart unhealthy servers', async () => {
    const monitor = new HealthMonitor({ maxRestartAttempts: 2 });
    const h = createMockHandle('server');

    h.ping.mockImplementation(async () => {
      (h as any).setStatus('unhealthy');
      (h as any).getHealth = () => ({
        serverName: 'server',
        namespace: 'test',
        status: 'unhealthy',
        consecutiveFailures: 5,
        lastCheckAt: new Date(),
      });
      return false;
    });
    h.start.mockImplementation(async () => {
      (h as any).setStatus('healthy');
    });

    monitor.addHandle(h);

    const events: McpServerEvent[] = [];
    monitor.onEvent((e) => events.push(e));

    await monitor.checkNow();

    expect(h.stop).toHaveBeenCalled();
    expect(h.start).toHaveBeenCalled();
    const restartEvents = events.filter((e) => e.type === 'server:restarting');
    expect(restartEvents).toHaveLength(1);
  });

  it('respects max restart attempts', async () => {
    const monitor = new HealthMonitor({ maxRestartAttempts: 1 });
    const h = createMockHandle('server');

    h.ping.mockImplementation(async () => {
      (h as any).setStatus('unhealthy');
      (h as any).getHealth = () => ({
        serverName: 'server',
        namespace: 'test',
        status: 'unhealthy',
        consecutiveFailures: 5,
        lastCheckAt: new Date(),
      });
      return false;
    });
    h.start.mockRejectedValue(new Error('restart failed'));

    monitor.addHandle(h);

    // First check: attempt restart (count=0 < max=1)
    await monitor.checkNow();
    expect(h.start).toHaveBeenCalledTimes(1);

    // Second check: max reached, no more restart
    await monitor.checkNow();
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('emits error event on failed restart', async () => {
    const monitor = new HealthMonitor({ maxRestartAttempts: 3 });
    const h = createMockHandle('server');

    h.ping.mockImplementation(async () => {
      (h as any).setStatus('unhealthy');
      (h as any).getHealth = () => ({
        serverName: 'server',
        namespace: 'test',
        status: 'unhealthy',
        consecutiveFailures: 5,
        lastCheckAt: new Date(),
      });
      return false;
    });
    h.start.mockRejectedValue(new Error('cannot restart'));

    monitor.addHandle(h);

    const events: McpServerEvent[] = [];
    monitor.onEvent((e) => events.push(e));

    await monitor.checkNow();

    const errorEvents = events.filter((e) => e.type === 'server:error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error).toBe('cannot restart');
  });

  it('removes handles', () => {
    const monitor = new HealthMonitor();
    monitor.addHandle(createMockHandle('a'));
    monitor.addHandle(createMockHandle('b'));

    monitor.removeHandle('a');
    expect(monitor.getReport()).toHaveLength(1);
    expect(monitor.getReport()[0].serverName).toBe('b');
  });

  it('resets restart count on successful restart', async () => {
    const monitor = new HealthMonitor({ maxRestartAttempts: 2 });
    const h = createMockHandle('server');
    let failCount = 0;

    h.ping.mockImplementation(async () => {
      (h as any).setStatus('unhealthy');
      (h as any).getHealth = () => ({
        serverName: 'server',
        namespace: 'test',
        status: 'unhealthy',
        consecutiveFailures: 5,
        lastCheckAt: new Date(),
      });
      return false;
    });
    h.start.mockImplementation(async () => {
      failCount++;
      if (failCount <= 1) throw new Error('fail');
      (h as any).setStatus('healthy');
    });

    monitor.addHandle(h);

    // First restart attempt: fails
    await monitor.checkNow();
    // Advance time past backoff window before second attempt
    vi.advanceTimersByTime(60_000);
    // Second restart attempt: succeeds
    await monitor.checkNow();

    expect(h.start).toHaveBeenCalledTimes(2);
  });
});
