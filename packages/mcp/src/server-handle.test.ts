import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServerHandle } from './server-handle.js';
import type { McpTransport } from './transports.js';

function createMockTransport() {
  return {
    connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    request: vi.fn<(method: string, params?: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({}),
    notify: vi.fn<(method: string, params?: Record<string, unknown>) => void>(),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isConnected: vi.fn<() => boolean>().mockReturnValue(true),
  } satisfies McpTransport;
}

describe('McpServerHandle', () => {
  let transport: ReturnType<typeof createMockTransport>;

  beforeEach(() => {
    transport = createMockTransport();
  });

  function createHandle() {
    return new McpServerHandle({
      config: { name: 'test-server', transport: 'stdio', command: 'node' },
      transport,
      namespace: 'test-plugin',
    });
  }

  it('starts with initialize handshake and tool discovery', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: { tools: {} } }) // initialize
      .mockResolvedValueOnce({ tools: [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: {} } }] }); // tools/list

    const handle = createHandle();
    await handle.start();

    expect(transport.connect).toHaveBeenCalled();
    expect(transport.request).toHaveBeenCalledWith('initialize', expect.objectContaining({
      protocolVersion: '2024-11-05',
    }));
    expect(transport.notify).toHaveBeenCalledWith('notifications/initialized');
    expect(transport.request).toHaveBeenCalledWith('tools/list');
    expect(handle.getStatus()).toBe('healthy');
    expect(handle.listTools()).toHaveLength(1);
    expect(handle.listTools()[0].name).toBe('read_file');
  });

  it('sets unhealthy status on start failure', async () => {
    transport.connect.mockRejectedValue(new Error('Connection refused'));

    const handle = createHandle();
    await expect(handle.start()).rejects.toThrow('Connection refused');
    expect(handle.getStatus()).toBe('unhealthy');
  });

  it('stops gracefully', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: {} })
      .mockResolvedValueOnce({ tools: [] });

    const handle = createHandle();
    await handle.start();
    await handle.stop();

    expect(transport.notify).toHaveBeenCalledWith('notifications/cancelled');
    expect(transport.close).toHaveBeenCalled();
    expect(handle.getStatus()).toBe('stopped');
    expect(handle.listTools()).toHaveLength(0);
  });

  it('calls tools via transport', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: {} })
      .mockResolvedValueOnce({ tools: [] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'result' }] });

    const handle = createHandle();
    await handle.start();

    const result = await handle.callTool('read_file', { path: '/tmp/test' });
    expect(transport.request).toHaveBeenCalledWith('tools/call', {
      name: 'read_file',
      arguments: { path: '/tmp/test' },
    });
    expect(result).toEqual({ content: [{ type: 'text', text: 'result' }] });
  });

  it('updates status based on circuit breaker after tool call success', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: {} })
      .mockResolvedValueOnce({ tools: [] })
      .mockResolvedValueOnce({ content: [] });

    const handle = createHandle();
    await handle.start();
    await handle.callTool('test', {});

    expect(handle.getStatus()).toBe('healthy');
  });

  it('updates status after tool call failure', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: {} })
      .mockResolvedValueOnce({ tools: [] });

    const handle = new McpServerHandle({
      config: { name: 'test-server', transport: 'stdio', command: 'node' },
      transport,
      namespace: 'test-plugin',
      circuitBreakerConfig: { failureThreshold: 2 },
    });
    await handle.start();

    transport.request.mockRejectedValue(new Error('fail'));

    await expect(handle.callTool('bad', {})).rejects.toThrow('fail');
    await expect(handle.callTool('bad', {})).rejects.toThrow('fail');

    expect(handle.getStatus()).toBe('unhealthy');
  });

  it('rejects tool calls when circuit breaker is open', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: {} })
      .mockResolvedValueOnce({ tools: [] });

    const handle = new McpServerHandle({
      config: { name: 'test-server', transport: 'stdio', command: 'node' },
      transport,
      namespace: 'test-plugin',
      circuitBreakerConfig: { failureThreshold: 1 },
    });
    await handle.start();

    transport.request.mockRejectedValue(new Error('fail'));
    await expect(handle.callTool('bad', {})).rejects.toThrow('fail');

    await expect(handle.callTool('any', {})).rejects.toThrow('Circuit breaker open');
  });

  it('pings the server', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: {} })
      .mockResolvedValueOnce({ tools: [] })
      .mockResolvedValueOnce({}); // ping

    const handle = createHandle();
    await handle.start();

    const result = await handle.ping();
    expect(result).toBe(true);
    expect(transport.request).toHaveBeenCalledWith('ping');
  });

  it('returns false on ping failure', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: {} })
      .mockResolvedValueOnce({ tools: [] })
      .mockRejectedValueOnce(new Error('timeout'));

    const handle = createHandle();
    await handle.start();

    const result = await handle.ping();
    expect(result).toBe(false);
  });

  it('returns health report', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: {} })
      .mockResolvedValueOnce({ tools: [] });

    const handle = createHandle();
    await handle.start();

    const health = handle.getHealth();
    expect(health.serverName).toBe('test-server');
    expect(health.namespace).toBe('test-plugin');
    expect(health.status).toBe('healthy');
    expect(health.consecutiveFailures).toBe(0);
  });

  it('refreshes tools', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: {} })
      .mockResolvedValueOnce({ tools: [] })
      .mockResolvedValueOnce({ tools: [{ name: 'new_tool', description: 'New', inputSchema: { type: 'object', properties: {} } }] });

    const handle = createHandle();
    await handle.start();
    expect(handle.listTools()).toHaveLength(0);

    const tools = await handle.refreshTools();
    expect(tools).toHaveLength(1);
    expect(handle.listTools()).toHaveLength(1);
  });

  it('reports isRunning correctly', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: {} })
      .mockResolvedValueOnce({ tools: [] });

    const handle = createHandle();
    expect(handle.isRunning()).toBe(false);

    // isConnected returns true by default in our mock
    transport.isConnected.mockReturnValue(false);
    expect(handle.isRunning()).toBe(false);

    transport.isConnected.mockReturnValue(true);
    await handle.start();
    expect(handle.isRunning()).toBe(true);
  });

  it('stores server capabilities', async () => {
    transport.request
      .mockResolvedValueOnce({ capabilities: { tools: {}, prompts: {} } })
      .mockResolvedValueOnce({ tools: [] });

    const handle = createHandle();
    await handle.start();

    expect(handle.getCapabilities()).toEqual({ tools: {}, prompts: {} });
  });
});
