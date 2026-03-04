import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { isClaudePlugin, loadClaudePlugin, isMcpPlugin, loadMcpPlugin } from './claude-compat.js';
import { discoverPlugins } from './loader.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-claude-compat-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('isClaudePlugin', () => {
  it('returns true when .claude-plugin/plugin.json exists', () => {
    const dir = path.join(tmpDir, '.claude-plugin');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'test' }));
    expect(isClaudePlugin(tmpDir)).toBe(true);
  });

  it('returns false when .claude-plugin/ exists but plugin.json is missing', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude-plugin'), { recursive: true });
    expect(isClaudePlugin(tmpDir)).toBe(false);
  });

  it('returns false when .claude-plugin/ does not exist', () => {
    expect(isClaudePlugin(tmpDir)).toBe(false);
  });
});

describe('loadClaudePlugin', () => {
  it('loads a full Claude plugin', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({
      name: 'kyvos-mcp',
      version: '1.0.0',
      description: 'Data analytics plugin',
      author: 'Kyvos',
    }));

    writeFile('.mcp.json', JSON.stringify({
      mcpServers: {
        analytics: {
          type: 'http',
          url: 'http://localhost:8080/mcp',
        },
      },
    }));

    writeFile('commands/search.md', `---
description: Search the database
argument-hint: search query
---
You are a database search assistant.
Search for: {{input}}`);

    writeFile('skills/summarize/SKILL.md', `---
name: summarize
description: Summarize data
---
Please summarize the following data.`);

    writeFile('skills/summarize/references/schema.md', 'Schema reference content here.');

    const result = loadClaudePlugin(tmpDir);

    expect(result.errors).toHaveLength(0);
    expect(result.plugin.state).toBe('installed');
    expect(result.plugin.manifest.name).toBe('kyvos-mcp');
    expect(result.plugin.manifest.namespace).toBe('kyvos-mcp');
    expect(result.plugin.manifest.permissions).toEqual(['mcp:connect', 'network:connect']);
    expect(result.plugin.manifest.sandbox.tier).toBe('basic');

    // MCP servers
    expect(result.mcpServerConfigs).toHaveLength(1);
    expect(result.mcpServerConfigs[0].name).toBe('analytics');
    expect(result.mcpServerConfigs[0].transport).toBe('http');
    expect(result.mcpServerConfigs[0].url).toBe('http://localhost:8080/mcp');

    // Commands
    expect(result.commandDefinitions.size).toBe(1);
    const cmd = result.commandDefinitions.get('kyvos-mcp:search')!;
    expect(cmd.description).toBe('Search the database');
    expect(cmd.args).toHaveLength(1);
    expect(cmd.args[0].name).toBe('input');
    expect(cmd.prompt).toContain('database search assistant');

    // Skills with references appended
    expect(result.skillDefinitions.size).toBe(1);
    const skill = result.skillDefinitions.get('kyvos-mcp:summarize')!;
    expect(skill.description).toBe('Summarize data');
    expect(skill.prompt).toContain('Please summarize the following data.');
    expect(skill.prompt).toContain('Schema reference content here.');

    // Tools
    expect(result.plugin.tools).toHaveLength(1);
    expect(result.plugin.tools[0].name).toBe('kyvos-mcp:summarize');
  });

  it('returns error when plugin.json is missing', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude-plugin'), { recursive: true });

    const result = loadClaudePlugin(tmpDir);
    expect(result.plugin.state).toBe('errored');
    expect(result.errors[0]).toContain('No .claude-plugin/plugin.json');
  });

  it('returns error for malformed plugin.json', () => {
    writeFile('.claude-plugin/plugin.json', '{invalid json');

    const result = loadClaudePlugin(tmpDir);
    expect(result.plugin.state).toBe('errored');
    expect(result.errors[0]).toContain('Invalid plugin.json');
  });

  it('handles malformed .mcp.json gracefully', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'test', version: '1.0.0' }));
    writeFile('.mcp.json', '{invalid}');

    const result = loadClaudePlugin(tmpDir);
    expect(result.errors).toContainEqual(expect.stringContaining('.mcp.json'));
  });

  it('handles missing .mcp.json', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'test', version: '1.0.0' }));

    const result = loadClaudePlugin(tmpDir);
    expect(result.mcpServerConfigs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('sanitizes namespace from name', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'My Plugin Name' }));

    const result = loadClaudePlugin(tmpDir);
    expect(result.plugin.manifest.namespace).toBe('my-plugin-name');
  });

  it('handles stdio transport in .mcp.json', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'test' }));
    writeFile('.mcp.json', JSON.stringify({
      mcpServers: {
        local: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      },
    }));

    const result = loadClaudePlugin(tmpDir);
    expect(result.mcpServerConfigs[0].transport).toBe('stdio');
    expect(result.mcpServerConfigs[0].command).toBe('node');
  });

  it('handles skills without references directory', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'test' }));
    writeFile('skills/analyze/SKILL.md', `---
name: analyze
description: Analyze data
---
Analyze prompt.`);

    const result = loadClaudePlugin(tmpDir);
    expect(result.skillDefinitions.size).toBe(1);
    const skill = result.skillDefinitions.get('test:analyze')!;
    expect(skill.prompt).toBe('Analyze prompt.');
  });

  it('skips skill directories without SKILL.md', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'test' }));
    writeFile('skills/empty/readme.md', 'Not a skill');

    const result = loadClaudePlugin(tmpDir);
    expect(result.skillDefinitions.size).toBe(0);
  });

  it('loads CONNECTORS.md as pluginDocs', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'test' }));
    writeFile('CONNECTORS.md', 'Claude plugin connector docs.');

    const result = loadClaudePlugin(tmpDir);
    expect(result.pluginDocs).toBe('Claude plugin connector docs.');
  });

  it('falls back to README.md for pluginDocs', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'test' }));
    writeFile('README.md', 'Claude plugin readme.');

    const result = loadClaudePlugin(tmpDir);
    expect(result.pluginDocs).toBe('Claude plugin readme.');
  });

  it('handles command parse errors gracefully', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'test' }));
    writeFile('commands/bad.md', 'No frontmatter here');

    const result = loadClaudePlugin(tmpDir);
    expect(result.commandDefinitions.size).toBe(0);
    expect(result.errors).toContainEqual(expect.stringContaining('bad.md'));
  });
});

describe('isMcpPlugin', () => {
  it('returns true when .mcp.json exists', () => {
    writeFile('.mcp.json', JSON.stringify({ mcpServers: {} }));
    expect(isMcpPlugin(tmpDir)).toBe(true);
  });

  it('returns false when .mcp.json is absent', () => {
    expect(isMcpPlugin(tmpDir)).toBe(false);
  });
});

describe('loadMcpPlugin', () => {
  it('loads a stdio MCP plugin with metadata from package.json', () => {
    writeFile('package.json', JSON.stringify({
      name: '@ki-kyvos/kyvos-plugins',
      version: '2.1.0',
      description: 'Kyvos analytics MCP server',
    }));
    writeFile('.mcp.json', JSON.stringify({
      mcpServers: {
        kyvos: {
          type: 'stdio',
          command: 'node',
          args: ['dist/index.js'],
          env: { KYVOS_API_KEY: '${KYVOS_API_KEY}' },
        },
      },
    }));

    const result = loadMcpPlugin(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.plugin.manifest.name).toBe('kyvos-plugins');
    expect(result.plugin.manifest.namespace).toBe('kyvos-plugins');
    expect(result.plugin.manifest.version).toBe('2.1.0');
    expect(result.plugin.manifest.description).toBe('Kyvos analytics MCP server');
    expect(result.mcpServerConfigs).toHaveLength(1);
    expect(result.mcpServerConfigs[0].name).toBe('kyvos');
    expect(result.mcpServerConfigs[0].transport).toBe('stdio');
    expect(result.mcpServerConfigs[0].command).toBe('node');
  });

  it('loads an SSE MCP plugin without package.json, uses dir name as namespace', () => {
    writeFile('.mcp.json', JSON.stringify({
      mcpServers: {
        remote: { type: 'sse', url: 'https://mcp.example.com/sse' },
      },
    }));

    const result = loadMcpPlugin(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.mcpServerConfigs[0].transport).toBe('sse');
    expect(result.plugin.manifest.namespace).toMatch(/^[a-z0-9-]+$/);
  });

  it('errors when .mcp.json has no servers', () => {
    writeFile('.mcp.json', JSON.stringify({ mcpServers: {} }));

    const result = loadMcpPlugin(tmpDir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('No MCP servers defined');
  });

  it('errors on malformed .mcp.json', () => {
    writeFile('.mcp.json', 'not json {{{');

    const result = loadMcpPlugin(tmpDir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Invalid .mcp.json');
  });

  it('preserves http transport type regardless of URL path', () => {
    writeFile('.mcp.json', JSON.stringify({
      mcpServers: {
        server: { type: 'http', url: 'https://mcp.example.com/sse' },
      },
    }));

    const result = loadMcpPlugin(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.mcpServerConfigs[0].transport).toBe('http');
  });
});

describe('discoverPlugins with Claude plugins', () => {
  it('discovers nexora, Claude, and MCP-native plugins', () => {
    // Nexora plugin
    writeFile('nexora-plugin/plugin.yaml', `
name: Nexora Plugin
version: "1.0.0"
namespace: nexora-plugin
`);

    // Claude plugin
    writeFile('claude-plugin/.claude-plugin/plugin.json', JSON.stringify({
      name: 'claude-ext',
      version: '1.0.0',
    }));

    // MCP-native plugin
    writeFile('mcp-plugin/.mcp.json', JSON.stringify({
      mcpServers: { analytics: { type: 'stdio', command: 'node', args: ['index.js'] } },
    }));

    // Neither
    writeFile('random-dir/readme.md', 'Not a plugin');

    const results = discoverPlugins(tmpDir);
    expect(results).toHaveLength(3);
    const namespaces = results.map((r) => r.plugin.manifest.namespace);
    expect(namespaces).toContain('nexora-plugin');
    expect(namespaces).toContain('claude-ext');
    expect(namespaces).toContain('mcp-plugin');
  });
});
