import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpManager, type TransportFactory } from './mcp-manager.js';
import type { McpTransport } from './transports.js';
import type { McpServerConfig } from './types.js';

function createMockTransport(tools: Array<{ name: string; description: string }> = []): McpTransport {
  let requestCount = 0;
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockImplementation(async (method: string) => {
      if (method === 'initialize') return { capabilities: {} };
      if (method === 'tools/list') return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: { type: 'object', properties: {} },
        })),
      };
      if (method === 'tools/call') return { content: [{ type: 'text', text: 'tool result' }] };
      if (method === 'ping') return {};
      return {};
    }),
    notify: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

function createMockFactory(transports: Map<string, McpTransport>): TransportFactory {
  return {
    create(config: McpServerConfig): McpTransport {
      const t = transports.get(config.name);
      if (!t) throw new Error(`No mock transport for ${config.name}`);
      return t;
    },
  };
}

describe('McpManager', () => {
  it('starts servers and indexes their tools', async () => {
    const transport = createMockTransport([
      { name: 'read_file', description: 'Read a file' },
      { name: 'write_file', description: 'Write a file' },
    ]);
    const factory = createMockFactory(new Map([['fs-server', transport]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('my-plugin', [
      { name: 'fs-server', transport: 'stdio', command: 'node' },
    ]);

    const tools = manager.getTools('my-plugin');
    expect(tools).toHaveLength(2);
    expect(tools[0].definition.name).toBe('@my-plugin/fs-server.read_file');
    expect(tools[1].definition.name).toBe('@my-plugin/fs-server.write_file');
  });

  it('calls tools through the manager', async () => {
    const transport = createMockTransport([{ name: 'echo', description: 'Echo' }]);
    const factory = createMockFactory(new Map([['test', transport]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('ns', [
      { name: 'test', transport: 'stdio', command: 'node' },
    ]);

    const result = await manager.callTool('@ns/test.echo', { text: 'hello' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'tool result' }] });
  });

  it('throws on unknown tool', async () => {
    const manager = new McpManager();
    await expect(manager.callTool('@ns/server.unknown', {})).rejects.toThrow('MCP tool not found');
  });

  it('creates tool handlers that extract text content', async () => {
    const transport = createMockTransport([{ name: 'greet', description: 'Greet' }]);
    const factory = createMockFactory(new Map([['srv', transport]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('ns', [
      { name: 'srv', transport: 'stdio', command: 'node' },
    ]);

    const tools = manager.getTools('ns');
    const result = await tools[0].handler({});
    expect(result).toBe('tool result');
  });

  it('stops servers and cleans up tools', async () => {
    const transport = createMockTransport([{ name: 'tool1', description: 'T1' }]);
    const factory = createMockFactory(new Map([['srv', transport]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('ns', [
      { name: 'srv', transport: 'stdio', command: 'node' },
    ]);

    expect(manager.getTools('ns')).toHaveLength(1);

    await manager.stopServers('ns');
    expect(manager.getTools('ns')).toHaveLength(0);
    await expect(manager.callTool('@ns/srv.tool1', {})).rejects.toThrow('MCP tool not found');
  });

  it('manages multiple namespaces', async () => {
    const t1 = createMockTransport([{ name: 'a', description: 'A' }]);
    const t2 = createMockTransport([{ name: 'b', description: 'B' }]);
    const factory = createMockFactory(new Map([['srv1', t1], ['srv2', t2]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('plugin-a', [
      { name: 'srv1', transport: 'stdio', command: 'node' },
    ]);
    await manager.startServers('plugin-b', [
      { name: 'srv2', transport: 'stdio', command: 'node' },
    ]);

    expect(manager.getTools('plugin-a')).toHaveLength(1);
    expect(manager.getTools('plugin-b')).toHaveLength(1);
    expect(manager.listAll()).toHaveLength(2);
  });

  it('lists all managed servers', async () => {
    const t1 = createMockTransport([{ name: 'x', description: 'X' }, { name: 'y', description: 'Y' }]);
    const factory = createMockFactory(new Map([['srv', t1]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('ns', [
      { name: 'srv', transport: 'stdio', command: 'node' },
    ]);

    const all = manager.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual({
      namespace: 'ns',
      serverName: 'srv',
      status: 'healthy',
      toolCount: 2,
    });
  });

  it('returns health reports per namespace', async () => {
    const transport = createMockTransport([]);
    const factory = createMockFactory(new Map([['srv', transport]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('ns', [
      { name: 'srv', transport: 'stdio', command: 'node' },
    ]);

    const reports = manager.health('ns');
    expect(reports).toHaveLength(1);
    expect(reports[0].serverName).toBe('srv');
    expect(reports[0].status).toBe('healthy');
  });

  it('returns empty health for unknown namespace', () => {
    const manager = new McpManager();
    expect(manager.health('unknown')).toEqual([]);
  });

  it('shuts down all servers', async () => {
    const t1 = createMockTransport([]);
    const t2 = createMockTransport([]);
    const factory = createMockFactory(new Map([['a', t1], ['b', t2]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('ns1', [{ name: 'a', transport: 'stdio', command: 'node' }]);
    await manager.startServers('ns2', [{ name: 'b', transport: 'stdio', command: 'node' }]);

    await manager.shutdown();

    expect(manager.listAll()).toHaveLength(0);
    expect(t1.close).toHaveBeenCalled();
    expect(t2.close).toHaveBeenCalled();
  });

  it('converts MCP tool schemas to ToolDefinitions', async () => {
    const transport: McpTransport = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockImplementation(async (method: string) => {
        if (method === 'initialize') return { capabilities: {} };
        if (method === 'tools/list') return {
          tools: [{
            name: 'search',
            description: 'Search files',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'number', description: 'Max results' },
              },
              required: ['query'],
            },
          }],
        };
        return {};
      }),
      notify: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    };
    const factory = createMockFactory(new Map([['srv', transport]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('ns', [
      { name: 'srv', transport: 'stdio', command: 'node' },
    ]);

    const tools = manager.getTools('ns');
    expect(tools[0].definition).toEqual({
      name: '@ns/srv.search',
      description: 'Search files',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results' },
        },
        required: ['query'],
      },
    });
  });

  it('handler stringifies non-text results', async () => {
    const transport: McpTransport = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockImplementation(async (method: string) => {
        if (method === 'initialize') return { capabilities: {} };
        if (method === 'tools/list') return {
          tools: [{ name: 't', description: 'T', inputSchema: { type: 'object', properties: {} } }],
        };
        if (method === 'tools/call') return { data: [1, 2, 3] };
        return {};
      }),
      notify: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    };
    const factory = createMockFactory(new Map([['srv', transport]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('ns', [{ name: 'srv', transport: 'stdio', command: 'node' }]);

    const tools = manager.getTools('ns');
    const result = await tools[0].handler({});
    expect(result).toBe('{"data":[1,2,3]}');
  });

  it('handler returns string results directly', async () => {
    const transport: McpTransport = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockImplementation(async (method: string) => {
        if (method === 'initialize') return { capabilities: {} };
        if (method === 'tools/list') return {
          tools: [{ name: 't', description: 'T', inputSchema: { type: 'object', properties: {} } }],
        };
        if (method === 'tools/call') return 'plain string';
        return {};
      }),
      notify: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    };
    const factory = createMockFactory(new Map([['srv', transport]]));
    const manager = new McpManager({}, factory);

    await manager.startServers('ns', [{ name: 'srv', transport: 'stdio', command: 'node' }]);

    const tools = manager.getTools('ns');
    const result = await tools[0].handler({});
    expect(result).toBe('plain string');
  });

  it('stopServers is no-op for unknown namespace', async () => {
    const manager = new McpManager();
    await expect(manager.stopServers('unknown')).resolves.toBeUndefined();
  });
});
