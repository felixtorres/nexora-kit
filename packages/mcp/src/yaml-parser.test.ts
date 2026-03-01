import { describe, it, expect } from 'vitest';
import { parseMcpYaml, resolveTemplates, type TemplateResolver } from './yaml-parser.js';
import { mcpServerConfigSchema, mcpConfigSchema } from './types.js';

describe('mcpServerConfigSchema', () => {
  it('validates a stdio server config', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test-server',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    });
    expect(result.success).toBe(true);
  });

  it('validates an sse server config', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test-server',
      transport: 'sse',
      url: 'http://localhost:3000/sse',
    });
    expect(result.success).toBe(true);
  });

  it('rejects stdio without command', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test-server',
      transport: 'stdio',
    });
    expect(result.success).toBe(false);
  });

  it('rejects sse without url', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test-server',
      transport: 'sse',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid transport type', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test-server',
      transport: 'websocket',
      command: 'node',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: '',
      transport: 'stdio',
      command: 'node',
    });
    expect(result.success).toBe(false);
  });

  it('accepts env and args for stdio', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test',
      transport: 'stdio',
      command: 'python',
      args: ['-m', 'server'],
      env: { API_KEY: 'secret' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts headers for sse', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test',
      transport: 'sse',
      url: 'http://localhost:3000/sse',
      headers: { Authorization: 'Bearer token' },
    });
    expect(result.success).toBe(true);
  });
});

describe('mcpConfigSchema', () => {
  it('validates a config with multiple servers', () => {
    const result = mcpConfigSchema.safeParse({
      servers: [
        { name: 'a', transport: 'stdio', command: 'node' },
        { name: 'b', transport: 'sse', url: 'http://localhost:3000/sse' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty servers array', () => {
    const result = mcpConfigSchema.safeParse({ servers: [] });
    expect(result.success).toBe(false);
  });
});

describe('parseMcpYaml', () => {
  it('parses a valid mcp.yaml', () => {
    const yaml = `
servers:
  - name: filesystem
    transport: stdio
    command: npx
    args:
      - "@modelcontextprotocol/server-filesystem"
      - /tmp
  - name: remote
    transport: sse
    url: http://localhost:8080/sse
`;
    const configs = parseMcpYaml(yaml);
    expect(configs).toHaveLength(2);
    expect(configs[0].name).toBe('filesystem');
    expect(configs[0].transport).toBe('stdio');
    expect(configs[0].command).toBe('npx');
    expect(configs[0].args).toEqual(['@modelcontextprotocol/server-filesystem', '/tmp']);
    expect(configs[1].name).toBe('remote');
    expect(configs[1].transport).toBe('sse');
    expect(configs[1].url).toBe('http://localhost:8080/sse');
  });

  it('throws on invalid yaml', () => {
    expect(() => parseMcpYaml('servers: []')).toThrow();
  });

  it('throws on missing required fields', () => {
    const yaml = `
servers:
  - name: bad
    transport: stdio
`;
    expect(() => parseMcpYaml(yaml)).toThrow();
  });
});

describe('resolveTemplates', () => {
  const resolver: TemplateResolver = {
    get(key: string) {
      const values: Record<string, string> = {
        'api_key': 'sk-123',
        'base_url': 'http://localhost:9090',
        'server_path': '/usr/local/bin/mcp-server',
      };
      return values[key];
    },
  };

  it('resolves template variables in command', () => {
    const configs = resolveTemplates(
      [{ name: 'test', transport: 'stdio', command: '{{config.server_path}}' }],
      resolver,
    );
    expect(configs[0].command).toBe('/usr/local/bin/mcp-server');
  });

  it('resolves template variables in args', () => {
    const configs = resolveTemplates(
      [{ name: 'test', transport: 'stdio', command: 'node', args: ['--key', '{{config.api_key}}'] }],
      resolver,
    );
    expect(configs[0].args).toEqual(['--key', 'sk-123']);
  });

  it('resolves template variables in env', () => {
    const configs = resolveTemplates(
      [{ name: 'test', transport: 'stdio', command: 'node', env: { API_KEY: '{{config.api_key}}' } }],
      resolver,
    );
    expect(configs[0].env!.API_KEY).toBe('sk-123');
  });

  it('resolves template variables in url', () => {
    const configs = resolveTemplates(
      [{ name: 'test', transport: 'sse', url: '{{config.base_url}}/sse' }],
      resolver,
    );
    expect(configs[0].url).toBe('http://localhost:9090/sse');
  });

  it('resolves template variables in headers', () => {
    const configs = resolveTemplates(
      [{ name: 'test', transport: 'sse', url: 'http://x', headers: { 'X-Key': '{{config.api_key}}' } }],
      resolver,
    );
    expect(configs[0].headers!['X-Key']).toBe('sk-123');
  });

  it('throws on unresolved template variable', () => {
    expect(() =>
      resolveTemplates(
        [{ name: 'test', transport: 'stdio', command: '{{config.missing}}' }],
        resolver,
      ),
    ).toThrow('Unresolved template variable: config.missing');
  });

  it('returns configs unchanged without resolver', () => {
    const configs = [{ name: 'test', transport: 'stdio' as const, command: '{{config.x}}' }];
    const result = resolveTemplates(configs);
    expect(result[0].command).toBe('{{config.x}}');
  });

  it('handles templates with spaces', () => {
    const configs = resolveTemplates(
      [{ name: 'test', transport: 'stdio', command: '{{ config.api_key }}' }],
      resolver,
    );
    expect(configs[0].command).toBe('sk-123');
  });
});

describe('parseMcpYaml with templates', () => {
  it('resolves templates during parsing', () => {
    const yaml = `
servers:
  - name: test
    transport: sse
    url: "{{config.base_url}}/sse"
    headers:
      Authorization: "Bearer {{config.api_key}}"
`;
    const resolver: TemplateResolver = {
      get(key: string) {
        if (key === 'base_url') return 'http://localhost:9090';
        if (key === 'api_key') return 'sk-123';
        return undefined;
      },
    };
    const configs = parseMcpYaml(yaml, resolver);
    expect(configs[0].url).toBe('http://localhost:9090/sse');
    expect(configs[0].headers!.Authorization).toBe('Bearer sk-123');
  });
});
