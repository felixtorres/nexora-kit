import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ToolDispatcher } from '@nexora-kit/core';
import type { McpManager, McpTransport, McpToolAdapter, McpHealthReport, McpServerConfig } from '@nexora-kit/mcp';
import { loadPlugin } from './loader.js';
import { PluginLifecycleManager } from './lifecycle.js';

// Minimal mock implementations for lifecycle dependencies
function createMockPermissionGate() {
  return {
    check: vi.fn().mockReturnValue(true),
    grant: vi.fn(),
    revoke: vi.fn(),
    clearAll: vi.fn(),
  };
}

function createMockConfigResolver() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => store.get(key)),
    getAll: vi.fn(() => Object.fromEntries(store)),
    set: vi.fn((key: string, value: unknown) => store.set(key, value)),
  };
}

function createMockMcpManager(): McpManager & {
  startServers: ReturnType<typeof vi.fn>;
  stopServers: ReturnType<typeof vi.fn>;
  getTools: ReturnType<typeof vi.fn>;
} {
  return {
    startServers: vi.fn().mockResolvedValue(undefined),
    stopServers: vi.fn().mockResolvedValue(undefined),
    getTools: vi.fn().mockReturnValue([]),
    callTool: vi.fn(),
    health: vi.fn().mockReturnValue([]),
    listAll: vi.fn().mockReturnValue([]),
    onHealthEvent: vi.fn(),
    startHealthChecks: vi.fn(),
    stopHealthChecks: vi.fn(),
    shutdown: vi.fn(),
  } as any;
}

describe('MCP integration with plugin loader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-mcp-test-'));
  });

  function writePluginFiles(files: Record<string, string>) {
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(tmpDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  }

  it('discovers mcp.yaml in plugin directory', () => {
    writePluginFiles({
      'plugin.yaml': `
name: test-plugin
version: "1.0.0"
namespace: test
permissions: []
dependencies: []
sandbox:
  tier: basic
`,
      'mcp/mcp.yaml': `
servers:
  - name: my-server
    transport: stdio
    command: node
    args:
      - server.js
`,
    });

    const result = loadPlugin(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.mcpServerConfigs).toHaveLength(1);
    expect(result.mcpServerConfigs[0].name).toBe('my-server');
    expect(result.mcpServerConfigs[0].transport).toBe('stdio');
    expect(result.mcpServerConfigs[0].command).toBe('node');
    expect(result.mcpServerConfigs[0].args).toEqual(['server.js']);
  });

  it('handles missing mcp directory gracefully', () => {
    writePluginFiles({
      'plugin.yaml': `
name: test-plugin
version: "1.0.0"
namespace: test
permissions: []
dependencies: []
sandbox:
  tier: basic
`,
    });

    const result = loadPlugin(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.mcpServerConfigs).toHaveLength(0);
  });

  it('reports errors for invalid mcp.yaml', () => {
    writePluginFiles({
      'plugin.yaml': `
name: test-plugin
version: "1.0.0"
namespace: test
permissions: []
dependencies: []
sandbox:
  tier: basic
`,
      'mcp/mcp.yaml': `
servers:
  - name: bad
    transport: stdio
`,
    });

    const result = loadPlugin(tmpDir);
    expect(result.errors).toContain('Failed to parse mcp/mcp.yaml');
    expect(result.mcpServerConfigs).toHaveLength(0);
  });

  it('discovers multiple MCP servers', () => {
    writePluginFiles({
      'plugin.yaml': `
name: multi-mcp
version: "1.0.0"
namespace: multi
permissions: []
dependencies: []
sandbox:
  tier: basic
`,
      'mcp/mcp.yaml': `
servers:
  - name: fs-server
    transport: stdio
    command: npx
    args:
      - fs-server
  - name: api-server
    transport: sse
    url: http://localhost:3000/sse
`,
    });

    const result = loadPlugin(tmpDir);
    expect(result.mcpServerConfigs).toHaveLength(2);
    expect(result.mcpServerConfigs[0].name).toBe('fs-server');
    expect(result.mcpServerConfigs[1].name).toBe('api-server');
  });
});

describe('MCP lifecycle integration', () => {
  it('starts MCP servers on plugin enable', async () => {
    const mcpManager = createMockMcpManager();
    const dispatcher = new ToolDispatcher();

    const lifecycle = new PluginLifecycleManager({
      permissionGate: createMockPermissionGate() as any,
      configResolver: createMockConfigResolver() as any,
      toolDispatcher: dispatcher,
      mcpManager,
    });

    const configs: McpServerConfig[] = [
      { name: 'test-server', transport: 'stdio', command: 'node' },
    ];

    lifecycle.install({
      manifest: {
        name: 'test',
        version: '1.0.0',
        namespace: 'test',
        permissions: ['mcp:connect'],
        dependencies: [],
        sandbox: { tier: 'basic' },
      },
      state: 'installed',
      tools: [],
    });

    lifecycle.setMcpConfigs('test', configs);
    lifecycle.enable('test');

    // MCP startup is async — give it a tick
    await new Promise((r) => setTimeout(r, 10));

    expect(mcpManager.startServers).toHaveBeenCalledWith('test', configs);
  });

  it('stops MCP servers on plugin disable', async () => {
    const mcpManager = createMockMcpManager();
    const dispatcher = new ToolDispatcher();

    const lifecycle = new PluginLifecycleManager({
      permissionGate: createMockPermissionGate() as any,
      configResolver: createMockConfigResolver() as any,
      toolDispatcher: dispatcher,
      mcpManager,
    });

    lifecycle.install({
      manifest: {
        name: 'test',
        version: '1.0.0',
        namespace: 'test',
        permissions: [],
        dependencies: [],
        sandbox: { tier: 'basic' },
      },
      state: 'installed',
      tools: [],
    });

    lifecycle.enable('test');
    lifecycle.disable('test');

    expect(mcpManager.stopServers).toHaveBeenCalledWith('test');
  });

  it('registers MCP tools in dispatcher when servers start', async () => {
    const mcpManager = createMockMcpManager();
    mcpManager.getTools.mockReturnValue([
      {
        definition: {
          name: '@test/srv.read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockResolvedValue('file content'),
      },
    ] satisfies McpToolAdapter[]);

    const dispatcher = new ToolDispatcher();

    const lifecycle = new PluginLifecycleManager({
      permissionGate: createMockPermissionGate() as any,
      configResolver: createMockConfigResolver() as any,
      toolDispatcher: dispatcher,
      mcpManager,
    });

    lifecycle.install({
      manifest: {
        name: 'test',
        version: '1.0.0',
        namespace: 'test',
        permissions: ['mcp:connect'],
        dependencies: [],
        sandbox: { tier: 'basic' },
      },
      state: 'installed',
      tools: [],
    });

    lifecycle.setMcpConfigs('test', [
      { name: 'srv', transport: 'stdio', command: 'node' },
    ]);

    lifecycle.enable('test');

    // Wait for async MCP startup
    await new Promise((r) => setTimeout(r, 10));

    expect(dispatcher.hasHandler('@test/srv.read_file')).toBe(true);
    const tools = dispatcher.listTools();
    expect(tools.some((t) => t.name === '@test/srv.read_file')).toBe(true);
  });

  it('handles MCP configs in reload', async () => {
    const mcpManager = createMockMcpManager();
    const dispatcher = new ToolDispatcher();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-reload-mcp-'));

    // Write plugin with MCP config
    fs.mkdirSync(path.join(tmpDir, 'mcp'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'plugin.yaml'), `
name: reload-test
version: "1.0.0"
namespace: reload-test
permissions: []
dependencies: []
sandbox:
  tier: basic
`);
    fs.writeFileSync(path.join(tmpDir, 'mcp', 'mcp.yaml'), `
servers:
  - name: reloaded-server
    transport: stdio
    command: node
`);

    const lifecycle = new PluginLifecycleManager({
      permissionGate: createMockPermissionGate() as any,
      configResolver: createMockConfigResolver() as any,
      toolDispatcher: dispatcher,
      mcpManager,
    });

    // First install
    const result = loadPlugin(tmpDir);
    lifecycle.install(result.plugin);
    lifecycle.registerPluginDir('reload-test', tmpDir);
    lifecycle.setMcpConfigs('reload-test', result.mcpServerConfigs);
    lifecycle.enable('reload-test');

    await new Promise((r) => setTimeout(r, 10));
    expect(mcpManager.startServers).toHaveBeenCalledTimes(1);

    // Reload — should stop and restart
    mcpManager.startServers.mockClear();
    const reloadResult = lifecycle.reload('reload-test');
    expect(reloadResult.mcpServerConfigs).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 10));
    expect(mcpManager.stopServers).toHaveBeenCalledWith('reload-test');
    expect(mcpManager.startServers).toHaveBeenCalledWith('reload-test', expect.any(Array));
  });

  it('works without mcpManager (backward compatible)', () => {
    const dispatcher = new ToolDispatcher();

    const lifecycle = new PluginLifecycleManager({
      permissionGate: createMockPermissionGate() as any,
      configResolver: createMockConfigResolver() as any,
      toolDispatcher: dispatcher,
      // No mcpManager
    });

    lifecycle.install({
      manifest: {
        name: 'test',
        version: '1.0.0',
        namespace: 'test',
        permissions: [],
        dependencies: [],
        sandbox: { tier: 'basic' },
      },
      state: 'installed',
      tools: [],
    });

    // Should not throw
    expect(() => lifecycle.enable('test')).not.toThrow();
    expect(() => lifecycle.disable('test')).not.toThrow();
  });
});
