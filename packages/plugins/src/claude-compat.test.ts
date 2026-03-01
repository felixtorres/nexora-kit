import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { isClaudePlugin, loadClaudePlugin } from './claude-compat.js';
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
  it('returns true when .claude-plugin/ exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude-plugin'), { recursive: true });
    expect(isClaudePlugin(tmpDir)).toBe(true);
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

  it('handles command parse errors gracefully', () => {
    writeFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'test' }));
    writeFile('commands/bad.md', 'No frontmatter here');

    const result = loadClaudePlugin(tmpDir);
    expect(result.commandDefinitions.size).toBe(0);
    expect(result.errors).toContainEqual(expect.stringContaining('bad.md'));
  });
});

describe('discoverPlugins with Claude plugins', () => {
  it('discovers both nexora and Claude plugins', () => {
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

    // Neither
    writeFile('random-dir/readme.md', 'Not a plugin');

    const results = discoverPlugins(tmpDir);
    expect(results).toHaveLength(2);
    const namespaces = results.map((r) => r.plugin.manifest.namespace);
    expect(namespaces).toContain('nexora-plugin');
    expect(namespaces).toContain('claude-ext');
  });
});
